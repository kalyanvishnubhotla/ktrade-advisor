from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from .database import db, rows_to_dicts
from .fibonacci import FibZone
from .pivots import Pivot, major_swings, pivot_rank


@dataclass
class ZoneSource:
    method: str
    label: str
    price_low: float
    price_high: float
    weight: float
    timeframe: str = "daily"


@dataclass
class SRZone:
    zone_type: str
    price_low: float
    price_high: float
    strength_score: float
    confluence_score: float
    sources: list[ZoneSource]
    plain_english: str


def as_row(item: dict | Any) -> dict:
    if hasattr(item, "__dataclass_fields__"):
        return asdict(item)
    return dict(item)


def zone_buffer(price: float, atr: float | None = None, pct: float = 0.0075) -> float:
    if price <= 0:
        return 0
    pct_buffer = price * pct
    atr_buffer = (atr or 0) * 0.35
    return max(pct_buffer, atr_buffer)


def source_range(price: float, atr: float | None = None, pct: float = 0.0075) -> tuple[float, float]:
    buffer = zone_buffer(price, atr, pct=pct)
    return price - buffer, price + buffer


def classify_zone(price_low: float, price_high: float, current_price: float, default: str) -> str:
    midpoint = (price_low + price_high) / 2
    if midpoint <= current_price:
        return "support"
    if midpoint > current_price:
        return "resistance"
    return default


def pivot_sources(pivots: list[dict] | list[Pivot], current_price: float, atr: float | None) -> list[tuple[str, ZoneSource]]:
    sources = []
    for pivot in major_swings(pivots, min_rank=14, limit=120):
        row = as_row(pivot)
        price = float(row["price"])
        low, high = source_range(price, atr)
        timeframe = row.get("timeframe", "daily")
        pivot_type = row["type"]
        zone_type = "support" if pivot_type == "low" else "resistance"
        weight = min(45, 12 + pivot_rank(row) * 0.25 + (12 if timeframe == "weekly" else 0))
        label = f"{timeframe} swing {'low' if pivot_type == 'low' else 'high'}"
        sources.append((zone_type, ZoneSource("pivot", label, low, high, weight, timeframe)))
    return sources


def fib_sources(fib_zones: list[dict] | list[FibZone], current_price: float) -> list[tuple[str, ZoneSource]]:
    sources = []
    for zone in fib_zones:
        row = as_row(zone)
        low = float(row.get("snapped_price_low") or row["price_low"])
        high = float(row.get("snapped_price_high") or row["price_high"])
        price_low, price_high = min(low, high), max(low, high)
        name = row["level_name"]
        weight = 30 if name == "Golden Zone" else 20 if name in ["Shallow pullback", "Deep retracement"] else 12
        zone_type = classify_zone(price_low, price_high, current_price, "support")
        sources.append((zone_type, ZoneSource("fib", name, price_low, price_high, weight, "multi")))
    return sources


def moving_average_sources(indicators: dict, current_price: float, atr: float | None) -> list[tuple[str, ZoneSource]]:
    sources = []
    for key, label, weight in [("ma50", "50-day moving average", 18), ("ma200", "200-day moving average", 28)]:
        value = indicators.get(key)
        if not value:
            continue
        price = float(value)
        low, high = source_range(price, atr, pct=0.006)
        zone_type = "support" if price <= current_price else "resistance"
        sources.append((zone_type, ZoneSource("moving average", label, low, high, weight, "daily")))
    return sources


def overlaps(a: ZoneSource, b: ZoneSource) -> bool:
    gap = max(a.price_low, b.price_low) - min(a.price_high, b.price_high)
    avg_width = ((a.price_high - a.price_low) + (b.price_high - b.price_low)) / 2
    return gap <= max(avg_width * 0.6, 0)


def compact_with_group(source: ZoneSource, group: list[ZoneSource], max_width_pct: float = 0.08) -> bool:
    low = min([source.price_low] + [item.price_low for item in group])
    high = max([source.price_high] + [item.price_high for item in group])
    midpoint = (low + high) / 2
    if midpoint <= 0:
        return False
    return (high - low) / midpoint <= max_width_pct


def source_to_dict(source: ZoneSource) -> dict:
    return {
        "method": source.method,
        "label": source.label,
        "price_low": round(source.price_low, 2),
        "price_high": round(source.price_high, 2),
        "weight": round(source.weight, 1),
        "timeframe": source.timeframe,
    }


def describe_zone(zone_type: str, price_low: float, price_high: float, sources: list[ZoneSource], confluence: float) -> str:
    adjective = "Strong" if confluence >= 75 else "Good" if confluence >= 55 else "Possible"
    noun = "demand zone" if zone_type == "support" else "supply zone"
    labels = sorted(sources, key=lambda source: source.weight, reverse=True)[:3]
    source_text = " + ".join(source.label for source in labels)
    return f"{adjective} {noun} at ${price_low:.2f}-${price_high:.2f} ({source_text})"


def build_zone(zone_type: str, sources: list[ZoneSource]) -> SRZone:
    price_low = min(source.price_low for source in sources)
    price_high = max(source.price_high for source in sources)
    total_weight = sum(source.weight for source in sources)
    methods = {source.method for source in sources}
    timeframes = {source.timeframe for source in sources}
    method_bonus = max(0, len(methods) - 1) * 12
    timeframe_bonus = 10 if "weekly" in timeframes else 0
    confluence = min(100, total_weight + method_bonus + timeframe_bonus)
    strength = min(100, total_weight)
    return SRZone(
        zone_type=zone_type,
        price_low=price_low,
        price_high=price_high,
        strength_score=round(strength, 1),
        confluence_score=round(confluence, 1),
        sources=sources,
        plain_english=describe_zone(zone_type, price_low, price_high, sources, confluence),
    )


def merge_sources(candidates: list[tuple[str, ZoneSource]]) -> list[SRZone]:
    zones: list[SRZone] = []
    for zone_type in ["support", "resistance"]:
        typed = [source for kind, source in candidates if kind == zone_type]
        typed.sort(key=lambda source: source.price_low)
        groups: list[list[ZoneSource]] = []
        for source in typed:
            placed = False
            for group in groups:
                if any(overlaps(source, existing) for existing in group) and compact_with_group(source, group):
                    group.append(source)
                    placed = True
                    break
            if not placed:
                groups.append([source])
        zones.extend(build_zone(zone_type, group) for group in groups)
    return sorted(zones, key=lambda zone: zone.confluence_score, reverse=True)


def calculate_sr_zones(
    pivots: list[dict] | list[Pivot],
    fib_zones: list[dict] | list[FibZone],
    indicators: dict,
) -> list[SRZone]:
    current_price = float(indicators.get("price") or 0)
    if current_price <= 0:
        return []
    atr = indicators.get("atr")
    candidates: list[tuple[str, ZoneSource]] = []
    candidates.extend(pivot_sources(pivots, current_price, atr))
    candidates.extend(fib_sources(fib_zones, current_price))
    candidates.extend(moving_average_sources(indicators, current_price, atr))
    return merge_sources(candidates)


def cache_sr_zones(ticker_id: int, zones: list[SRZone]) -> None:
    with db() as conn:
        conn.execute("DELETE FROM sr_zones WHERE ticker_id = ?", (ticker_id,))
        for zone in zones:
            conn.execute(
                """
                INSERT INTO sr_zones
                (ticker_id, zone_type, price_low, price_high, strength_score, confluence_score,
                 sources_json, plain_english, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticker_id,
                    zone.zone_type,
                    zone.price_low,
                    zone.price_high,
                    zone.strength_score,
                    zone.confluence_score,
                    json.dumps([source_to_dict(source) for source in zone.sources]),
                    zone.plain_english,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )


def cached_sr_zones(ticker_id: int, limit: int = 12) -> list[dict]:
    with db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT zone_type, price_low, price_high, strength_score, confluence_score,
                       sources_json, plain_english
                FROM sr_zones
                WHERE ticker_id = ?
                ORDER BY confluence_score DESC, strength_score DESC
                LIMIT ?
                """,
                (ticker_id, limit),
            ).fetchall()
        )
    for row in rows:
        row["sources"] = json.loads(row.pop("sources_json"))
    return rows


def nearest_zones(ticker_id: int, current_price: float) -> tuple[dict | None, dict | None]:
    zones = cached_sr_zones(ticker_id, limit=50)
    supports = [zone for zone in zones if zone["zone_type"] == "support" and zone["price_low"] <= current_price]
    resistances = [zone for zone in zones if zone["zone_type"] == "resistance" and zone["price_high"] >= current_price]

    def support_rank(zone: dict) -> float:
        distance_pct = abs(current_price - zone["price_high"]) / current_price * 100
        return distance_pct - float(zone["confluence_score"]) * 0.035

    def resistance_rank(zone: dict) -> float:
        distance_pct = abs(zone["price_low"] - current_price) / current_price * 100
        return distance_pct - float(zone["confluence_score"]) * 0.035

    support = min(supports, key=support_rank) if supports else None
    resistance = min(resistances, key=resistance_rank) if resistances else None
    return support, resistance


def recommendation_zones(zones: list[SRZone], current_price: float) -> tuple[dict | None, list[dict]]:
    rows = [
        {
            "zone_type": zone.zone_type,
            "price_low": zone.price_low,
            "price_high": zone.price_high,
            "strength_score": zone.strength_score,
            "confluence_score": zone.confluence_score,
            "sources": [source_to_dict(source) for source in zone.sources],
            "plain_english": zone.plain_english,
        }
        for zone in zones
    ]
    demand = [zone for zone in rows if zone["zone_type"] == "support" and zone["price_low"] <= current_price]
    supply = [zone for zone in rows if zone["zone_type"] == "resistance" and zone["price_high"] >= current_price]

    def demand_rank(zone: dict) -> float:
        distance_pct = max(0, current_price - zone["price_high"]) / current_price * 100
        source_bonus = 8 if any(source["method"] == "fib" and "Golden" in source["label"] for source in zone["sources"]) else 0
        return float(zone["confluence_score"]) + source_bonus - distance_pct * 2.2

    best_demand = max(demand, key=demand_rank) if demand else None
    next_supply = sorted(supply, key=lambda zone: (zone["price_low"], -float(zone["confluence_score"])))[:3]
    return best_demand, next_supply
