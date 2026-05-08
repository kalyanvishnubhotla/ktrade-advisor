from __future__ import annotations

import json
import math
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from dataclasses import asdict, is_dataclass
from typing import Any

from .database import db, rows_to_dicts


def money_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\$?([\d,]+(?:\.\d+)?)", str(value))
    return float(match.group(1).replace(",", "")) if match else None


def money_range(value: Any) -> tuple[float | None, float | None]:
    if not value:
        return None, None
    matches = re.findall(r"-?\$?([\d,]+(?:\.\d+)?)", str(value))
    if len(matches) < 2:
        return None, None
    values = [float(match.replace(",", "")) for match in matches[:2]]
    return min(values), max(values)


def serializable(value: Any) -> Any:
    if is_dataclass(value):
        return serializable(asdict(value))
    if isinstance(value, dict):
        return {key: serializable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [serializable(item) for item in value]
    if isinstance(value, tuple):
        return [serializable(item) for item in value]
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def extract_snapshot(ticker: str, analysis_result: Any) -> dict:
    if hasattr(analysis_result, "indicators"):
        indicators = analysis_result.indicators or {}
        score = analysis_result.score or {}
        pivots = getattr(analysis_result, "pivots", [])
        fib_zones = getattr(analysis_result, "fib_zones", [])
        sr_zones = getattr(analysis_result, "sr_zones", [])
    else:
        payload = analysis_result or {}
        indicators = payload.get("indicators") or payload.get("indicator") or payload
        score = payload.get("score") or payload.get("recommendation") or payload
        pivots = payload.get("pivots", [])
        fib_zones = payload.get("fib_zones", [])
        sr_zones = payload.get("sr_zones", [])

    buy_zone_low, buy_zone_high = money_range(score.get("entry_range"))
    snapshot = {
        "ticker": ticker.upper(),
        "current_price": float(indicators.get("price") or score.get("current_price") or 0),
        "setup_quality": int(round(score.get("buy_zone_confluence") or score.get("setup_quality") or score.get("score") or 0)),
        "recommended_action": score.get("decision") or score.get("recommended_action") or "Hold / no action",
        "buy_zone_low": buy_zone_low,
        "buy_zone_high": buy_zone_high,
        "risk_line": money_value(score.get("invalidation_level") or score.get("risk_line")),
        "review_target1": money_value(score.get("target1") or score.get("review_target1")),
        "review_target2": money_value(score.get("target2") or score.get("review_target2")),
        "distance_to_buy_pct": score.get("distance_to_buy_zone") or score.get("distance_to_buy_pct") or 0,
        "signal_summary": {
            "trend": score.get("trend_label"),
            "momentum": score.get("momentum_label"),
            "volume": score.get("volume_label"),
            "risk": score.get("risk"),
            "rsi": indicators.get("rsi"),
            "macd": indicators.get("macd"),
            "macd_signal": indicators.get("macd_signal"),
            "adx": indicators.get("adx"),
            "setup_quality": score.get("buy_zone_confluence"),
            "decision_reasons": score.get("decision_reasons"),
            "concerns": score.get("setup_concern_factors"),
        },
        "full_signals": {
            "indicators": indicators,
            "score": score,
            "pivots": serializable(pivots),
            "fib_zones": serializable(fib_zones),
            "sr_zones": serializable(sr_zones),
        },
    }
    if snapshot["current_price"] <= 0:
        raise ValueError("current_price is required for recommendation snapshot")
    if snapshot["setup_quality"] <= 0:
        raise ValueError("setup_quality is required for recommendation snapshot")
    return snapshot


def save_snapshot(ticker: str, analysis_result: Any, conn: sqlite3.Connection | None = None) -> None:
    snapshot = extract_snapshot(ticker, analysis_result)
    target = conn
    owns_connection = target is None
    if owns_connection:
        context = db()
        target = context.__enter__()
    try:
        target.execute(
            """
            INSERT INTO recommendation_snapshots
            (ticker, current_price, setup_quality, recommended_action, buy_zone_low, buy_zone_high,
             risk_line, review_target1, review_target2, distance_to_buy_pct, signal_summary, full_signals)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot["ticker"],
                snapshot["current_price"],
                snapshot["setup_quality"],
                snapshot["recommended_action"],
                snapshot["buy_zone_low"],
                snapshot["buy_zone_high"],
                snapshot["risk_line"],
                snapshot["review_target1"],
                snapshot["review_target2"],
                snapshot["distance_to_buy_pct"],
                json.dumps(snapshot["signal_summary"]),
                json.dumps(serializable(snapshot["full_signals"])),
            ),
        )
    finally:
        if owns_connection:
            context.__exit__(None, None, None)


def hydrate_snapshot(row: dict) -> dict:
    for key in ["signal_summary", "full_signals"]:
        value = row.get(key)
        if isinstance(value, str) and value:
            try:
                row[key] = json.loads(value)
            except json.JSONDecodeError:
                row[key] = {}
        elif value is None:
            row[key] = {}
    return row


def parse_snapshot_date(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def get_history_for_ticker(ticker: str, limit: int = 50) -> list[dict]:
    symbol = ticker.upper().replace(" ", "")
    with db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT *
                FROM recommendation_snapshots
                WHERE ticker = ?
                ORDER BY snapshot_date DESC
                LIMIT ?
                """,
                (symbol, limit),
            ).fetchall()
        )
    return [hydrate_snapshot(row) for row in rows]


def get_latest_snapshot(ticker: str) -> dict | None:
    history = get_history_for_ticker(ticker, limit=1)
    return history[0] if history else None


def mark_user_action(snapshot_id: int, action: str, notes: str | None = None) -> None:
    allowed = {"Bought", "Ignored", "Watched", "Sold"}
    if action not in allowed:
        raise ValueError(f"Unsupported action: {action}")
    with db() as conn:
        conn.execute(
            """
            UPDATE recommendation_snapshots
            SET user_action = ?, user_action_date = ?, notes = COALESCE(?, notes)
            WHERE id = ?
            """,
            (action, datetime.now(timezone.utc).isoformat(), notes, snapshot_id),
        )


def record_outcome(snapshot_id: int, actual_outcome_pct: float, hold_period_days: int | None = None) -> None:
    with db() as conn:
        conn.execute(
            """
            UPDATE recommendation_snapshots
            SET actual_outcome_pct = ?, hold_period_days = COALESCE(?, hold_period_days)
            WHERE id = ?
            """,
            (actual_outcome_pct, hold_period_days, snapshot_id),
        )


def later_price_window(conn: sqlite3.Connection, snapshot: dict) -> dict:
    row = conn.execute(
        """
        SELECT MIN(p.low) AS min_low, MIN(p.close) AS min_close,
               MAX(p.high) AS max_high, MAX(p.close) AS max_close
        FROM prices p
        JOIN tickers t ON t.id = p.ticker_id
        WHERE t.symbol = ? AND date(p.date) > date(?)
        """,
        (snapshot["ticker"], snapshot["snapshot_date"]),
    ).fetchone()
    return dict(row) if row else {}


def reached_buy_zone(snapshot: dict, window: dict) -> bool:
    low = snapshot.get("buy_zone_low")
    high = snapshot.get("buy_zone_high")
    if low is None or high is None:
        return False
    min_low = window.get("min_low")
    min_close = window.get("min_close")
    max_high = window.get("max_high")
    max_close = window.get("max_close")
    if (min_low is None and min_close is None) or (max_high is None and max_close is None):
        return False
    later_low = min(value for value in [min_low, min_close] if value is not None)
    later_high = max(value for value in [max_high, max_close] if value is not None)
    return later_low <= high and later_high >= low


def buy_zone_hit_after_snapshot(conn: sqlite3.Connection, snapshot: dict) -> bool:
    return reached_buy_zone(snapshot, later_price_window(conn, snapshot))


def reached_target1(snapshot: dict, window: dict) -> bool:
    target = snapshot.get("review_target1")
    if target is None:
        return False
    max_high = window.get("max_high")
    max_close = window.get("max_close")
    if max_high is None and max_close is None:
        return False
    later_high = max(value for value in [max_high, max_close] if value is not None)
    return later_high >= target


def breached_risk(snapshot: dict, window: dict) -> bool:
    risk = snapshot.get("risk_line")
    if risk is None:
        return False
    min_low = window.get("min_low")
    min_close = window.get("min_close")
    if min_low is None and min_close is None:
        return False
    later_low = min(value for value in [min_low, min_close] if value is not None)
    return later_low <= risk


def risk_protected_before_target(conn: sqlite3.Connection, snapshot: dict) -> bool:
    risk = snapshot.get("risk_line")
    target = snapshot.get("review_target1")
    if risk is None:
        return True
    rows = rows_to_dicts(
        conn.execute(
            """
            SELECT p.date, p.low, p.close, p.high
            FROM prices p
            JOIN tickers t ON t.id = p.ticker_id
            WHERE t.symbol = ? AND date(p.date) > date(?)
            ORDER BY p.date
            """,
            (snapshot["ticker"], snapshot["snapshot_date"]),
        ).fetchall()
    )
    for row in rows:
        low = min(value for value in [row.get("low"), row.get("close")] if value is not None)
        high = max(value for value in [row.get("high"), row.get("close")] if value is not None)
        if low <= risk:
            return False
        if target is not None and high >= target:
            return True
    return True


def pct(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def correlation(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denom_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs))
    denom_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys))
    if denom_x == 0 or denom_y == 0:
        return None
    return numerator / (denom_x * denom_y)


def calculate_accuracy_metrics(ticker: str | None = None) -> dict:
    with db() as conn:
        if ticker:
            symbol = ticker.upper().replace(" ", "")
            snapshots = rows_to_dicts(
                conn.execute(
                    "SELECT * FROM recommendation_snapshots WHERE ticker = ? ORDER BY snapshot_date DESC",
                    (symbol,),
                ).fetchall()
            )
        else:
            snapshots = rows_to_dicts(conn.execute("SELECT * FROM recommendation_snapshots ORDER BY snapshot_date DESC").fetchall())

        windows = [later_price_window(conn, snapshot) for snapshot in snapshots]

    total = len(snapshots)
    buy_zone_candidates = [index for index, snapshot in enumerate(snapshots) if snapshot.get("buy_zone_low") is not None and snapshot.get("buy_zone_high") is not None]
    target_candidates = [index for index, snapshot in enumerate(snapshots) if snapshot.get("review_target1") is not None]
    risk_candidates = [index for index, snapshot in enumerate(snapshots) if snapshot.get("risk_line") is not None]
    bought_outcomes = [
        float(snapshot["actual_outcome_pct"])
        for snapshot in snapshots
        if snapshot.get("user_action") == "Bought" and snapshot.get("actual_outcome_pct") is not None
    ]
    scored_outcomes = [
        (float(snapshot["setup_quality"]), float(snapshot["actual_outcome_pct"]))
        for snapshot in snapshots
        if snapshot.get("actual_outcome_pct") is not None
    ]
    corr = correlation([item[0] for item in scored_outcomes], [item[1] for item in scored_outcomes])
    calibration = round(max(0, min(100, ((corr or 0) + 1) * 50)), 1) if corr is not None else 0.0

    return {
        "totalSnapshots": total,
        "buyZoneHitRate": pct(sum(1 for index in buy_zone_candidates if reached_buy_zone(snapshots[index], windows[index])), len(buy_zone_candidates)),
        "target1HitRate": pct(sum(1 for index in target_candidates if reached_target1(snapshots[index], windows[index])), len(target_candidates)),
        "riskLineBreachRate": pct(sum(1 for index in risk_candidates if breached_risk(snapshots[index], windows[index])), len(risk_candidates)),
        "averageReturnWhenBought": round(sum(bought_outcomes) / len(bought_outcomes), 1) if bought_outcomes else 0.0,
        "calibrationScore": calibration,
    }


def calibration_buckets(snapshots: list[dict]) -> list[dict]:
    ranges = [(0, 49), (50, 64), (65, 74), (75, 84), (85, 100)]
    result = []
    bought = [snapshot for snapshot in snapshots if snapshot.get("user_action") == "Bought" and snapshot.get("actual_outcome_pct") is not None]
    for low, high in ranges:
        rows = [snapshot for snapshot in bought if low <= float(snapshot.get("setup_quality") or 0) <= high]
        if not rows:
            continue
        wins = len([snapshot for snapshot in rows if float(snapshot["actual_outcome_pct"]) > 0])
        result.append({"predictedRange": f"{low}-{high}", "actualSuccessRate": pct(wins, len(rows))})
    return result


def common_patterns(snapshots: list[dict], risk_protected_count: int, buy_zone_hits: int) -> list[str]:
    bought_with_outcomes = [snapshot for snapshot in snapshots if snapshot.get("user_action") == "Bought" and snapshot.get("actual_outcome_pct") is not None]
    wins = [snapshot for snapshot in bought_with_outcomes if float(snapshot["actual_outcome_pct"]) > 0]
    losses = [snapshot for snapshot in bought_with_outcomes if float(snapshot["actual_outcome_pct"]) <= 0]
    patterns: list[str] = []

    def share(rows: list[dict], key: str, value: str) -> float:
        if not rows:
            return 0
        return len([row for row in rows if (row.get("signal_summary") or {}).get(key) == value]) / len(rows)

    if share(wins, "volume", "Supportive") + share(wins, "volume", "Constructive") > share(losses, "volume", "Supportive") + share(losses, "volume", "Constructive"):
        patterns.append("Your profitable buys are more often helped by constructive volume.")
    if share(wins, "momentum", "Strong") > share(losses, "momentum", "Strong"):
        patterns.append("Strong momentum has been showing up more often in profitable buys.")
    if share(losses, "risk", "High") > share(wins, "risk", "High"):
        patterns.append("High-risk setups have been less reliable for you.")
    if buy_zone_hits and snapshots:
        patterns.append(f"Buy zones were reached in {pct(buy_zone_hits, len(snapshots))}% of recent snapshots.")
    if risk_protected_count and bought_with_outcomes:
        patterns.append(f"Risk protection held before target in {pct(risk_protected_count, len(bought_with_outcomes))}% of recorded buys.")
    return patterns[:5] or ["More recorded actions and outcomes are needed before patterns become meaningful."]


def get_learning_insights(ticker: str | None = None, days_back: int = 90) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    with db() as conn:
        if ticker:
            symbol = ticker.upper().replace(" ", "")
            rows = rows_to_dicts(
                conn.execute(
                    """
                    SELECT *
                    FROM recommendation_snapshots
                    WHERE ticker = ? AND datetime(snapshot_date) >= datetime(?)
                    ORDER BY snapshot_date DESC
                    """,
                    (symbol, cutoff.isoformat()),
                ).fetchall()
            )
        else:
            rows = rows_to_dicts(
                conn.execute(
                    """
                    SELECT *
                    FROM recommendation_snapshots
                    WHERE datetime(snapshot_date) >= datetime(?)
                    ORDER BY snapshot_date DESC
                    """,
                    (cutoff.isoformat(),),
                ).fetchall()
            )
        snapshots = [hydrate_snapshot(row) for row in rows]
        buy_zone_hits = sum(1 for snapshot in snapshots if buy_zone_hit_after_snapshot(conn, snapshot))
        risk_protected = sum(1 for snapshot in snapshots if snapshot.get("user_action") == "Bought" and risk_protected_before_target(conn, snapshot))

    bought = [snapshot for snapshot in snapshots if snapshot.get("user_action") == "Bought" and snapshot.get("actual_outcome_pct") is not None]
    wins = [snapshot for snapshot in bought if float(snapshot["actual_outcome_pct"]) > 0]
    high_quality = [snapshot for snapshot in bought if float(snapshot.get("setup_quality") or 0) >= 70]
    high_quality_wins = [snapshot for snapshot in high_quality if float(snapshot["actual_outcome_pct"]) > 0]
    returns = [float(snapshot["actual_outcome_pct"]) for snapshot in bought]
    ticker_rows: dict[str, dict] = {}
    for snapshot in snapshots:
        symbol = snapshot["ticker"]
        item = ticker_rows.setdefault(
            symbol,
            {
                "ticker": symbol,
                "snapshots": 0,
                "bought": 0,
                "wins": 0,
                "avgReturn": 0.0,
                "returns": [],
                "highQuality": 0,
                "highQualityWins": 0,
            },
        )
        item["snapshots"] += 1
        if snapshot.get("user_action") == "Bought" and snapshot.get("actual_outcome_pct") is not None:
            outcome = float(snapshot["actual_outcome_pct"])
            item["bought"] += 1
            item["returns"].append(outcome)
            if outcome > 0:
                item["wins"] += 1
            if float(snapshot.get("setup_quality") or 0) >= 70:
                item["highQuality"] += 1
                if outcome > 0:
                    item["highQualityWins"] += 1
    per_ticker = []
    for item in ticker_rows.values():
        item["winRate"] = pct(item["wins"], item["bought"])
        item["highQualityWinRate"] = pct(item["highQualityWins"], item["highQuality"])
        item["avgReturn"] = round(sum(item["returns"]) / len(item["returns"]), 1) if item["returns"] else 0.0
        del item["returns"]
        per_ticker.append(item)

    return {
        "overallWinRate": pct(len(wins), len(bought)),
        "avgReturn": round(sum(returns) / len(returns), 1) if returns else 0.0,
        "highQualityWinRate": pct(len(high_quality_wins), len(high_quality)),
        "calibration": calibration_buckets(snapshots),
        "commonPatterns": common_patterns(snapshots, risk_protected, buy_zone_hits),
        "perTickerPerformance": sorted(per_ticker, key=lambda row: (row["bought"], row["snapshots"]), reverse=True),
        "recentSnapshots": snapshots[:20],
    }


def similar_setup_memory(ticker: str, setup_quality: float | None) -> str | None:
    if setup_quality is None:
        return None
    symbol = ticker.upper().replace(" ", "")
    with db() as conn:
        row = conn.execute(
            """
            SELECT setup_quality, actual_outcome_pct, hold_period_days
            FROM recommendation_snapshots
            WHERE ticker = ?
              AND user_action = 'Bought'
              AND actual_outcome_pct IS NOT NULL
              AND setup_quality BETWEEN ? AND ?
            ORDER BY ABS(setup_quality - ?) ASC, snapshot_date DESC
            LIMIT 1
            """,
            (symbol, setup_quality - 7, setup_quality + 7, setup_quality),
        ).fetchone()
    if not row:
        return None
    outcome = float(row["actual_outcome_pct"])
    prefix = "+" if outcome > 0 else ""
    days = f" in {row['hold_period_days']} days" if row["hold_period_days"] else ""
    return f"Last similar setup (score {int(row['setup_quality'])}) returned {prefix}{outcome:.1f}%{days}."


def high_quality_accuracy_for_ticker(ticker: str, minimum_score: int = 70) -> float | None:
    symbol = ticker.upper().replace(" ", "")
    with db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT actual_outcome_pct
                FROM recommendation_snapshots
                WHERE ticker = ?
                  AND user_action = 'Bought'
                  AND actual_outcome_pct IS NOT NULL
                  AND setup_quality >= ?
                """,
                (symbol, minimum_score),
            ).fetchall()
        )
    if not rows:
        return None
    wins = len([row for row in rows if float(row["actual_outcome_pct"]) > 0])
    return pct(wins, len(rows))
