from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import pandas as pd

from .database import db, rows_to_dicts


@dataclass
class Pivot:
    date: str
    price: float
    type: str
    strength: int
    timeframe: str
    touches: int
    lookback: int


def normalize_ohlc(history: pd.DataFrame) -> pd.DataFrame:
    df = history.copy()
    df.columns = [str(col).lower() for col in df.columns]
    needed = ["open", "high", "low", "close", "volume"]
    missing = [col for col in needed if col not in df.columns]
    if missing:
        raise ValueError(f"Missing OHLC columns: {', '.join(missing)}")
    df = df[needed].dropna(subset=["high", "low", "close"])
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    return df.sort_index()


def weekly_ohlc(history: pd.DataFrame) -> pd.DataFrame:
    df = normalize_ohlc(history)
    weekly = df.resample("W-FRI").agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    )
    return weekly.dropna(subset=["open", "high", "low", "close"])


def count_touches(df: pd.DataFrame, price: float, pivot_type: str, tolerance_pct: float = 1.0) -> int:
    if price <= 0:
        return 1
    tolerance = price * tolerance_pct / 100
    series = df["low"] if pivot_type == "low" else df["high"]
    return int(((series - price).abs() <= tolerance).sum())


def detect_swing_pivots(
    history: pd.DataFrame,
    lookback: int = 10,
    min_strength: int = 5,
    timeframe: str = "daily",
    tolerance_pct: float = 1.0,
) -> list[Pivot]:
    if lookback < 2:
        raise ValueError("lookback must be at least 2")
    df = weekly_ohlc(history) if timeframe == "weekly" else normalize_ohlc(history)
    if len(df) < lookback * 2 + 1:
        return []

    pivots: list[Pivot] = []
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    for index in range(lookback, len(df) - lookback):
        left = index - lookback
        right = index + lookback + 1
        date = df.index[index].strftime("%Y-%m-%d")

        high = float(highs[index])
        high_window = highs[left:right]
        if high == float(high_window.max()):
            lower_neighbors = int((high > high_window).sum())
            strength = lower_neighbors + lookback
            if strength >= min_strength:
                pivots.append(
                    Pivot(
                        date=date,
                        price=high,
                        type="high",
                        strength=strength,
                        timeframe=timeframe,
                        touches=count_touches(df, high, "high", tolerance_pct),
                        lookback=lookback,
                    )
                )

        low = float(lows[index])
        low_window = lows[left:right]
        if low == float(low_window.min()):
            higher_neighbors = int((low < low_window).sum())
            strength = higher_neighbors + lookback
            if strength >= min_strength:
                pivots.append(
                    Pivot(
                        date=date,
                        price=low,
                        type="low",
                        strength=strength,
                        timeframe=timeframe,
                        touches=count_touches(df, low, "low", tolerance_pct),
                        lookback=lookback,
                    )
                )
    return pivots


def detect_multi_timeframe_pivots(history: pd.DataFrame, lookbacks: tuple[int, ...] = (5, 10, 20)) -> list[Pivot]:
    pivots: list[Pivot] = []
    for lookback in lookbacks:
        pivots.extend(detect_swing_pivots(history, lookback=lookback, min_strength=lookback + 3, timeframe="daily"))
    for lookback in (5, 10):
        pivots.extend(detect_swing_pivots(history, lookback=lookback, min_strength=lookback + 3, timeframe="weekly", tolerance_pct=1.5))
    return dedupe_pivots(pivots)


def dedupe_pivots(pivots: list[Pivot]) -> list[Pivot]:
    best: dict[tuple[str, str, str], Pivot] = {}
    for pivot in pivots:
        key = (pivot.date, pivot.type, pivot.timeframe)
        existing = best.get(key)
        if existing is None or pivot.strength + pivot.touches > existing.strength + existing.touches:
            best[key] = pivot
    return sorted(best.values(), key=lambda item: (item.date, item.timeframe, item.type))


def pivot_rank(pivot: dict | Pivot) -> int:
    data = asdict(pivot) if isinstance(pivot, Pivot) else pivot
    timeframe_bonus = 30 if data["timeframe"] == "weekly" else 0
    return int(data["strength"]) + int(data["touches"]) * 2 + timeframe_bonus


def major_swings(pivots: list[dict] | list[Pivot], min_rank: int = 18, limit: int = 12) -> list[dict]:
    rows = [asdict(pivot) if isinstance(pivot, Pivot) else dict(pivot) for pivot in pivots]
    ranked = [row for row in rows if pivot_rank(row) >= min_rank or row["timeframe"] == "weekly"]
    return sorted(ranked, key=lambda row: (pivot_rank(row), row["date"]), reverse=True)[:limit]


def nearest_support_resistance(pivots: list[dict] | list[Pivot], price: float) -> tuple[float | None, float | None]:
    rows = major_swings(pivots, min_rank=14, limit=80)
    lows = [row for row in rows if row["type"] == "low" and float(row["price"]) < price]
    highs = [row for row in rows if row["type"] == "high" and float(row["price"]) > price]
    support = max(lows, key=lambda row: (float(row["price"]), pivot_rank(row))) if lows else None
    resistance = min(highs, key=lambda row: (float(row["price"]), -pivot_rank(row))) if highs else None
    return (float(support["price"]) if support else None, float(resistance["price"]) if resistance else None)


def cache_pivots(ticker_id: int, pivots: list[Pivot]) -> None:
    with db() as conn:
        conn.execute("DELETE FROM pivots WHERE ticker_id = ?", (ticker_id,))
        for pivot in pivots:
            conn.execute(
                """
                INSERT OR REPLACE INTO pivots
                (ticker_id, date, price, type, strength, timeframe, touches, lookback, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticker_id,
                    pivot.date,
                    pivot.price,
                    pivot.type,
                    pivot.strength,
                    pivot.timeframe,
                    pivot.touches,
                    pivot.lookback,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )


def cached_pivots(ticker_id: int, limit: int = 80) -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT date, price, type, strength, timeframe, touches, lookback
                FROM pivots
                WHERE ticker_id = ?
                ORDER BY date DESC
                LIMIT ?
                """,
                (ticker_id, limit),
            ).fetchall()
        )
