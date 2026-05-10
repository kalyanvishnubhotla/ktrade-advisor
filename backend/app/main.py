from __future__ import annotations

import csv
import json
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

from .analysis import DISCLAIMER
from .database import ROOT, db, init_db, rows_to_dicts, seed_defaults, upsert_ticker
from .fibonacci import cached_fib_zones
from .market_data import refresh_all
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
    threading.Thread(target=safe_startup_refresh, daemon=True).start()


def safe_startup_refresh() -> None:
    try:
        refresh_all()
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
    return refresh_all()


@app.post("/api/news/refresh")
def refresh_news_endpoint() -> dict:
    return refresh_news()


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
    }


@app.patch("/api/settings/{key}")
def update_setting(key: str, payload: SettingIn) -> dict:
    allowed = {"show_beginner_price_help", "enablePortfolioOS"}
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


@app.post("/api/watchlists/{watchlist_id}/tickers")
def add_ticker(watchlist_id: int, payload: TickerIn) -> dict:
    with db() as conn:
        watchlist = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not watchlist:
            raise HTTPException(404, "Watchlist not found")
        ticker_id = upsert_ticker(conn, payload.symbol, payload.company, payload.theme or watchlist["theme"])
        conn.execute("INSERT OR IGNORE INTO watchlist_tickers VALUES (?, ?)", (watchlist_id, ticker_id))
    return {"ok": True}


@app.get("/api/tickers/{symbol}")
def ticker_detail(symbol: str) -> dict:
    normalized_symbol = symbol.upper().replace(" ", "")
    with db() as conn:
        ticker = conn.execute("SELECT * FROM tickers WHERE symbol = ?", (normalized_symbol,)).fetchone()
        if not ticker:
            raise HTTPException(404, "Ticker not found")
        ticker_id = ticker["id"]
        prices = rows_to_dicts(
            conn.execute("SELECT date, close, volume FROM prices WHERE ticker_id = ? ORDER BY date DESC LIMIT 180", (ticker_id,)).fetchall()
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

    return {
        "ticker": dict(ticker),
        "prices": list(reversed(prices)),
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


frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists():
    @app.get("/learning-insights")
    def learning_insights_page() -> FileResponse:
        return FileResponse(frontend_dist / "index.html")

    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


def open_browser() -> None:
    time.sleep(1.2)
    port = int(os.environ.get("KTRADE_PORT", "8000"))
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    port = int(os.environ.get("KTRADE_PORT", "8000"))
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=port, reload=False)
