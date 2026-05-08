from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from .analysis import compute_indicators, market_condition
from .database import db, rows_to_dicts, upsert_ticker
from .fibonacci import cache_fib_zones
from .news import refresh_news
from .pivots import cache_pivots
from .recommendation_snapshots import save_snapshot
from .technical_zone_analyzer import TechnicalZoneAnalyzer
from .zones import cache_sr_zones


def fetch_history(symbol: str, period: str = "2y") -> tuple[pd.DataFrame, dict]:
    return TechnicalZoneAnalyzer(period=period).fetch_latest_data(symbol)


def refresh_all() -> dict:
    refreshed: list[str] = []
    failed: list[dict] = []
    snapshots_saved = 0
    with db() as conn:
        tickers = rows_to_dicts(conn.execute("SELECT * FROM tickers ORDER BY symbol").fetchall())

    spy_history, _ = fetch_history("SPY")
    qqq_history, _ = fetch_history("QQQ")
    spy_ind = compute_indicators(spy_history)
    qqq_ind = compute_indicators(qqq_history)
    market = market_condition(spy_ind, qqq_ind)
    analyzer = TechnicalZoneAnalyzer(period="2y")

    for ticker in tickers:
        symbol = ticker["symbol"]
        try:
            with db() as conn:
                signals = rows_to_dicts(
                    conn.execute("SELECT * FROM research_signals WHERE ticker_id = ? ORDER BY created_at", (ticker["id"],)).fetchall()
                )
            analysis = analyzer.analyze(symbol, spy_history=spy_history, research_signals=signals)
            try:
                save_snapshot(symbol, analysis)
                snapshots_saved += 1
            except Exception as exc:
                failed.append({"symbol": symbol, "reason": f"Snapshot save failed: {exc}"})
            history = analysis.history
            info = analysis.info
            ind = analysis.indicators
            score = analysis.score
            cache_pivots(ticker["id"], analysis.pivots)
            cache_fib_zones(ticker["id"], analysis.fib_setup, analysis.fib_zones)
            cache_sr_zones(ticker["id"], analysis.sr_zones)
            with db() as conn:
                if info.get("company") or info.get("asset_type"):
                    conn.execute(
                        "UPDATE tickers SET company = COALESCE(?, company), asset_type = COALESCE(?, asset_type) WHERE id = ?",
                        (info.get("company"), info.get("asset_type"), ticker["id"]),
                    )
                for date, row in history.tail(260).iterrows():
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO prices (ticker_id, date, open, high, low, close, volume)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            ticker["id"],
                            date.strftime("%Y-%m-%d"),
                            float(row.get("Open", 0)),
                            float(row.get("High", 0)),
                            float(row.get("Low", 0)),
                            float(row.get("Close", 0)),
                            float(row.get("Volume", 0)),
                        ),
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
                     support, resistance, distance_to_support, distance_to_resistance, pattern_signal, earnings_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ticker["id"],
                        ind.get("as_of"),
                        ind.get("price"),
                        ind.get("ma20"),
                        ind.get("ma50"),
                        ind.get("ma200"),
                        ind.get("bb_upper"),
                        ind.get("bb_lower"),
                        ind.get("bb_width_pct"),
                        ind.get("rsi"),
                        ind.get("rsi_interpretation"),
                        ind.get("macd"),
                        ind.get("macd_signal"),
                        ind.get("macd_histogram"),
                        ind.get("macd_trend"),
                        ind.get("momentum_score"),
                        ind.get("momentum_summary"),
                        ind.get("momentum_divergence"),
                        ind.get("adx"),
                        ind.get("plus_di"),
                        ind.get("minus_di"),
                        ind.get("adx_interpretation"),
                        ind.get("trend_direction"),
                        ind.get("obv"),
                        ind.get("obv_trend"),
                        ind.get("volume_vs_20d"),
                        1 if ind.get("rising_volume_on_up_days") else 0,
                        ind.get("trend_alignment"),
                        ind.get("trend_strength_score"),
                        ind.get("trend_strength_label"),
                        ind.get("trend_strength_summary"),
                        ind.get("volume_confirmation"),
                        ind.get("volume_confirmation_score"),
                        ind.get("volume_confirmation_summary"),
                        ind.get("atr"),
                        ind.get("volume_ratio"),
                        ind.get("relative_strength"),
                        ind.get("support"),
                        ind.get("resistance"),
                        ind.get("distance_to_support"),
                        ind.get("distance_to_resistance"),
                        ind.get("pattern_signal"),
                        ind.get("earnings_date"),
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
                        ticker["id"],
                        as_of,
                        score["score"],
                        score["decision"],
                        score["confidence"],
                        score["risk"],
                        score["trend_label"],
                        score["momentum_label"],
                        score["volume_label"],
                        score["news_label"],
                        score["summary"],
                        score["suggested_action"],
                        score["entry_range"],
                        score["invalidation_level"],
                        score["target1"],
                        score["target2"],
                        score["distance_to_buy_zone"],
                        score["buy_zone_confluence"],
                        json.dumps(score.get("setup_factor_scores") or []),
                        json.dumps(score.get("setup_positive_factors") or []),
                        json.dumps(score.get("setup_concern_factors") or []),
                        json.dumps(score.get("decision_reasons") or []),
                        score.get("risk_reward_summary"),
                        score.get("improve_to_buy"),
                        score["buy_zone_explanation"],
                        score["target_zone_explanation"],
                        1 if score.get("fresh_high_targets") else 0,
                        score.get("fresh_high_target_note"),
                        score.get("trend_strength_summary"),
                        score.get("momentum_summary"),
                        score.get("macd_trend"),
                        score.get("volume_confirmation_summary"),
                        score["hold_window"],
                        score["why_rating"],
                        score["changes_view"],
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO recommendations
                    (ticker_id, price, score, decision, entry_range, invalidation_level, target1, target2, market_condition, explanation)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ticker["id"],
                        ind.get("price"),
                        score["score"],
                        score["decision"],
                        score["entry_range"],
                        score["invalidation_level"],
                        score["target1"],
                        score["target2"],
                        market.label,
                        score["summary"],
                    ),
                )
            refreshed.append(symbol)
        except Exception as exc:
            failed.append({"symbol": symbol, "reason": str(exc)})

    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('market_condition', ?)", (market.label,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('market_explanation', ?)", (market.explanation,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh', ?)", (datetime.now(timezone.utc).isoformat(),))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh_failed_count', ?)", (str(len(failed)),))
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_refresh_error', ?)",
            ("; ".join(f"{item['symbol']}: {item['reason']}" for item in failed[:6]),),
        )
    news = refresh_news()
    return {"refreshed": refreshed, "failed": failed, "snapshots_saved": snapshots_saved, "market": market.__dict__, "news": news}


def refresh_if_empty() -> None:
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM indicators").fetchone()[0]
    if count == 0:
        try:
            refresh_all()
        except Exception:
            pass
