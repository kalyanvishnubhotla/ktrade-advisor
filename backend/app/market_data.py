from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from .analysis import compute_indicators, market_condition
from .database import db, rows_to_dicts, upsert_ticker
from .fibonacci import cache_fib_zones
from .news import refresh_news
from .pivots import cache_pivots
from .technical_zone_analyzer import TechnicalZoneAnalyzer
from .zones import cache_sr_zones


def fetch_history(symbol: str, period: str = "2y") -> tuple[pd.DataFrame, dict]:
    return TechnicalZoneAnalyzer(period=period).fetch_latest_data(symbol)


def refresh_all() -> dict:
    refreshed: list[str] = []
    failed: list[dict] = []
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
                    (ticker_id, as_of, price, ma20, ma50, ma200, rsi, macd, atr, volume_ratio, relative_strength,
                     support, resistance, distance_to_support, distance_to_resistance, pattern_signal, earnings_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ticker["id"],
                        ind.get("as_of"),
                        ind.get("price"),
                        ind.get("ma20"),
                        ind.get("ma50"),
                        ind.get("ma200"),
                        ind.get("rsi"),
                        ind.get("macd"),
                        ind.get("atr"),
                        ind.get("volume_ratio"),
                        ind.get("relative_strength"),
                        ind.get("support"),
                        ind.get("resistance"),
                        ind.get("distance_to_support"),
                        ind.get("distance_to_resistance"),
                        ind.get("pattern_signal"),
                        None,
                    ),
                )
                as_of = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT OR REPLACE INTO scores
                    (ticker_id, as_of, score, decision, confidence, risk, trend_label, momentum_label, volume_label,
                     news_label, summary, suggested_action, entry_range, invalidation_level, target1, target2,
                     distance_to_buy_zone, buy_zone_confluence, buy_zone_explanation, target_zone_explanation,
                     hold_window, why_rating, changes_view)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        score["buy_zone_explanation"],
                        score["target_zone_explanation"],
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
    return {"refreshed": refreshed, "failed": failed, "market": market.__dict__, "news": news}


def refresh_if_empty() -> None:
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM indicators").fetchone()[0]
    if count == 0:
        try:
            refresh_all()
        except Exception:
            pass
