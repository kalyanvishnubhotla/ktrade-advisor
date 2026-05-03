from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

import pandas as pd

from .database import db, rows_to_dicts
from .pivots import Pivot, major_swings, pivot_rank


FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0]


@dataclass
class FibSetup:
    direction: str
    start_date: str
    start_price: float
    end_date: str
    end_price: float
    swing_pct: float


@dataclass
class FibZone:
    level_name: str
    ratio_low: float
    ratio_high: float
    price_low: float
    price_high: float
    snapped_price_low: float | None
    snapped_price_high: float | None
    confluence_note: str


def calculate_fib_levels(start_price: float, end_price: float) -> dict[float, float]:
    diff = end_price - start_price
    if diff == 0:
        return {ratio: float(start_price) for ratio in FIB_RATIOS}
    if diff > 0:
        return {ratio: float(end_price - abs(diff) * ratio) for ratio in FIB_RATIOS}
    return {ratio: float(end_price + abs(diff) * ratio) for ratio in FIB_RATIOS}


def calculate_fib_extensions(start_price: float, end_price: float) -> dict[float, float]:
    diff = end_price - start_price
    return {
        1.272: float(end_price + diff * 0.272),
        1.618: float(end_price + diff * 0.618),
    }


def normalized_pivots(pivots: list[dict] | list[Pivot]) -> list[dict]:
    rows = [asdict(pivot) if isinstance(pivot, Pivot) else dict(pivot) for pivot in pivots]
    return sorted(rows, key=lambda row: row["date"])


def identify_recent_fib_setup(
    pivots: list[dict] | list[Pivot],
    as_of: str | None = None,
    min_months: int = 3,
    max_months: int = 12,
) -> FibSetup | None:
    rows = major_swings(normalized_pivots(pivots), min_rank=14, limit=120)
    if not rows:
        return None
    end_date = datetime.fromisoformat(as_of).date() if as_of else datetime.now(timezone.utc).date()
    min_days = min_months * 21
    max_days = max_months * 31
    candidates = []
    ordered = sorted(rows, key=lambda row: row["date"])
    for start in ordered:
        start_day = datetime.fromisoformat(start["date"]).date()
        if (end_date - start_day).days > max_days:
            continue
        for end in ordered:
            end_day = datetime.fromisoformat(end["date"]).date()
            age = (end_date - end_day).days
            duration = (end_day - start_day).days
            if end_day <= start_day or age > max_days or duration < min_days or duration > max_days:
                continue
            if start["type"] == "low" and end["type"] == "high" and end["price"] > start["price"]:
                direction = "up"
            elif start["type"] == "high" and end["type"] == "low" and start["price"] > end["price"]:
                direction = "down"
            else:
                continue
            swing_pct = abs(float(end["price"]) / float(start["price"]) - 1) * 100
            score = swing_pct + pivot_rank(start) * 0.08 + pivot_rank(end) * 0.08
            candidates.append((score, swing_pct, start, end, direction))
    if not candidates:
        recent_cutoff = end_date - timedelta(days=max_days)
        recent = [row for row in ordered if datetime.fromisoformat(row["date"]).date() >= recent_cutoff]
        if len(recent) < 2:
            return None
        start = min(recent, key=lambda row: float(row["price"]))
        end = max(recent, key=lambda row: float(row["price"]))
        if start["date"] < end["date"]:
            direction = "up"
            swing_pct = abs(float(end["price"]) / float(start["price"]) - 1) * 100
            return FibSetup(direction, start["date"], float(start["price"]), end["date"], float(end["price"]), swing_pct)
        direction = "down"
        swing_pct = abs(float(start["price"]) / float(end["price"]) - 1) * 100
        return FibSetup(direction, end["date"], float(end["price"]), start["date"], float(start["price"]), swing_pct)

    _, swing_pct, start, end, direction = max(candidates, key=lambda item: item[0])
    return FibSetup(direction, start["date"], float(start["price"]), end["date"], float(end["price"]), swing_pct)


def nearest_pivot_price(price: float, pivots: list[dict] | list[Pivot], tolerance_pct: float = 1.25) -> tuple[float | None, str]:
    if price <= 0:
        return None, ""
    rows = major_swings(normalized_pivots(pivots), min_rank=14, limit=100)
    nearby = []
    for pivot in rows:
        distance_pct = abs(float(pivot["price"]) / price - 1) * 100
        if distance_pct <= tolerance_pct:
            nearby.append((distance_pct, pivot_rank(pivot), pivot))
    if not nearby:
        return None, ""
    _, _, pivot = min(nearby, key=lambda item: (item[0], -item[1]))
    note = f"snapped to {pivot['timeframe']} pivot {pivot['type']} from {pivot['date']}"
    return float(pivot["price"]), note


def build_fib_zones(setup: FibSetup, pivots: list[dict] | list[Pivot]) -> list[FibZone]:
    levels = calculate_fib_levels(setup.start_price, setup.end_price)
    raw_zones = [
        ("Shallow pullback", 0.236, 0.382),
        ("Golden Zone", 0.5, 0.618),
        ("Deep retracement", 0.618, 0.786),
        ("Full retracement risk", 0.786, 1.0),
    ]
    zones = []
    for name, low_ratio, high_ratio in raw_zones:
        a = levels[low_ratio]
        b = levels[high_ratio]
        price_low = min(a, b)
        price_high = max(a, b)
        snapped_low, low_note = nearest_pivot_price(price_low, pivots)
        snapped_high, high_note = nearest_pivot_price(price_high, pivots)
        notes = "; ".join(note for note in [low_note, high_note] if note)
        zones.append(
            FibZone(
                level_name=name,
                ratio_low=low_ratio,
                ratio_high=high_ratio,
                price_low=price_low,
                price_high=price_high,
                snapped_price_low=snapped_low,
                snapped_price_high=snapped_high,
                confluence_note=notes,
            )
        )
    return zones


def calculate_recent_fib_zones(pivots: list[dict] | list[Pivot], as_of: str | None = None) -> tuple[FibSetup | None, list[FibZone]]:
    setup = identify_recent_fib_setup(pivots, as_of=as_of)
    if setup is None:
        return None, []
    return setup, build_fib_zones(setup, pivots)


def cache_fib_zones(ticker_id: int, setup: FibSetup | None, zones: list[FibZone]) -> None:
    with db() as conn:
        conn.execute("DELETE FROM fib_zones WHERE ticker_id = ?", (ticker_id,))
        if setup is None:
            return
        for zone in zones:
            conn.execute(
                """
                INSERT INTO fib_zones
                (ticker_id, setup_direction, swing_start_date, swing_start_price, swing_end_date, swing_end_price,
                 level_name, ratio_low, ratio_high, price_low, price_high, snapped_price_low, snapped_price_high,
                 confluence_note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticker_id,
                    setup.direction,
                    setup.start_date,
                    setup.start_price,
                    setup.end_date,
                    setup.end_price,
                    zone.level_name,
                    zone.ratio_low,
                    zone.ratio_high,
                    zone.price_low,
                    zone.price_high,
                    zone.snapped_price_low,
                    zone.snapped_price_high,
                    zone.confluence_note,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )


def cached_fib_zones(ticker_id: int) -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT setup_direction, swing_start_date, swing_start_price, swing_end_date, swing_end_price,
                       level_name, ratio_low, ratio_high, price_low, price_high,
                       snapped_price_low, snapped_price_high, confluence_note
                FROM fib_zones
                WHERE ticker_id = ?
                ORDER BY ratio_low
                """,
                (ticker_id,),
            ).fetchall()
        )
