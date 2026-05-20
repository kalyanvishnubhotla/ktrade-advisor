from __future__ import annotations

import csv
import json
import logging
import os
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Quiet third-party log noise ──────────────────────────────────────────────
# ETFs and many ETPs don't have fundamentals / earnings dates, so yfinance
# emits ugly "HTTP Error 404" and "No earnings dates found, symbol may be
# delisted" lines for them on every refresh. These are expected and handled
# internally — silencing keeps the terminal usable.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)
logging.getLogger("urllib3").setLevel(logging.ERROR)

from .analysis import DISCLAIMER
from .database import ROOT, db, init_db, rows_to_dicts, seed_defaults, upsert_ticker
from .fibonacci import cached_fib_zones
from .market_data import refresh_all, refresh_symbols_list
from .refresh_engine import manager as refresh_manager
from .news import RSS_SOURCES, latest_news, news_for_ticker, refresh_news
from .pivots import cached_pivots, major_swings
from .recommendation_snapshots import (
    calculate_accuracy_metrics,
    get_history_for_ticker,
    get_latest_snapshot,
    get_learning_insights,
    high_quality_accuracy_for_ticker,
    mark_user_action,
    record_outcome,
    save_snapshot,
    similar_setup_memory,
)
from .zones import cached_sr_zones, nearest_zones
from .research import parse_research_signal
from .pdf_statement_parser import parse_etrade_pdf
from . import backtesting

app = FastAPI(title="Ktrade Advisor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WatchlistIn(BaseModel):
    name: str
    theme: str = "General"
    active: bool = True


class TickerIn(BaseModel):
    symbol: str
    company: Optional[str] = None
    theme: str = "General"


class RenameIn(BaseModel):
    name: str
    theme: Optional[str] = None
    active: Optional[bool] = None


class ResearchIn(BaseModel):
    text: str
    approved: bool = False
    apply_impact: bool = False


class ResearchApprovalIn(BaseModel):
    approved: bool
    apply_impact: bool = False


class NewsApplyIn(BaseModel):
    ticker: str
    confidence: str = "Medium"


class PositionIn(BaseModel):
    ticker: str
    shares: float
    cost: float
    theme: str = "General"


class SettingIn(BaseModel):
    value: str


class SnapshotIn(BaseModel):
    analysisResult: Dict[str, Any]


class SnapshotActionIn(BaseModel):
    action: str
    notes: Optional[str] = None


class SnapshotOutcomeIn(BaseModel):
    actualOutcomePct: float
    holdPeriodDays: Optional[int] = None


@app.on_event("startup")
def startup() -> None:
    init_db()
    seed_defaults()
    # Initialise default settings (INSERT OR IGNORE = safe to run every time)
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('enablePortfolioOS', 'false')")
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('enableBacktestingAccuracy', 'false')")

    # Drop expired yfinance cache rows so the table doesn't grow forever
    try:
        from .yfinance_cache import cache_purge_expired
        cache_purge_expired()
    except Exception:
        pass

    # Background refresh on first boot — dashboard renders from cached DB state instantly
    threading.Thread(target=safe_startup_refresh, daemon=True).start()


def safe_startup_refresh() -> None:
    try:
        # Use the job manager so the auto-startup refresh is also visible
        # in /api/refresh/latest and uses the parallel pipeline.
        refresh_manager.start()
    except Exception:
        pass


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "disclaimer": DISCLAIMER}


@app.get("/api/dashboard")
def dashboard() -> dict:
    with db() as conn:
        cards = rows_to_dicts(
            conn.execute(
                """
                SELECT t.id AS ticker_id, t.symbol, t.company, t.theme, t.asset_type,
                       i.price, i.as_of, i.support, i.resistance, i.distance_to_support, i.distance_to_resistance,
                       i.pattern_signal, i.rsi, i.rsi_interpretation, i.macd, i.macd_signal, i.macd_histogram,
                       i.macd_trend AS indicator_macd_trend, i.momentum_score, i.momentum_divergence,
                       i.adx, i.adx_interpretation, i.trend_alignment, i.trend_strength_score, i.trend_strength_summary,
                       i.obv_trend, i.volume_vs_20d, i.rising_volume_on_up_days, i.volume_confirmation, i.volume_confirmation_summary,
                       i.earnings_signal_json, i.sector_rs_signal_json, i.regime_signal_json,
                       i.insider_signal_json, i.fundamentals_signal_json,
                       s.score, s.decision, s.confidence, s.risk, s.trend_label, s.momentum_label,
                       s.trend_strength_summary AS score_trend_strength_summary, s.momentum_summary, s.macd_trend, s.volume_label,
                       s.volume_confirmation_summary AS score_volume_confirmation_summary,
                       s.news_label, s.summary, s.suggested_action, s.entry_range,
                       s.invalidation_level, s.target1, s.target2, s.distance_to_buy_zone, s.buy_zone_confluence,
                       s.setup_factor_scores, s.setup_positive_factors, s.setup_concern_factors,
                       s.decision_reasons, s.risk_reward_summary, s.improve_to_buy,
                       s.buy_zone_explanation, s.target_zone_explanation, s.fresh_high_targets, s.fresh_high_target_note,
                       s.hold_window, s.why_rating, s.changes_view,
                       (SELECT COUNT(*) FROM news_ticker_matches WHERE ticker_id = t.id) AS news_count,
                       (SELECT COUNT(*) FROM news_ticker_matches ntm JOIN news_items ni ON ni.id = ntm.news_item_id WHERE ntm.ticker_id = t.id AND ni.sentiment = 'Positive') AS positive_news_count,
                       (SELECT COUNT(*) FROM news_ticker_matches ntm JOIN news_items ni ON ni.id = ntm.news_item_id WHERE ntm.ticker_id = t.id AND ni.sentiment = 'Negative') AS negative_news_count,
                       (SELECT ni.title FROM news_ticker_matches ntm JOIN news_items ni ON ni.id = ntm.news_item_id WHERE ntm.ticker_id = t.id ORDER BY COALESCE(ni.published_at, ni.created_at) DESC LIMIT 1) AS latest_news_title,
                       (SELECT ni.source FROM news_ticker_matches ntm JOIN news_items ni ON ni.id = ntm.news_item_id WHERE ntm.ticker_id = t.id ORDER BY COALESCE(ni.published_at, ni.created_at) DESC LIMIT 1) AS latest_news_source,
                       (SELECT ni.link FROM news_ticker_matches ntm JOIN news_items ni ON ni.id = ntm.news_item_id WHERE ntm.ticker_id = t.id ORDER BY COALESCE(ni.published_at, ni.created_at) DESC LIMIT 1) AS latest_news_link
                FROM tickers t
                LEFT JOIN indicators i ON i.ticker_id = t.id
                LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                -- Only surface tickers that belong to at least one ACTIVE watchlist.
                -- Toggling a watchlist Inactive (or removing a ticker from every
                -- active list) makes its cards vanish from the dashboard.
                WHERE t.id IN (
                    SELECT wt.ticker_id FROM watchlist_tickers wt
                    JOIN watchlists w ON w.id = wt.watchlist_id
                    WHERE w.active = 1
                )
                ORDER BY COALESCE(s.score, 0) DESC, t.symbol
                """
            ).fetchall()
        )
        for card in cards:
            hydrate_setup_checklist(card)
            hydrate_signal_blobs(card)
            card["similar_setup_memory"] = similar_setup_memory(card["symbol"], card.get("buy_zone_confluence") or card.get("score"))
            card["historical_accuracy_70_plus"] = high_quality_accuracy_for_ticker(card["symbol"])
            if card.get("price"):
                support_zone, resistance_zone = nearest_zones(card["ticker_id"], card["price"])
                card["nearest_support_zone"] = support_zone
                card["nearest_resistance_zone"] = resistance_zone
        watchlists = watchlist_summary(conn)
        settings = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings").fetchall()}
    return {
        "market": {
            "label": settings.get("market_condition", "Mixed / cautious"),
            "explanation": settings.get("market_explanation", "Market Today: Mixed / Cautious. Be selective."),
            "last_refresh": settings.get("last_refresh"),
            "failed_count": int(settings.get("last_refresh_failed_count", "0")),
            "error": settings.get("last_refresh_error", ""),
        },
        "news": {
            "last_refresh": settings.get("last_news_refresh"),
            "failed_count": int(settings.get("last_news_failed_count", "0")),
            "error": settings.get("last_news_error", ""),
            "latest": latest_news(12),
        },
        "settings": {
            "show_beginner_price_help": settings.get("show_beginner_price_help", "true").lower() != "false",
            "enable_portfolio_os": settings.get("enablePortfolioOS", "false").lower() == "true",
            "enable_backtesting_accuracy": settings.get("enableBacktestingAccuracy", "false").lower() == "true",
        },
        "cards": cards,
        "watchlists": watchlists,
        "disclaimer": DISCLAIMER,
    }


def parse_json_list(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def hydrate_setup_checklist(item: dict) -> None:
    item["setup_factor_scores"] = parse_json_list(item.get("setup_factor_scores"))
    item["setup_positive_factors"] = parse_json_list(item.get("setup_positive_factors"))
    item["setup_concern_factors"] = parse_json_list(item.get("setup_concern_factors"))
    item["decision_reasons"] = parse_json_list(item.get("decision_reasons"))


def _parse_json_dict(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def hydrate_signal_blobs(item: dict) -> None:
    """Unpack the 5 new signal JSON blobs into flat keys on the card/indicator dict."""
    for key in [
        "earnings_signal_json",
        "sector_rs_signal_json",
        "regime_signal_json",
        "insider_signal_json",
        "fundamentals_signal_json",
    ]:
        blob = _parse_json_dict(item.pop(key, None))
        item.update(blob)


def watchlist_summary(conn) -> list[dict]:
    watchlists = rows_to_dicts(conn.execute("SELECT * FROM watchlists ORDER BY active DESC, name").fetchall())
    for item in watchlists:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT t.symbol, t.theme, s.score, s.decision
                FROM watchlist_tickers wt
                JOIN tickers t ON t.id = wt.ticker_id
                LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                WHERE wt.watchlist_id = ?
                """,
                (item["id"],),
            ).fetchall()
        )
        scores = [r["score"] for r in rows if r["score"] is not None]
        item["ticker_count"] = len(rows)
        item["average_score"] = round(sum(scores) / len(scores), 1) if scores else None
        item["top_opportunities"] = len([r for r in rows if (r["score"] or 0) >= 80])
        item["wait_on"] = len([r for r in rows if r["decision"] == "Wait for better price"])
        item["avoid"] = len([r for r in rows if r["decision"] == "Avoid for now"])
        themes = {}
        for row in rows:
            themes[row["theme"]] = themes.get(row["theme"], 0) + 1
        item["theme_concentration"] = max(themes, key=themes.get) if themes else item["theme"]
        item["earnings_warnings"] = "Unavailable in MVP when yfinance does not expose dates."
    return watchlists


@app.post("/api/refresh")
def refresh() -> dict:
    """
    Kick off a background refresh and return immediately with a job_id.

    The frontend polls /api/refresh/status/{job_id} for progress. Refreshes are
    idempotent — calling this while one is already running returns the existing
    job_id, so accidental double-clicks don't spawn duplicate work.
    """
    job_id = refresh_manager.start()
    return {"jobId": job_id, "status": "started"}


@app.get("/api/refresh/status/{job_id}")
def refresh_status(job_id: str) -> dict:
    """
    Live progress for a refresh job. Returns 404 if the job_id is unknown
    (already evicted after 1 hour, or never existed). Frontend polls this
    every ~1.5 s while a refresh is running.
    """
    state = refresh_manager.status(job_id)
    if state is None:
        raise HTTPException(404, "Refresh job not found (it may have expired)")
    return state


@app.get("/api/refresh/latest")
def refresh_latest() -> dict:
    """Convenience: the most recent refresh job, regardless of whether it's still active."""
    state = refresh_manager.latest()
    return state or {"jobId": None, "status": "idle"}


@app.post("/api/refresh/sync")
def refresh_sync() -> dict:
    """
    Legacy synchronous refresh — blocks until everything is done.
    Kept available for testing and the auto-refresh cron-style callers
    that don't need progressive updates.
    """
    return refresh_all(background_news=False)


@app.post("/api/news/refresh")
def refresh_news_endpoint() -> dict:
    return refresh_news()


@app.get("/api/cache/stats")
def cache_stats_endpoint() -> dict:
    """Return current yfinance cache hit counts + oldest entry age."""
    from .yfinance_cache import cache_stats
    return cache_stats()


@app.post("/api/cache/clear")
def cache_clear_endpoint(kind: Optional[str] = None) -> dict:
    """Clear all (or one kind of) yfinance cache entries. Useful when debugging."""
    from .yfinance_cache import cache_clear
    deleted = cache_clear(kind)
    return {"deleted": deleted, "kind": kind}


@app.post("/api/snapshots/{ticker}")
def save_snapshot_endpoint(ticker: str, payload: SnapshotIn) -> dict:
    save_snapshot(ticker, payload.analysisResult)
    return {"ok": True}


@app.post("/api/snapshots/{ticker}/track-current")
def track_current_snapshot_endpoint(ticker: str) -> dict:
    symbol = ticker.strip().upper().replace(" ", "")
    with db() as conn:
        ticker_row = conn.execute("SELECT * FROM tickers WHERE symbol = ?", (symbol,)).fetchone()
        if not ticker_row:
            raise HTTPException(404, "Ticker not found")
        ticker_id = ticker_row["id"]
        indicators = conn.execute("SELECT * FROM indicators WHERE ticker_id = ?", (ticker_id,)).fetchone()
        score = conn.execute("SELECT * FROM scores WHERE ticker_id = ? ORDER BY as_of DESC LIMIT 1", (ticker_id,)).fetchone()
        if not indicators or not score:
            raise HTTPException(400, "Refresh this ticker before tracking a decision")
        payload = {
            "indicators": dict(indicators),
            "score": dict(score),
            "pivots": cached_pivots(ticker_id),
            "fib_zones": cached_fib_zones(ticker_id),
            "sr_zones": cached_sr_zones(ticker_id),
        }
    save_snapshot(symbol, payload)
    return {"ok": True, "message": "Decision snapshot saved."}


@app.get("/api/snapshots/{ticker}/latest")
def latest_snapshot_endpoint(ticker: str) -> Optional[dict]:
    return get_latest_snapshot(ticker)


@app.get("/api/snapshots/{ticker}")
def snapshot_history_endpoint(ticker: str, limit: int = 50) -> list[dict]:
    return get_history_for_ticker(ticker, limit)


@app.patch("/api/snapshots/{snapshot_id}/action")
def snapshot_action_endpoint(snapshot_id: int, payload: SnapshotActionIn) -> dict:
    mark_user_action(snapshot_id, payload.action, payload.notes)
    return {"ok": True}


@app.patch("/api/snapshots/{snapshot_id}/outcome")
def snapshot_outcome_endpoint(snapshot_id: int, payload: SnapshotOutcomeIn) -> dict:
    record_outcome(snapshot_id, payload.actualOutcomePct, payload.holdPeriodDays)
    return {"ok": True}


@app.get("/api/snapshots/metrics/accuracy")
def snapshot_accuracy_endpoint(ticker: Optional[str] = None) -> dict:
    return calculate_accuracy_metrics(ticker)


@app.get("/api/snapshots/insights/learning")
def snapshot_learning_insights_endpoint(ticker: Optional[str] = None, daysBack: int = 90) -> dict:
    return get_learning_insights(ticker, daysBack)


@app.get("/api/news")
def get_news() -> dict:
    return {"sources": RSS_SOURCES, "items": latest_news(80)}


@app.get("/api/settings")
def get_settings() -> dict:
    with db() as conn:
        rows = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings").fetchall()}
    return {
        "show_beginner_price_help": rows.get("show_beginner_price_help", "true").lower() != "false",
        "enable_portfolio_os": rows.get("enablePortfolioOS", "false").lower() == "true",
        "enable_backtesting_accuracy": rows.get("enableBacktestingAccuracy", "false").lower() == "true",
    }


@app.patch("/api/settings/{key}")
def update_setting(key: str, payload: SettingIn) -> dict:
    allowed = {"show_beginner_price_help", "enablePortfolioOS", "enableBacktestingAccuracy"}
    if key not in allowed:
        raise HTTPException(400, "Unknown setting")
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, payload.value))
    return {"ok": True}


@app.get("/api/watchlists")
def get_watchlists() -> list[dict]:
    with db() as conn:
        summaries = watchlist_summary(conn)
        for item in summaries:
            item["tickers"] = rows_to_dicts(
                conn.execute(
                    """
                    SELECT t.*, s.score, s.decision
                    FROM watchlist_tickers wt
                    JOIN tickers t ON t.id = wt.ticker_id
                    LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                    WHERE wt.watchlist_id = ?
                    ORDER BY t.symbol
                    """,
                    (item["id"],),
                ).fetchall()
            )
    return summaries


@app.post("/api/watchlists")
def create_watchlist(payload: WatchlistIn) -> dict:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO watchlists (name, theme, active) VALUES (?, ?, ?)",
            (payload.name.strip(), payload.theme.strip(), int(payload.active)),
        )
        return {"id": cur.lastrowid}


@app.patch("/api/watchlists/{watchlist_id}")
def update_watchlist(watchlist_id: int, payload: RenameIn) -> dict:
    with db() as conn:
        existing = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Watchlist not found")
        conn.execute(
            "UPDATE watchlists SET name = ?, theme = ?, active = ? WHERE id = ?",
            (
                payload.name.strip(),
                payload.theme if payload.theme is not None else existing["theme"],
                int(payload.active) if payload.active is not None else existing["active"],
                watchlist_id,
            ),
        )
    return {"ok": True}


@app.post("/api/watchlists/{watchlist_id}/duplicate")
def duplicate_watchlist(watchlist_id: int) -> dict:
    with db() as conn:
        original = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not original:
            raise HTTPException(404, "Watchlist not found")
        name = f"{original['name']} Copy"
        cur = conn.execute("INSERT INTO watchlists (name, theme, active) VALUES (?, ?, ?)", (name, original["theme"], original["active"]))
        conn.execute(
            "INSERT INTO watchlist_tickers SELECT ?, ticker_id FROM watchlist_tickers WHERE watchlist_id = ?",
            (cur.lastrowid, watchlist_id),
        )
        return {"id": cur.lastrowid}


@app.delete("/api/watchlists/{watchlist_id}/tickers/{symbol}")
def remove_ticker(watchlist_id: int, symbol: str) -> dict:
    with db() as conn:
        conn.execute(
            """
            DELETE FROM watchlist_tickers
            WHERE watchlist_id = ? AND ticker_id = (SELECT id FROM tickers WHERE symbol = ?)
            """,
            (watchlist_id, symbol.upper()),
        )
    return {"ok": True}


def _symbol_exists_on_yahoo(symbol: str) -> bool:
    """
    Quick one-shot check: does Yahoo actually have price data for this symbol?
    Used to gate POST /api/watchlists/{id}/tickers so a typo'd or delisted
    symbol fails fast with a clean message, instead of silently creating a
    dead `tickers` row that then haunts the dashboard forever.

    Falls back to True if the network call itself errors out — we'd rather
    accept the symbol than block on a transient Yahoo hiccup.
    """
    try:
        import yfinance as _yf
        df = _yf.Ticker(symbol.strip().upper()).history(period="5d", auto_adjust=False)
        return df is not None and not df.empty
    except Exception:
        return True  # don't punish the user for a Yahoo blip


@app.post("/api/watchlists/{watchlist_id}/tickers")
def add_ticker(watchlist_id: int, payload: TickerIn) -> dict:
    with db() as conn:
        watchlist = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not watchlist:
            raise HTTPException(404, "Watchlist not found")

    # Validate the symbol BEFORE we create any rows. Hitting Yahoo here is
    # synchronous (~0.5–1s) but it's a one-time user action, and it prevents
    # the "dead card I can't get rid of" UX trap.
    cleaned = (payload.symbol or "").strip().upper()
    if not cleaned:
        raise HTTPException(422, "Please enter a ticker symbol.")
    if not _symbol_exists_on_yahoo(cleaned):
        raise HTTPException(
            422,
            f"Symbol '{cleaned}' wasn't found on Yahoo Finance. Check the spelling "
            "(e.g. BRK-B not BRK.B) or try a different exchange suffix.",
        )

    with db() as conn:
        ticker_id = upsert_ticker(conn, cleaned, payload.company, payload.theme or watchlist["theme"])
        conn.execute("INSERT OR IGNORE INTO watchlist_tickers VALUES (?, ?)", (watchlist_id, ticker_id))
    return {"ok": True}


@app.delete("/api/tickers/{symbol}")
def delete_ticker(symbol: str) -> dict:
    """
    Permanently delete a ticker from the entire app.

    All child rows clean up automatically via FOREIGN KEY ON DELETE CASCADE
    (watchlist_tickers, prices, indicators, scores, pivots, fib_zones,
    sr_zones, news_ticker_matches, recommendation_snapshots, research_signals,
    and the cascaded tracked_decisions / outcomes off snapshots).

    Use case: a typo'd symbol left a dead card, or the user no longer wants
    to track a stock and wants it gone from history entirely.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        raise HTTPException(422, "Missing ticker symbol")
    with db() as conn:
        row = conn.execute("SELECT id FROM tickers WHERE symbol = ?", (sym,)).fetchone()
        if not row:
            raise HTTPException(404, f"Ticker '{sym}' not found")
        conn.execute("DELETE FROM tickers WHERE id = ?", (row["id"],))
    return {"ok": True, "deleted": sym}


@app.get("/api/tickers/{symbol}")
def ticker_detail(symbol: str) -> dict:
    """
    Detail payload powering the Ticker Detail page and the optional
    "Pro Chart Analysis" overlay.

    Pro-mode additions to the payload (kept off the hot path when not used):
      • OHLC per bar so the frontend can render candlesticks
      • Moving-average series (EMA21, SMA50, SMA200)
      • Fibonacci retracement + extension levels with plain-English labels
      • Detected candlestick patterns (last ~60 bars)
    """
    normalized_symbol = symbol.upper().replace(" ", "")
    with db() as conn:
        ticker = conn.execute("SELECT * FROM tickers WHERE symbol = ?", (normalized_symbol,)).fetchone()
        if not ticker:
            raise HTTPException(404, "Ticker not found")
        ticker_id = ticker["id"]
        # Pull full OHLC now — needed for candlesticks AND for pattern detection.
        # Limit stays at 180 bars which comfortably covers the "All" tab in the chart.
        prices = rows_to_dicts(
            conn.execute(
                "SELECT date, open, high, low, close, volume "
                "FROM prices WHERE ticker_id = ? ORDER BY date DESC LIMIT 260",
                (ticker_id,),
            ).fetchall()
        )
        indicators = conn.execute("SELECT * FROM indicators WHERE ticker_id = ?", (ticker_id,)).fetchone()
        scores = rows_to_dicts(conn.execute("SELECT * FROM scores WHERE ticker_id = ? ORDER BY as_of DESC LIMIT 20", (ticker_id,)).fetchall())
        for score in scores:
            hydrate_setup_checklist(score)
        research = rows_to_dicts(conn.execute("SELECT * FROM research_signals WHERE ticker_id = ? ORDER BY created_at DESC", (ticker_id,)).fetchall())
        recommendations = rows_to_dicts(conn.execute("SELECT * FROM recommendations WHERE ticker_id = ? ORDER BY created_at DESC LIMIT 20", (ticker_id,)).fetchall())
        pivots = cached_pivots(ticker_id)
        fib_zones = cached_fib_zones(ticker_id)
        sr_zones = cached_sr_zones(ticker_id)
    ind_dict = dict(indicators) if indicators else None
    if ind_dict:
        hydrate_signal_blobs(ind_dict)

    # ── Pro Chart Analysis fields ────────────────────────────────────────────
    # All of these are computed cheaply on demand from `prices`. They're tiny
    # additions to the payload (no extra DB round-trips, no extra Yahoo calls).
    prices_asc = list(reversed(prices))  # oldest → newest for chart consumption
    pro_chart = _build_pro_chart_payload(prices_asc, pivots)

    return {
        "ticker": dict(ticker),
        "prices": prices_asc,
        "indicators": ind_dict,
        "pivots": pivots,
        "major_pivots": major_swings(pivots),
        "fib_zones": fib_zones,
        "sr_zones": sr_zones,
        "scores": scores,
        "research": research,
        "news": news_for_ticker(ticker_id),
        "recommendations": recommendations,
        "historical_accuracy_70_plus": high_quality_accuracy_for_ticker(normalized_symbol),
        "similar_setup_memory": similar_setup_memory(normalized_symbol, scores[0].get("buy_zone_confluence") or scores[0].get("score") if scores else None),
        "pro_chart": pro_chart,
    }


def _build_pro_chart_payload(prices_asc: list[dict], pivots: list[dict]) -> dict:
    """
    Pre-compute everything the Pro Chart Analysis overlay needs.

    Done backend-side (not in JS) because:
      • pandas + numpy are already loaded — calculations take <50 ms
      • Keeps the frontend bundle smaller (no ta-lib in the browser)
      • Pattern detection is non-trivial to repeat client-side

    Returns dict-shaped payload the frontend consumes as-is. All fields are
    None-safe; the frontend defensively handles missing series.
    """
    import pandas as pd
    from .candlestick_patterns import detect_patterns
    from .fibonacci import (
        FIB_RATIOS,
        calculate_fib_extensions,
        calculate_fib_levels,
        identify_recent_fib_setup,
    )

    if not prices_asc or len(prices_asc) < 5:
        return {
            "ema21": [], "sma50": [], "sma200": [],
            "fib": None, "patterns": [],
        }

    # ── Build a clean OHLC DataFrame ─────────────────────────────────────────
    df = pd.DataFrame(prices_asc)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    close = df["close"]

    def _series_to_points(s) -> list[dict]:
        """Convert a pandas Series → list of {time, value} dicts. Skips NaNs."""
        out = []
        for date, val in s.dropna().items():
            out.append({"time": date.date().isoformat(), "value": round(float(val), 4)})
        return out

    ema21 = close.ewm(span=21, adjust=False).mean()
    sma50  = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()

    # ── Candlestick patterns (last 60 bars) ──────────────────────────────────
    patterns: list[dict] = []
    try:
        if {"open", "high", "low", "close"}.issubset(df.columns):
            patterns = detect_patterns(df, lookback=60, max_patterns=10)
    except Exception:
        patterns = []

    # ── Fibonacci retracements + extensions ──────────────────────────────────
    # Reuse the existing pivot-based setup detector so we stay consistent with
    # the rest of the engine. Levels are returned as a flat list of {ratio,
    # price, label, summary} so the frontend renders them in one loop.
    fib_payload = None
    try:
        setup = identify_recent_fib_setup(pivots or [])
        if setup:
            ret_levels = calculate_fib_levels(setup.start_price, setup.end_price)
            ext_levels = calculate_fib_extensions(setup.start_price, setup.end_price)
            level_summaries = {
                0.236: "Shallow pullback. First place buyers often re-engage.",
                0.382: "Common retracement in trending markets.",
                0.500: "The midpoint. Half the prior move has been given back.",
                0.618: "Golden retracement — strong setups often hold above this.",
                0.786: "Deep retracement. Below this, the trend is at risk.",
                1.000: "Full retracement. The prior swing has been erased.",
                1.272: "First extension target — typical first profit-take zone.",
                1.618: "Golden extension — common next target when price breaks to new highs.",
            }
            levels: list[dict] = []
            for ratio in FIB_RATIOS:
                if ratio in ret_levels:
                    levels.append({
                        "ratio":   ratio,
                        "price":   round(float(ret_levels[ratio]), 4),
                        "label":   f"Fib {int(ratio * 1000) / 10:g}%",
                        "kind":    "retracement",
                        "summary": level_summaries.get(ratio, ""),
                    })
            for ratio, price in ext_levels.items():
                levels.append({
                    "ratio":   ratio,
                    "price":   round(float(price), 4),
                    "label":   f"Fib {int(ratio * 1000) / 10:g}%",
                    "kind":    "extension",
                    "summary": level_summaries.get(ratio, ""),
                })
            fib_payload = {
                "direction":   setup.direction,
                "start_date":  setup.start_date,
                "start_price": setup.start_price,
                "end_date":    setup.end_date,
                "end_price":   setup.end_price,
                "swing_pct":   setup.swing_pct,
                "levels":      levels,
            }
    except Exception:
        fib_payload = None

    return {
        "ema21":    _series_to_points(ema21),
        "sma50":    _series_to_points(sma50),
        "sma200":   _series_to_points(sma200),
        "fib":      fib_payload,
        "patterns": patterns,
    }


@app.post("/api/research/parse")
def research_parse(payload: ResearchIn) -> dict:
    parsed = parse_research_signal(payload.text)
    if not parsed.get("ticker"):
        raise HTTPException(400, "Could not find Ticker field")
    with db() as conn:
        ticker_id = upsert_ticker(conn, parsed["ticker"], parsed.get("company"))
        cur = conn.execute(
            """
            INSERT INTO research_signals
            (ticker_id, source_date, company, source_links, summary, bullish, bearish, catalyst_type, time_sensitivity,
             sentiment, confidence, suggested_impact, reason, approved, applied)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticker_id,
                parsed.get("date"),
                parsed.get("company"),
                parsed.get("source_links"),
                parsed.get("summary"),
                parsed.get("bullish"),
                parsed.get("bearish"),
                parsed.get("catalyst_type"),
                parsed.get("time_sensitivity"),
                parsed.get("sentiment"),
                parsed.get("confidence"),
                parsed.get("suggested_impact"),
                parsed.get("reason"),
                int(payload.approved),
                int(payload.apply_impact and payload.approved),
            ),
        )
    return {"id": cur.lastrowid, "parsed": parsed, "message": "Stored locally. Review and approve before applying impact."}


@app.patch("/api/research/{signal_id}/approval")
def approve_research(signal_id: int, payload: ResearchApprovalIn) -> dict:
    with db() as conn:
        conn.execute(
            "UPDATE research_signals SET approved = ?, applied = ? WHERE id = ?",
            (int(payload.approved), int(payload.apply_impact and payload.approved), signal_id),
        )
    return {"ok": True}


@app.post("/api/news/{news_id}/apply")
def apply_news_signal(news_id: int, payload: NewsApplyIn) -> dict:
    ticker_symbol = payload.ticker.strip().upper()
    with db() as conn:
        ticker = conn.execute("SELECT * FROM tickers WHERE symbol = ?", (ticker_symbol,)).fetchone()
        news = conn.execute("SELECT * FROM news_items WHERE id = ?", (news_id,)).fetchone()
        if not ticker:
            raise HTTPException(404, "Ticker not found")
        if not news:
            raise HTTPException(404, "News item not found")
        sentiment = news["sentiment"] if news["sentiment"] in ["Positive", "Negative", "Mixed"] else "Neutral"
        impact = "Increase" if sentiment == "Positive" else "Decrease" if sentiment == "Negative" else "Caution" if sentiment == "Mixed" else "Keep"
        cur = conn.execute(
            """
            INSERT INTO research_signals
            (ticker_id, source_date, company, source_links, summary, bullish, bearish, catalyst_type, time_sensitivity,
             sentiment, confidence, suggested_impact, reason, approved, applied)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
            """,
            (
                ticker["id"],
                news["published_at"],
                ticker["company"],
                news["link"],
                news["title"],
                news["title"] if sentiment == "Positive" else "",
                news["title"] if sentiment == "Negative" else "",
                "RSS headline",
                "Medium",
                sentiment,
                payload.confidence,
                impact,
                f"Applied by user from {news['source']} {news['feed_name']} RSS headline.",
            ),
        )
    return {"ok": True, "research_signal_id": cur.lastrowid, "message": "RSS headline was applied as a research signal. Refresh to recalculate score."}


@app.get("/api/history")
def history() -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT r.*, t.symbol, t.company
                FROM recommendations r
                JOIN tickers t ON t.id = r.ticker_id
                ORDER BY r.created_at DESC
                LIMIT 250
                """
            ).fetchall()
        )


@app.get("/api/learning")
def learning() -> dict:
    with db() as conn:
        recs = rows_to_dicts(
            conn.execute(
                """
                SELECT r.*, t.symbol, t.theme
                FROM recommendations r
                JOIN tickers t ON t.id = r.ticker_id
                ORDER BY r.created_at DESC
                LIMIT 500
                """
            ).fetchall()
        )
    buckets: dict[str, int] = {"80-100": 0, "65-79": 0, "50-64": 0, "<50": 0}
    watch: dict[str, int] = {}
    poor: dict[str, int] = {}
    for rec in recs:
        score = rec.get("score") or 0
        if score >= 80:
            buckets["80-100"] += 1
        elif score >= 65:
            buckets["65-79"] += 1
        elif score >= 50:
            buckets["50-64"] += 1
        else:
            buckets["<50"] += 1
        watch[rec["theme"]] = watch.get(rec["theme"], 0) + 1
        if rec.get("decision") == "Avoid for now":
            poor[rec["symbol"]] = poor.get(rec["symbol"], 0) + 1
    return {
        "best_score_ranges": buckets,
        "best_setups": ["Orderly uptrend", "Near support with room to target", "Positive approved research"],
        "best_watchlists": sorted(watch.items(), key=lambda x: x[1], reverse=True)[:5],
        "poor_signals": sorted(poor.items(), key=lambda x: x[1], reverse=True)[:5],
        "outcome_patterns": "Rule-based MVP: add outcome checks over 2w, 4w, 6w, and 8w as recommendations age.",
    }


@app.get("/api/positions")
def positions() -> dict:
    with db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT p.*, t.symbol, t.company, i.price
                FROM positions p
                JOIN tickers t ON t.id = p.ticker_id
                LEFT JOIN indicators i ON i.ticker_id = t.id
                ORDER BY t.symbol
                """
            ).fetchall()
        )
    exposure: dict[str, float] = {}
    for row in rows:
        value = (row.get("price") or row["cost"]) * row["shares"]
        exposure[row["theme"]] = exposure.get(row["theme"], 0) + value
    total = sum(exposure.values()) or 1
    warnings = [f"{theme} is above 35% of tracked portfolio value." for theme, value in exposure.items() if value / total > 0.35]
    return {"positions": rows, "theme_exposure": exposure, "warnings": warnings}


@app.post("/api/positions")
def save_position(payload: PositionIn) -> dict:
    with db() as conn:
        ticker_id = upsert_ticker(conn, payload.ticker, theme=payload.theme)
        conn.execute(
            """
            INSERT INTO positions (ticker_id, shares, cost, theme)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(ticker_id) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, theme = excluded.theme
            """,
            (ticker_id, payload.shares, payload.cost, payload.theme),
        )
    return {"ok": True}


@app.post("/api/positions/import")
async def import_positions(file: UploadFile) -> dict:
    content = (await file.read()).decode("utf-8").splitlines()
    reader = csv.DictReader(content)
    imported = 0
    with db() as conn:
        for row in reader:
            symbol = (row.get("Ticker") or row.get("ticker") or "").strip()
            if not symbol:
                continue
            ticker_id = upsert_ticker(conn, symbol, theme=row.get("Theme") or row.get("theme") or "General")
            conn.execute(
                """
                INSERT INTO positions (ticker_id, shares, cost, theme)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(ticker_id) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, theme = excluded.theme
                """,
                (
                    ticker_id,
                    float(row.get("Shares") or row.get("shares") or 0),
                    float(row.get("Cost") or row.get("cost") or 0),
                    row.get("Theme") or row.get("theme") or "General",
                ),
            )
            imported += 1
    return {"imported": imported}


# ── Portfolio OS — import endpoint ────────────────────────────────────────────

class PortfolioImportIn(BaseModel):
    transactions: list[Dict[str, Any]]


def _recalculate_holding(conn, symbol: str) -> bool:
    """
    Recompute portfolio_holdings for a single symbol from all its stored
    transactions using the **average cost method**.

    Returns True if this is a brand-new holding (didn't exist before this call).
    """
    is_new = conn.execute(
        "SELECT 1 FROM portfolio_holdings WHERE symbol = ?", (symbol,)
    ).fetchone() is None

    txns = rows_to_dicts(
        conn.execute(
            "SELECT * FROM portfolio_transactions WHERE symbol = ? ORDER BY transaction_date, id",
            (symbol,),
        ).fetchall()
    )

    qty: float = 0.0
    avg_cost: float = 0.0
    total_cost: float = 0.0
    sources: set[str] = set()
    last_date: str | None = None

    for txn in txns:
        broker = txn.get("broker") or ""
        if broker:
            sources.add(broker)
        last_date = txn.get("transaction_date") or last_date

        t_type = txn.get("type") or "Other"
        t_qty   = abs(float(txn.get("quantity") or 0))
        t_price = txn.get("price")
        t_amount = txn.get("amount")

        buy_price: float = 0.0
        if t_price is not None and float(t_price) > 0:
            buy_price = abs(float(t_price))
        elif t_amount is not None and t_qty > 0:
            # price was null or 0 — derive from total amount (e.g. Robinhood fractional buys)
            buy_price = abs(float(t_amount)) / t_qty

        if t_type == "Buy" and t_qty > 0 and buy_price > 0:
            # Weighted-average cost
            total_cost = qty * avg_cost + t_qty * buy_price
            qty += t_qty
            avg_cost = total_cost / qty if qty > 0 else 0.0

        elif t_type == "Sell" and t_qty > 0:
            qty = max(0.0, qty - t_qty)
            total_cost = qty * avg_cost  # avg_cost stays the same

        # Dividend / Interest / Other do not affect qty or avg cost

    conn.execute(
        """
        INSERT INTO portfolio_holdings
            (symbol, quantity, avg_cost_basis, total_cost, sources, last_transaction_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            quantity             = excluded.quantity,
            avg_cost_basis       = excluded.avg_cost_basis,
            total_cost           = excluded.total_cost,
            sources              = excluded.sources,
            last_transaction_date = excluded.last_transaction_date,
            last_updated         = CURRENT_TIMESTAMP
        """,
        (
            symbol,
            round(qty, 6),
            round(avg_cost, 4),
            round(total_cost, 2),
            ",".join(s for s in sorted(sources) if s),
            last_date,
        ),
    )
    return is_new


@app.post("/api/portfolio/import")
def portfolio_import(payload: PortfolioImportIn) -> dict:
    """
    Accept an array of ParsedTransaction objects from the frontend service,
    persist them to portfolio_transactions (skipping exact duplicates),
    then recompute portfolio_holdings using the average-cost method.
    """
    saved = 0
    failed = 0
    skipped = 0
    affected: set[str] = set()
    type_counts: dict[str, int] = {}

    with db() as conn:
        for txn in payload.transactions:
            try:
                symbol = (txn.get("symbol") or "").strip().upper()
                if not symbol:
                    continue

                t_date  = txn.get("transaction_date") or ""
                t_type  = txn.get("type") or "Other"
                t_qty   = txn.get("quantity")
                t_price = txn.get("price")

                # Deduplicate: skip if an identical row already exists
                existing = conn.execute(
                    """SELECT id FROM portfolio_transactions
                       WHERE broker = ? AND transaction_date = ? AND symbol = ?
                         AND type = ? AND ABS(COALESCE(quantity,0) - ?) < 0.0001""",
                    (
                        txn.get("broker", ""),
                        t_date,
                        symbol,
                        t_type,
                        float(t_qty or 0),
                    ),
                ).fetchone()

                if existing:
                    skipped += 1
                    continue  # already imported

                conn.execute(
                    """
                    INSERT INTO portfolio_transactions
                        (broker, file_name, transaction_date, symbol, type,
                         quantity, price, amount, raw_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        txn.get("broker", ""),
                        txn.get("file_name", ""),
                        t_date,
                        symbol,
                        t_type,
                        float(t_qty)   if t_qty   is not None else None,
                        float(t_price) if t_price is not None else None,
                        float(txn["amount"]) if txn.get("amount") is not None else None,
                        json.dumps(txn.get("raw_row") or {}),
                    ),
                )
                affected.add(symbol)
                type_counts[t_type] = type_counts.get(t_type, 0) + 1
                saved += 1
            except Exception:
                failed += 1

    # Recalculate holdings for every symbol that received new transactions
    new_holdings: list[str] = []
    with db() as conn:
        for symbol in sorted(affected):
            try:
                if _recalculate_holding(conn, symbol):
                    new_holdings.append(symbol)
            except Exception:
                pass

    # Symbols seen in dividends/interest (user may own these even without buy records)
    div_symbols: list[str] = []
    if type_counts.get("Dividend", 0) > 0 or type_counts.get("Interest", 0) > 0:
        with db() as conn:
            rows = conn.execute(
                "SELECT DISTINCT symbol FROM portfolio_transactions WHERE type IN ('Dividend','Interest') AND symbol != 'CASH'"
            ).fetchall()
            div_symbols = [r[0] for r in rows]

    return {
        "saved": saved,
        "failed": failed,
        "skipped": skipped,
        "new_holdings": new_holdings,
        "type_counts": type_counts,
        "div_symbols": div_symbols,
        "has_buys": type_counts.get("Buy", 0) > 0,
    }


@app.post("/api/portfolio/parse-pdf")
async def parse_pdf_statement(file: UploadFile) -> dict:
    """
    Accept an E*TRADE monthly PDF statement, parse it with pdfplumber, and
    return the extracted transactions + holdings for client-side preview.

    The client can then POST the transactions to /api/portfolio/import as usual.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file received.")

    try:
        result = parse_etrade_pdf(pdf_bytes, file.filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PDF parsing failed: {exc}")

    return result


@app.get("/api/portfolio/holdings")
def get_portfolio_holdings() -> list[dict]:
    """Return all current portfolio holdings with average-cost data."""
    with db() as conn:
        holdings = rows_to_dicts(
            conn.execute(
                "SELECT * FROM portfolio_holdings ORDER BY symbol"
            ).fetchall()
        )
    # Enrich with full engine signal where available
    with db() as conn:
        for h in holdings:
            row = conn.execute(
                """SELECT t.theme,
                          i.price,
                          s.score, s.decision, s.confidence, s.risk,
                          s.entry_range, s.target1, s.invalidation_level,
                          s.distance_to_buy_zone, s.buy_zone_confluence,
                          s.suggested_action, s.summary,
                          s.improve_to_buy, s.hold_window
                   FROM tickers t
                   LEFT JOIN indicators i ON i.ticker_id = t.id
                   LEFT JOIN scores s ON s.id = (
                       SELECT id FROM scores WHERE ticker_id = t.id
                       ORDER BY as_of DESC LIMIT 1)
                   WHERE t.symbol = ?""",
                (h["symbol"],),
            ).fetchone()
            if row:
                h["theme"]                = row["theme"]
                h["current_price"]        = row["price"]
                h["score"]                = row["score"]
                h["decision"]             = row["decision"]
                h["confidence"]           = row["confidence"]
                h["risk"]                 = row["risk"]
                h["entry_range"]          = row["entry_range"]
                h["target1"]              = row["target1"]
                h["invalidation_level"]   = row["invalidation_level"]
                h["distance_to_buy_zone"] = row["distance_to_buy_zone"]
                h["buy_zone_confluence"]  = row["buy_zone_confluence"]
                h["suggested_action"]     = row["suggested_action"]
                h["summary"]              = row["summary"]
                h["improve_to_buy"]       = row["improve_to_buy"]
                h["hold_window"]          = row["hold_window"]
                if row["price"] and h.get("avg_cost_basis"):
                    h["unrealized_pnl_pct"] = round(
                        (row["price"] / h["avg_cost_basis"] - 1) * 100, 2
                    )
    return holdings


@app.get("/api/portfolio/transactions")
def get_portfolio_transactions(
    symbol: Optional[str] = None,
    type: Optional[str] = None,
    date_from: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    """Return raw imported transactions with optional symbol / type / date filters."""
    clauses: list[str] = []
    params: list[Any] = []

    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol.upper())
    if type:
        clauses.append("type = ?")
        params.append(type)
    if date_from:
        clauses.append("transaction_date >= ?")
        params.append(date_from)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)

    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                f"SELECT * FROM portfolio_transactions {where} ORDER BY transaction_date DESC LIMIT ?",
                params,
            ).fetchall()
        )


@app.post("/api/portfolio/recalculate")
def portfolio_recalculate() -> dict:
    """
    Rebuild portfolio_holdings from scratch for every symbol that has
    at least one transaction row.  Useful after manual edits or bulk imports.
    """
    with db() as conn:
        symbols = [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT symbol FROM portfolio_transactions WHERE symbol IS NOT NULL"
            ).fetchall()
        ]
        refreshed = 0
        for sym in symbols:
            _recalculate_holding(conn, sym)
            refreshed += 1
    return {"refreshed": refreshed, "symbols": symbols}


@app.post("/api/portfolio/refresh-signals")
def portfolio_refresh_signals() -> dict:
    """
    Fetch fresh engine analysis (indicators + scores) for every symbol
    currently in portfolio_holdings with qty > 0.

    Runs in the background-compatible way: the frontend should poll or
    wait on the response.  Skips news / snapshots so it finishes faster
    than a full refresh.
    """
    with db() as conn:
        symbols = [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT symbol FROM portfolio_holdings "
                "WHERE symbol IS NOT NULL AND symbol != 'CASH' AND quantity > 0"
            ).fetchall()
        ]

    if not symbols:
        return {"refreshed": [], "failed": [], "message": "No active holdings to refresh"}

    result = refresh_symbols_list(symbols)
    return {
        "refreshed": result["refreshed"],
        "failed": result["failed"],
        "refreshed_count": len(result["refreshed"]),
        "failed_count": len(result["failed"]),
    }


@app.get("/api/portfolio/summary")
def get_portfolio_summary() -> dict:
    """
    Aggregate portfolio_holdings into a single summary object.

    Fields returned:
      totalValue          – sum of (quantity × current_price) for priced holdings
      totalCost           – sum of total_cost across all holdings
      unrealizedPL        – totalValue − totalCost
      unrealizedPLPercent – (unrealizedPL / totalCost) × 100
      cashBalance         – total_cost for the synthetic CASH symbol (if present)
      topHoldings         – up to 10 holdings sorted by current market value desc
    """
    with db() as conn:
        holdings = rows_to_dicts(
            conn.execute("SELECT * FROM portfolio_holdings ORDER BY symbol").fetchall()
        )
        # Enrich with current price from engine
        for h in holdings:
            row = conn.execute(
                """SELECT i.price, s.score, s.decision
                   FROM tickers t
                   LEFT JOIN indicators i ON i.ticker_id = t.id
                   LEFT JOIN scores s ON s.id = (
                       SELECT id FROM scores WHERE ticker_id = t.id
                       ORDER BY as_of DESC LIMIT 1)
                   WHERE t.symbol = ?""",
                (h["symbol"],),
            ).fetchone()
            if row:
                h["current_price"] = row["price"]
                h["score"]         = row["score"]
                h["decision"]      = row["decision"]
                if row["price"] and h.get("avg_cost_basis"):
                    h["unrealized_pnl_pct"] = round(
                        (row["price"] / h["avg_cost_basis"] - 1) * 100, 2
                    )

    total_cost:  float = 0.0
    total_value: float = 0.0
    cash_balance: float = 0.0

    for h in holdings:
        cost = float(h.get("total_cost") or 0)
        qty  = float(h.get("quantity")   or 0)
        price = h.get("current_price")

        if h["symbol"] == "CASH":
            cash_balance += cost
            continue

        total_cost += cost
        if price and qty:
            total_value += qty * float(price)
        else:
            # Fall back to cost basis when no live price
            total_value += cost

    unrealized_pl = total_value - total_cost
    unrealized_pct = round((unrealized_pl / total_cost * 100), 2) if total_cost else 0.0

    # Top holdings by market value (descending)
    priced = [h for h in holdings if h["symbol"] != "CASH"]
    priced.sort(
        key=lambda h: (
            float(h.get("quantity") or 0) * float(h.get("current_price") or h.get("avg_cost_basis") or 0)
        ),
        reverse=True,
    )

    return {
        "totalValue":           round(total_value, 2),
        "totalCost":            round(total_cost, 2),
        "unrealizedPL":         round(unrealized_pl, 2),
        "unrealizedPLPercent":  unrealized_pct,
        "cashBalance":          round(cash_balance, 2),
        "topHoldings":          priced[:10],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Backtesting & Accuracy module (opt-in via enableBacktestingAccuracy)
# All endpoints are read-only or scoped to tracked_decisions; nothing here
# touches recommendation_snapshots or any other existing table.
# ─────────────────────────────────────────────────────────────────────────────

class TrackDecisionIn(BaseModel):
    snapshot_id: int
    notes: Optional[str] = None


class CloseDecisionIn(BaseModel):
    close_price: float
    notes: Optional[str] = None


@app.post("/api/backtesting/decisions")
def api_track_decision(payload: TrackDecisionIn) -> dict:
    """Track a recommendation snapshot as a decision the user wants to follow."""
    try:
        return backtesting.track_decision(payload.snapshot_id, payload.notes)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.get("/api/backtesting/decisions")
def api_list_decisions(status: Optional[str] = None) -> list[dict]:
    """List all tracked decisions (optionally filter by status: active|closed|archived)."""
    return backtesting.list_decisions(status=status)


@app.get("/api/backtesting/decisions/{decision_id}")
def api_get_decision(decision_id: int) -> dict:
    """Full decision detail with daily OHLC price path + signal context."""
    detail = backtesting.get_decision_detail(decision_id)
    if not detail:
        raise HTTPException(404, "Decision not found")
    return detail


@app.post("/api/backtesting/decisions/{decision_id}/close")
def api_close_decision(decision_id: int, payload: CloseDecisionIn) -> dict:
    """Manually close a tracked decision (e.g. user took a different exit)."""
    result = backtesting.close_decision_manually(
        decision_id, payload.close_price, payload.notes
    )
    if not result:
        raise HTTPException(404, "Decision not found")
    return result


@app.delete("/api/backtesting/decisions/{decision_id}")
def api_untrack_decision(decision_id: int) -> dict:
    ok = backtesting.untrack_decision(decision_id)
    if not ok:
        raise HTTPException(404, "Decision not found")
    return {"ok": True}


@app.post("/api/backtesting/evaluate-all")
def api_evaluate_all() -> dict:
    """Re-run the evaluator against every active decision (uses latest prices)."""
    closed = backtesting.evaluate_all_active()
    return {"newlyClosed": closed}


@app.get("/api/backtesting/dashboard")
def api_dashboard_metrics() -> dict:
    """Hero metrics for the Backtesting & Accuracy dashboard."""
    metrics = backtesting.get_dashboard_metrics()
    metrics["coachInsights"] = backtesting.get_coach_insights()
    return metrics


@app.get("/api/backtesting/calibration")
def api_calibration_curve() -> dict:
    """Predicted vs realized win rate, bucketed by setup quality."""
    return backtesting.get_calibration_curve()


@app.get("/api/backtesting/equity-curve")
def api_equity_curve(starting_capital: float = 1000.0) -> dict:
    """Cumulative simulated equity if you took every tracked decision."""
    return backtesting.get_equity_curve(starting_capital=starting_capital)


# ─────────────────────────────────────────────────────────────────────────────
# Static-file mounting (must be last)
# ─────────────────────────────────────────────────────────────────────────────

frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists():
    @app.get("/learning-insights")
    def learning_insights_page() -> FileResponse:
        return FileResponse(frontend_dist / "index.html")

    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


def open_browser() -> None:
    """
    Auto-open the user's default browser to the dashboard ~1.2 s after launch.

    Skipped silently when running inside Docker (KTRADE_DOCKER=1) — there's
    no display to open onto inside a container, and webbrowser.open() would
    emit confusing log noise. The Docker user reads the printed URL from
    `docker logs` and opens it themselves on the host.
    """
    if os.environ.get("KTRADE_DOCKER"):
        return
    time.sleep(1.2)
    port = int(os.environ.get("KTRADE_PORT", "8000"))
    try:
        webbrowser.open(f"http://127.0.0.1:{port}")
    except Exception:
        # Don't crash on headless / no-DISPLAY environments
        pass


if __name__ == "__main__":
    port = int(os.environ.get("KTRADE_PORT", "8000"))
    # In Docker we always bind 0.0.0.0; on local laptop we stay on loopback.
    host = "0.0.0.0" if os.environ.get("KTRADE_DOCKER") else "127.0.0.1"
    if not os.environ.get("KTRADE_DOCKER"):
        threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=False)
