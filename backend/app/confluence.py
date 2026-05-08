from __future__ import annotations

from dataclasses import dataclass
from typing import Any


CHECKLIST_WEIGHTS = {
    "price_structure_zones": 0.30,
    "trend_alignment": 0.25,
    "momentum": 0.20,
    "volume_confirmation": 0.15,
    "volatility_context": 0.10,
}


@dataclass
class FactorResult:
    key: str
    label: str
    score: int
    positive: str | None = None
    concern: str | None = None


def clamp(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, round(value)))


def score_price_structure(price: float, demand_zone: dict | None, distance_to_buy_zone: float | None) -> FactorResult:
    if not demand_zone:
        return FactorResult("price_structure_zones", "Price Structure & Zones", 45, concern="No high-confidence buy zone is available yet")
    confluence = float(demand_zone.get("confluence_score") or 50)
    distance = distance_to_buy_zone
    if distance is None:
        proximity = 60
    elif distance <= 3:
        proximity = 100
    elif distance <= 8:
        proximity = 82
    elif distance <= 15:
        proximity = 58
    elif distance <= 25:
        proximity = 35
    else:
        proximity = 15
    score = clamp((confluence * 0.55) + (proximity * 0.45))
    zone_text = f"${demand_zone['price_low']:.2f}-${demand_zone['price_high']:.2f}"
    if distance is not None and distance > 8:
        concern = f"Price is {distance:.1f}% above the preferred buy area"
        positive = f"Buy area exists at {zone_text}"
    elif distance is not None and distance <= 3:
        concern = None
        positive = f"Price is near the preferred buy area at {zone_text}"
    else:
        concern = None
        positive = f"Strong price zone evidence near {zone_text}"
    return FactorResult("price_structure_zones", "Price Structure & Zones", score, positive, concern)


def score_trend(ind: dict) -> FactorResult:
    score = clamp(float(ind.get("trend_strength_score") or 50))
    adx = ind.get("adx")
    alignment = ind.get("trend_alignment") or "trend alignment unclear"
    if score >= 75:
        positive = f"Trend is strong: ADX {adx:.1f}, {alignment}" if adx is not None else f"Trend is strong: {alignment}"
        concern = None
    elif score < 45:
        positive = None
        concern = f"Trend strength is weak: ADX {adx:.1f}, {alignment}" if adx is not None else f"Trend strength is weak: {alignment}"
    else:
        positive = f"Trend is acceptable: {alignment}"
        concern = None
    return FactorResult("trend_alignment", "Trend Alignment", score, positive, concern)


def score_momentum(ind: dict) -> FactorResult:
    score = clamp(float(ind.get("momentum_score") or 50))
    rsi = ind.get("rsi")
    macd_trend = ind.get("macd_trend") or "MACD unclear"
    divergence = ind.get("momentum_divergence")
    warnings = ind.get("momentum_warnings") or []
    if rsi is not None and rsi > 70:
        warnings = [
            {
                "message": "Price has climbed quickly — it may pause or pull back a bit to rest.",
            }
        ] + warnings
    if warnings:
        score = clamp(score - min(14, 7 * len(warnings)))
    if rsi is not None and rsi > 70:
        concern = "The recent climb may be getting stretched"
    elif warnings:
        concern = warnings[0].get("message") or "Momentum is slowing, so price may pause"
    elif divergence and "Bearish" in divergence:
        concern = "Momentum is slowing down even though price is still rising"
    elif score < 45:
        concern = "Momentum is not yet supportive"
    else:
        concern = None
    if score >= 65:
        positive = "Momentum is supportive"
    else:
        positive = None
    return FactorResult("momentum", "Momentum", score, positive, concern)


def score_volume(ind: dict) -> FactorResult:
    score = clamp(float(ind.get("volume_confirmation_score") or 50))
    volume_vs_20d = ind.get("volume_vs_20d")
    rising = bool(ind.get("rising_volume_on_up_days"))
    if score >= 70:
        positive = f"Volume is supportive: {volume_vs_20d:.1f}x average, rising on up days" if volume_vs_20d is not None and rising else "Volume is constructive"
        concern = None
    elif score < 45:
        positive = None
        concern = f"Volume is quiet: {volume_vs_20d:.1f}x average" if volume_vs_20d is not None else "Volume confirmation is weak"
    else:
        positive = "Volume is neutral"
        concern = None
    return FactorResult("volume_confirmation", "Volume Confirmation", score, positive, concern)


def score_volatility(ind: dict) -> FactorResult:
    price = ind.get("price") or 0
    atr = ind.get("atr") or 0
    atr_pct = (atr / price) * 100 if price and atr else None
    bb_width = ind.get("bb_width_pct")
    score = 70
    concern = None
    positive = "Volatility is manageable"
    if atr_pct is not None:
        if atr_pct > 7:
            score -= 35
            concern = f"ATR risk is elevated at {atr_pct:.1f}% of price"
            positive = None
        elif atr_pct > 4:
            score -= 15
            concern = f"ATR risk is somewhat elevated at {atr_pct:.1f}% of price"
        elif atr_pct < 2.5:
            score += 10
            positive = f"ATR risk is modest at {atr_pct:.1f}% of price"
    if bb_width is not None:
        if bb_width > 25:
            score -= 12
            concern = concern or f"Bollinger range is wide at {bb_width:.1f}%"
        elif bb_width < 12:
            score += 5
            positive = positive or f"Bollinger range is tight at {bb_width:.1f}%"
    return FactorResult("volatility_context", "Volatility Context", clamp(score), positive, concern)


def factor_to_dict(factor: FactorResult) -> dict[str, Any]:
    return {
        "key": factor.key,
        "label": factor.label,
        "score": factor.score,
        "positive": factor.positive,
        "concern": factor.concern,
        "weight": CHECKLIST_WEIGHTS[factor.key],
    }


def build_confluence_checklist(ind: dict, demand_zone: dict | None, distance_to_buy_zone: float | None) -> dict:
    factors = [
        score_price_structure(float(ind.get("price") or 0), demand_zone, distance_to_buy_zone),
        score_trend(ind),
        score_momentum(ind),
        score_volume(ind),
        score_volatility(ind),
    ]
    total = clamp(sum(factor.score * CHECKLIST_WEIGHTS[factor.key] for factor in factors))
    positives = sorted(
        [factor for factor in factors if factor.positive],
        key=lambda factor: factor.score * CHECKLIST_WEIGHTS[factor.key],
        reverse=True,
    )[:3]
    concerns = sorted(
        [factor for factor in factors if factor.concern],
        key=lambda factor: factor.score,
    )[:2]
    return {
        "total": total,
        "factors": [factor_to_dict(factor) for factor in factors],
        "positive_factors": [factor.positive for factor in positives if factor.positive],
        "concern_factors": [factor.concern for factor in concerns if factor.concern],
    }
