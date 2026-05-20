"""
market_data.py
──────────────

Refresh pipeline that powers /api/refresh and the auto-refresh cron.

PERFORMANCE OVERHAUL (v2)
─────────────────────────
Previously this module did all work serially: one ticker at a time, each ticker
making 6 separate sequential HTTP round-trips to Yahoo. For 32 tickers that
meant ~192 sequential network calls plus a serial RSS-feed phase at the end —
typical refresh: 80 s to 3.5 min, scaling linearly with ticker count.

The new pipeline:

  PHASE A  Bootstrap (parallel)
    └── SPY + QQQ + IWM + VIX in a 4-thread pool (was serial)
    └── Compute market regime once, share across all tickers

  PHASE B  Bulk price download
    └── ONE call to yf.download([all symbols], threads=True) instead of
        N individual Ticker.history() calls — yfinance fans out internally

  PHASE C  Per-ticker analysis (8-thread pool)
    └── Each worker uses pre-fetched bulk history + cached info bundle.
    └── No more duplicate get_info() (saved one round-trip per ticker).
    └── Each worker has its own SQLite connection (SQLite serializes writes,
        so contention is minimal).
    └── 260 price inserts → single executemany() per ticker.

  PHASE D  News (fire-and-forget background thread)
    └── refresh_news() no longer blocks the response. Caller sees fresh
        cards immediately; news populates ~10–30 s later.

  CACHE
    All slow yfinance calls (info, insider, earnings_dates, eps_surprise)
    are wrapped by yfinance_cache.py with per-field TTLs. A second refresh
    in the same hour skips 90% of network entirely.

  PROGRESS
    refresh_all() accepts an optional `progress_callback(state)` so the
    refresh_engine job manager can stream per-ticker progress to the UI.

EXPECTED SPEEDUP
────────────────
  • Cold (empty cache):   ~6–8× faster vs old (32-ticker run: 90 s → 12-15 s)
  • Warm (cache hit):     ~15–25× faster (90 s → 4-6 s)
  • Scales sub-linearly:  55 tickers ≈ 20-25 s cold, 6-8 s warm
"""

from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable, Optional

import pandas as pd
import yfinance as yf

from .analysis import compute_indicators, market_condition
from .database import db, rows_to_dicts, upsert_ticker
from .fibonacci import cache_fib_zones
from .market_regime import analyze_market_regime
from .news import refresh_news
from .pivots import cache_pivots
from .recommendation_snapshots import save_snapshot
from .sector_relative_strength import get_sector_etf
from .technical_zone_analyzer import TechnicalZoneAnalyzer
from .yfinance_cache import (
    cache_get_or_fetch,
    yf_cached_history,
)
from .zones import cache_sr_zones

log = logging.getLogger("ktrade.refresh")


# ── Tunables ──────────────────────────────────────────────────────────────────
# 8 workers is the sweet spot — yfinance is network-bound so Python's GIL isn't
# an issue, but Yahoo will rate-limit you past ~10 concurrent connections.

MAX_WORKERS_TICKERS = 8     # per-ticker analysis pool
MAX_WORKERS_BOOTSTRAP = 4   # SPY/QQQ/IWM/VIX in parallel


# ── Phase A: Market bootstrap (parallel index fetch) ─────────────────────────

def _bootstrap_market(progress: Optional[Callable[[str], None]] = None) -> dict:
    """
    Fetch the broad-market reference data needed once per refresh.

    Returns: {
        spy_history, qqq_history, iwm_history,
        spy_ind, qqq_ind, iwm_ind,
        market,        # MarketCondition dataclass
        regime_data,   # dict from analyze_market_regime
    }
    """
    def _fetch_one(sym: str):
        return sym, yf_cached_history(sym, period="2y")

    histories: dict[str, pd.DataFrame] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_BOOTSTRAP) as pool:
        for sym, df in pool.map(_fetch_one, ["SPY", "QQQ", "IWM"]):
            histories[sym] = df if df is not None else pd.DataFrame()

    if progress:
        progress("Market indices loaded")

    spy_history = histories.get("SPY", pd.DataFrame())
    qqq_history = histories.get("QQQ", pd.DataFrame())
    iwm_history = histories.get("IWM", pd.DataFrame())

    spy_ind = compute_indicators(spy_history)
    qqq_ind = compute_indicators(qqq_history)
    iwm_ind = compute_indicators(iwm_history)
    market = market_condition(spy_ind, qqq_ind)
    regime_data = analyze_market_regime(spy_ind=spy_ind, qqq_ind=qqq_ind, iwm_ind=iwm_ind)

    return {
        "spy_history": spy_history,
        "qqq_history": qqq_history,
        "iwm_history": iwm_history,
        "spy_ind":     spy_ind,
        "qqq_ind":     qqq_ind,
        "iwm_ind":     iwm_ind,
        "market":      market,
        "regime_data": regime_data,
    }


# ── Phase B: Bulk price download ──────────────────────────────────────────────

def _bulk_history(symbols: list[str], period: str = "2y") -> dict[str, pd.DataFrame]:
    """
    Fetch OHLCV for every symbol with three layers of acceleration:

    1. **Cache lookup first** — pull anything still in TTL from yf_cache.
       On a warm-cache refresh this means ZERO network calls for histories
       that are <5 minutes old (the default TTL for price history).

    2. **Bulk download only the cache misses** — one yf.download call with
       Yahoo's internal threading instead of N individual Ticker.history().

    3. **Hot-fill the cache** with whatever we just fetched so subsequent
       calls (Portfolio Refresh Signals, single-ticker view, etc.) stay warm.

    Returns: { "AAPL": DataFrame, "MSFT": DataFrame, ... }
    """
    if not symbols:
        return {}

    out: dict[str, pd.DataFrame] = {}
    missing: list[str] = []
    for sym in symbols:
        sym_up = sym.upper()
        cached = yf_cached_history(sym_up, period=period)
        if cached is not None and not cached.empty:
            out[sym_up] = cached
        else:
            missing.append(sym_up)

    if not missing:
        return out  # 🎉 Everything served from cache, no network at all

    try:
        df = yf.download(
            missing,
            period=period,
            auto_adjust=False,
            progress=False,
            threads=True,
            group_by="ticker",
        )
    except Exception as exc:
        log.warning(f"_bulk_history: yf.download failed: {exc}")
        df = pd.DataFrame()

    if df is None or df.empty:
        # Bulk fetch failed entirely; leave `out` as what we already had from cache.
        return out

    # yf.download(list, group_by="ticker") returns a MultiIndex on columns
    # for BOTH single-symbol and multi-symbol inputs. We always pick the
    # top level (the ticker) so each symbol gets a flat (Open/High/Low/Close/...)
    # frame that compute_indicators can lower-case and address by name.
    from .yfinance_cache import cache_set
    try:
        for sym in missing:
            sub = pd.DataFrame()
            try:
                if isinstance(df.columns, pd.MultiIndex):
                    if sym in df.columns.get_level_values(0):
                        sub = df[sym]
                else:
                    # Single-symbol fallback — yfinance occasionally flattens
                    sub = df
            except KeyError:
                sub = pd.DataFrame()
            if sub is not None and not sub.empty:
                out[sym] = sub.dropna(how="all")
                cache_set("history", f"{sym}:{period}", out[sym])
    except Exception as exc:
        log.warning(f"_bulk_history: split failed: {exc}")

    return out


# ── Phase C: Per-ticker worker (parallel-safe) ────────────────────────────────

def _process_one_ticker(
    ticker_row: dict,
    bulk_history: pd.DataFrame,
    bootstrap: dict,
    sector_etf_cache: dict[str, pd.DataFrame],
    sector_etf_lock: threading.Lock,
    analyzer: TechnicalZoneAnalyzer,
    save_snapshot_enabled: bool,
) -> dict:
    """
    Process exactly one ticker end-to-end. Designed to run in a worker thread.

    Returns: {"symbol": str, "ok": bool, "reason": str | None, "snapshot": bool}
    """
    symbol = ticker_row["symbol"]
    snapshot_saved = False

    try:
        # 1. Resolve history. Prefer the bulk-downloaded one; fall back to cache.
        history = bulk_history if (bulk_history is not None and not bulk_history.empty) \
                  else yf_cached_history(symbol, period="2y")
        if history is None or history.empty:
            return {"symbol": symbol, "ok": False, "reason": "no price data", "snapshot": False}

        # 2. Pre-fetched info bundle (cached, so usually 0 network calls).
        info = analyzer.fetch_info_bundle(symbol)

        # 3. Sector ETF history — shared across same-sector tickers.
        sector_etf_hist: Optional[pd.DataFrame] = None
        sector = (info.get("_raw_info") or {}).get("sector")
        etf_sym = get_sector_etf(sector) if sector else None
        if etf_sym:
            with sector_etf_lock:
                if etf_sym not in sector_etf_cache:
                    etf_hist = yf_cached_history(etf_sym, period="2y")
                    sector_etf_cache[etf_sym] = etf_hist if etf_hist is not None else pd.DataFrame()
                sector_etf_hist = sector_etf_cache[etf_sym]

        # 4. Research signals (DB read, own connection — SQLite thread-safe per conn).
        with db() as conn:
            signals = rows_to_dicts(
                conn.execute(
                    "SELECT * FROM research_signals WHERE ticker_id = ? ORDER BY created_at",
                    (ticker_row["id"],),
                ).fetchall()
            )

        # 5. Full analysis. `info` is passed in so the analyzer doesn't refetch.
        analysis = analyzer.analyze(
            symbol,
            history=history,
            spy_history=bootstrap["spy_history"],
            research_signals=signals,
            regime_data=bootstrap["regime_data"],
            sector_etf_history=sector_etf_hist,
            info=info,
        )

        # 6. Persist the snapshot.
        if save_snapshot_enabled:
            try:
                save_snapshot(symbol, analysis)
                snapshot_saved = True
            except Exception as exc:
                log.info(f"snapshot save failed for {symbol}: {exc}")

        # 7. Write all derived data in one transaction.
        _persist_analysis_to_db(ticker_row, analysis, bootstrap["market"])

        return {"symbol": symbol, "ok": True, "reason": None, "snapshot": snapshot_saved}

    except Exception as exc:
        log.warning(f"refresh failed for {symbol}: {exc}")
        return {"symbol": symbol, "ok": False, "reason": str(exc), "snapshot": False}


def _persist_analysis_to_db(ticker_row: dict, analysis, market) -> None:
    """Write prices (batch), indicators, scores, recommendations in one transaction."""
    history    = analysis.history
    info       = analysis.info
    indicators = analysis.indicators
    score      = analysis.score

    cache_pivots(ticker_row["id"], analysis.pivots)
    cache_fib_zones(ticker_row["id"], analysis.fib_setup, analysis.fib_zones)
    cache_sr_zones(ticker_row["id"], analysis.sr_zones)

    # Batch the 260 price rows into ONE executemany — was 260 individual INSERTs.
    price_rows = []
    for date, row in history.tail(260).iterrows():
        price_rows.append((
            ticker_row["id"],
            date.strftime("%Y-%m-%d"),
            float(row.get("Open", 0) or 0),
            float(row.get("High", 0) or 0),
            float(row.get("Low", 0) or 0),
            float(row.get("Close", 0) or 0),
            float(row.get("Volume", 0) or 0),
        ))

    with db() as conn:
        if info.get("company") or info.get("asset_type"):
            conn.execute(
                "UPDATE tickers SET company = COALESCE(?, company), asset_type = COALESCE(?, asset_type) WHERE id = ?",
                (info.get("company"), info.get("asset_type"), ticker_row["id"]),
            )

        conn.executemany(
            """
            INSERT OR REPLACE INTO prices (ticker_id, date, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            price_rows,
        )

        conn.execute(
            """
            INSERT OR REPLACE INTO indicators
            (ticker_id, as_of, price, ma20, ma50, ma200, bb_upper, bb_lower, bb_width_pct,
             rsi, rsi_interpretation, macd, macd_signal,
             macd_histogram, macd_trend, momentum_score, momentum_summary, momentum_divergence,
             adx, plus_di, minus_di, adx_interpretation, trend_direction, obv, obv_trend, volume_vs_20d,
             rising_volume_on_up_days, trend_alignment, trend_strength_score, trend_strength_label, trend_strength_summary,
             volume_confirmation, volume_confirmation_score, volume_confirmation_summary,
             atr, volume_ratio, relative_strength,
             support, resistance, distance_to_support, distance_to_resistance, pattern_signal, earnings_date,
             earnings_signal_json, sector_rs_signal_json, regime_signal_json,
             insider_signal_json, fundamentals_signal_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticker_row["id"], indicators.get("as_of"),
                indicators.get("price"), indicators.get("ma20"), indicators.get("ma50"), indicators.get("ma200"),
                indicators.get("bb_upper"), indicators.get("bb_lower"), indicators.get("bb_width_pct"),
                indicators.get("rsi"), indicators.get("rsi_interpretation"),
                indicators.get("macd"), indicators.get("macd_signal"),
                indicators.get("macd_histogram"), indicators.get("macd_trend"),
                indicators.get("momentum_score"), indicators.get("momentum_summary"), indicators.get("momentum_divergence"),
                indicators.get("adx"), indicators.get("plus_di"), indicators.get("minus_di"),
                indicators.get("adx_interpretation"), indicators.get("trend_direction"),
                indicators.get("obv"), indicators.get("obv_trend"), indicators.get("volume_vs_20d"),
                1 if indicators.get("rising_volume_on_up_days") else 0,
                indicators.get("trend_alignment"), indicators.get("trend_strength_score"),
                indicators.get("trend_strength_label"), indicators.get("trend_strength_summary"),
                indicators.get("volume_confirmation"), indicators.get("volume_confirmation_score"),
                indicators.get("volume_confirmation_summary"),
                indicators.get("atr"), indicators.get("volume_ratio"), indicators.get("relative_strength"),
                indicators.get("support"), indicators.get("resistance"),
                indicators.get("distance_to_support"), indicators.get("distance_to_resistance"),
                indicators.get("pattern_signal"), indicators.get("earnings_date"),
                json.dumps({k: indicators.get(k) for k in [
                    "days_to_earnings", "earnings_score_modifier",
                    "earnings_label", "earnings_summary",
                ]}),
                json.dumps({k: indicators.get(k) for k in [
                    "sector_etf", "sector_rs_13w", "sector_rs_26w", "sector_rs_52w",
                    "sector_rs_score_modifier", "sector_rs_label", "sector_rs_summary",
                ]}),
                json.dumps({k: indicators.get(k) for k in [
                    "regime_label", "regime_vix", "regime_breadth_score",
                    "regime_score_modifier", "regime_summary",
                ]}),
                json.dumps({k: indicators.get(k) for k in [
                    "insider_buy_count", "insider_sell_count", "insider_net_value",
                    "insider_score_modifier", "insider_label", "insider_summary",
                ]}),
                json.dumps({k: indicators.get(k) for k in [
                    "fundamentals_pe", "fundamentals_revenue_growth",
                    "fundamentals_profit_margin", "fundamentals_debt_to_equity",
                    "fundamentals_eps_growth", "fundamentals_score_modifier",
                    "fundamentals_label", "fundamentals_summary",
                ]}),
            ),
        )
        as_of = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            INSERT OR REPLACE INTO scores
            (ticker_id, as_of, score, decision, confidence, risk, trend_label, momentum_label, volume_label,
             news_label, summary, suggested_action, entry_range, invalidation_level, target1, target2,
             distance_to_buy_zone, buy_zone_confluence, setup_factor_scores, setup_positive_factors,
             setup_concern_factors, decision_reasons, risk_reward_summary, improve_to_buy,
             buy_zone_explanation, target_zone_explanation,
             fresh_high_targets, fresh_high_target_note,
             trend_strength_summary, momentum_summary, macd_trend, volume_confirmation_summary, hold_window, why_rating, changes_view)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticker_row["id"], as_of,
                score["score"], score["decision"], score["confidence"], score["risk"],
                score["trend_label"], score["momentum_label"], score["volume_label"],
                score["news_label"], score["summary"], score["suggested_action"],
                score["entry_range"], score["invalidation_level"],
                score["target1"], score["target2"],
                score["distance_to_buy_zone"], score["buy_zone_confluence"],
                json.dumps(score.get("setup_factor_scores") or []),
                json.dumps(score.get("setup_positive_factors") or []),
                json.dumps(score.get("setup_concern_factors") or []),
                json.dumps(score.get("decision_reasons") or []),
                score.get("risk_reward_summary"), score.get("improve_to_buy"),
                score["buy_zone_explanation"], score["target_zone_explanation"],
                1 if score.get("fresh_high_targets") else 0,
                score.get("fresh_high_target_note"),
                score.get("trend_strength_summary"), score.get("momentum_summary"),
                score.get("macd_trend"), score.get("volume_confirmation_summary"),
                score["hold_window"], score["why_rating"], score["changes_view"],
            ),
        )
        conn.execute(
            """
            INSERT INTO recommendations
            (ticker_id, price, score, decision, entry_range, invalidation_level, target1, target2, market_condition, explanation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticker_row["id"], indicators.get("price"),
                score["score"], score["decision"],
                score["entry_range"], score["invalidation_level"],
                score["target1"], score["target2"],
                market.label, score["summary"],
            ),
        )


# ── Public entry points ───────────────────────────────────────────────────────

def fetch_history(symbol: str, period: str = "2y") -> tuple[pd.DataFrame, dict]:
    """Compatibility wrapper for one-off callsites. Cached via yfinance_cache."""
    analyzer = TechnicalZoneAnalyzer(period=period)
    df = analyzer.fetch_history(symbol)
    if df is None:
        df = pd.DataFrame()
    info = analyzer.fetch_info_bundle(symbol) if not df.empty else {}
    return df, info


def refresh_all(
    progress_callback: Optional[Callable[[dict], None]] = None,
    *,
    do_news: bool = True,
    background_news: bool = True,
) -> dict:
    """
    Main refresh entry point.

    progress_callback(state)
        Called from worker threads as each ticker completes. State dict shape:
            {"phase": "bootstrap" | "ticker" | "complete",
             "current": str | None, "completed": int, "total": int,
             "ok": bool, "reason": str | None}

    do_news
        Whether to refresh RSS at all.

    background_news
        When True (default), refresh_news() runs in a daemon thread and
        refresh_all() returns immediately after tickers are done.
        When False, news is fetched synchronously and included in the return.
    """
    started = datetime.now(timezone.utc)

    with db() as conn:
        # Only refresh tickers that belong to at least one ACTIVE watchlist.
        # Inactive watchlists are skipped — saves Yahoo round-trips and keeps
        # the dashboard in sync with what the user actually wants tracked.
        tickers = rows_to_dicts(conn.execute(
            """
            SELECT t.* FROM tickers t
            WHERE t.id IN (
                SELECT wt.ticker_id FROM watchlist_tickers wt
                JOIN watchlists w ON w.id = wt.watchlist_id
                WHERE w.active = 1
            )
            ORDER BY t.symbol
            """
        ).fetchall())

    if not tickers:
        return {"refreshed": [], "failed": [], "snapshots_saved": 0,
                "market": {}, "news": {}, "duration_seconds": 0.0}

    # ── PHASE A: Bootstrap market reference data ──────────────────────────────
    if progress_callback:
        progress_callback({"phase": "bootstrap", "current": None,
                           "completed": 0, "total": len(tickers), "ok": True, "reason": None})
    bootstrap = _bootstrap_market()

    # ── PHASE B: Bulk price history fetch (one yf.download call) ──────────────
    symbols = [t["symbol"] for t in tickers]
    bulk = _bulk_history(symbols, period="2y")
    if progress_callback:
        progress_callback({"phase": "ticker", "current": None,
                           "completed": 0, "total": len(tickers), "ok": True,
                           "reason": f"Bulk history: {len(bulk)}/{len(symbols)} loaded"})

    # ── PHASE C: Parallel per-ticker analysis ─────────────────────────────────
    refreshed: list[str] = []
    failed: list[dict] = []
    snapshots_saved = 0
    sector_etf_cache: dict[str, pd.DataFrame] = {}
    sector_etf_lock = threading.Lock()
    analyzer = TechnicalZoneAnalyzer(period="2y")

    completed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_TICKERS) as pool:
        future_to_ticker = {
            pool.submit(
                _process_one_ticker,
                ticker,
                bulk.get(ticker["symbol"], pd.DataFrame()),
                bootstrap,
                sector_etf_cache,
                sector_etf_lock,
                analyzer,
                True,  # save_snapshot_enabled
            ): ticker
            for ticker in tickers
        }
        for fut in as_completed(future_to_ticker):
            result = fut.result()
            completed += 1
            if result["ok"]:
                refreshed.append(result["symbol"])
                if result["snapshot"]:
                    snapshots_saved += 1
            else:
                failed.append({"symbol": result["symbol"], "reason": result["reason"]})
            if progress_callback:
                progress_callback({
                    "phase":      "ticker",
                    "current":    result["symbol"],
                    "completed":  completed,
                    "total":      len(tickers),
                    "ok":         result["ok"],
                    "reason":     result["reason"],
                })

    # ── PHASE D: Persist market state + (optionally) kick off news ────────────
    market = bootstrap["market"]
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('market_condition', ?)", (market.label,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('market_explanation', ?)", (market.explanation,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh', ?)", (datetime.now(timezone.utc).isoformat(),))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh_failed_count', ?)", (str(len(failed)),))
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh_error', ?)",
            ("; ".join(f"{item['symbol']}: {item['reason']}" for item in failed[:6]),),
        )

    news: dict = {}
    if do_news:
        if background_news:
            threading.Thread(target=_refresh_news_safely, daemon=True, name="news-refresh").start()
        else:
            news = _refresh_news_safely() or {}

    duration = (datetime.now(timezone.utc) - started).total_seconds()
    if progress_callback:
        progress_callback({
            "phase":     "complete",
            "current":   None,
            "completed": completed,
            "total":     len(tickers),
            "ok":        True,
            "reason":    f"Done in {duration:.1f}s",
        })

    return {
        "refreshed":        refreshed,
        "failed":           failed,
        "snapshots_saved":  snapshots_saved,
        "market":           market.__dict__,
        "news":             news,
        "duration_seconds": round(duration, 2),
    }


def _refresh_news_safely() -> Optional[dict]:
    try:
        return refresh_news()
    except Exception as exc:
        log.info(f"news refresh failed: {exc}")
        return None


def refresh_symbols_list(symbols: list[str]) -> dict:
    """
    Run analysis for a subset of symbols (used by Portfolio OS / Refresh Signals).
    No news, no recommendations table writes — just indicators + scores.

    Now uses the same parallel infrastructure as refresh_all.
    """
    if not symbols:
        return {"refreshed": [], "failed": []}

    normalized = [s.strip().upper() for s in symbols if s.strip()]
    if not normalized:
        return {"refreshed": [], "failed": []}

    with db() as conn:
        for sym in normalized:
            upsert_ticker(conn, sym)
        placeholders = ",".join("?" * len(normalized))
        ticker_rows = rows_to_dicts(
            conn.execute(
                f"SELECT * FROM tickers WHERE symbol IN ({placeholders})",
                normalized,
            ).fetchall()
        )
    if not ticker_rows:
        return {"refreshed": [], "failed": []}

    bootstrap = _bootstrap_market()
    bulk = _bulk_history([t["symbol"] for t in ticker_rows], period="2y")
    sector_etf_cache: dict[str, pd.DataFrame] = {}
    sector_etf_lock = threading.Lock()
    analyzer = TechnicalZoneAnalyzer(period="2y")

    refreshed: list[str] = []
    failed: list[dict] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS_TICKERS) as pool:
        futures = [
            pool.submit(
                _process_one_ticker,
                ticker,
                bulk.get(ticker["symbol"], pd.DataFrame()),
                bootstrap,
                sector_etf_cache,
                sector_etf_lock,
                analyzer,
                False,  # don't save snapshots for this lighter pipeline
            )
            for ticker in ticker_rows
        ]
        for fut in as_completed(futures):
            r = fut.result()
            if r["ok"]:
                refreshed.append(r["symbol"])
            else:
                failed.append({"symbol": r["symbol"], "reason": r["reason"]})

    return {"refreshed": refreshed, "failed": failed}


def refresh_if_empty() -> None:
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM indicators").fetchone()[0]
    if count == 0:
        try:
            refresh_all(background_news=False)
        except Exception:
            pass
