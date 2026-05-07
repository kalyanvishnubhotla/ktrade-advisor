from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from .confluence import build_confluence_checklist
from .momentum import analyze_momentum
from .trend_volume import analyze_trend_volume


DISCLAIMER = "Decision support only. Not financial advice."


@dataclass
class MarketCondition:
    label: str
    explanation: str


def clean_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if np.isnan(value):
            return None
    except TypeError:
        pass
    return float(value)


def compute_indicators(history: pd.DataFrame, spy_history: pd.DataFrame | None = None) -> dict:
    if history.empty:
        return {}
    df = history.copy()
    df.columns = [str(c).lower() for c in df.columns]
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    ma200 = close.rolling(200).mean()
    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    bb_width_pct = ((bb_upper - bb_lower) / bb_mid) * 100

    momentum = analyze_momentum(df)
    trend_volume = analyze_trend_volume(df)

    prev_close = close.shift(1)
    tr = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()

    volume_ratio = volume.iloc[-1] / volume.rolling(50).mean().iloc[-1] if len(volume) >= 50 else np.nan
    support = low.tail(60).min()
    resistance = high.tail(60).max()
    price = close.iloc[-1]

    relative_strength = np.nan
    if spy_history is not None and not spy_history.empty and len(close) > 63:
        spy = spy_history.copy()
        spy.columns = [str(c).lower() for c in spy.columns]
        ticker_return = close.iloc[-1] / close.iloc[-63] - 1
        spy_close = spy["close"]
        if len(spy_close) > 63:
            spy_return = spy_close.iloc[-1] / spy_close.iloc[-63] - 1
            relative_strength = ticker_return - spy_return

    pattern = "Base forming"
    if clean_float(ma20.iloc[-1]) and clean_float(ma50.iloc[-1]) and price > ma20.iloc[-1] > ma50.iloc[-1]:
        pattern = "Orderly uptrend"
    elif clean_float(resistance) and price >= resistance * 0.98:
        pattern = "Near breakout area"
    elif clean_float(support) and price <= support * 1.05:
        pattern = "Near support"
    elif clean_float(ma50.iloc[-1]) and price < ma50.iloc[-1]:
        pattern = "Needs repair"

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "price": clean_float(price),
        "ma20": clean_float(ma20.iloc[-1]),
        "ma50": clean_float(ma50.iloc[-1]),
        "ma200": clean_float(ma200.iloc[-1]),
        "bb_upper": clean_float(bb_upper.iloc[-1]),
        "bb_lower": clean_float(bb_lower.iloc[-1]),
        "bb_width_pct": clean_float(bb_width_pct.iloc[-1]),
        "rsi": clean_float(momentum.get("rsi")),
        "rsi_interpretation": momentum.get("rsi_interpretation"),
        "macd": clean_float(momentum.get("macd")),
        "macd_signal": clean_float(momentum.get("macd_signal")),
        "macd_histogram": clean_float(momentum.get("macd_histogram")),
        "macd_trend": momentum.get("macd_trend"),
        "momentum_score": momentum.get("score"),
        "momentum_summary": momentum.get("summary"),
        "momentum_divergence": ", ".join([f"{item.get('indicator')} {item.get('type')}" for item in momentum.get("divergences", [])]) or None,
        "adx": clean_float(trend_volume.get("adx")),
        "plus_di": clean_float(trend_volume.get("plus_di")),
        "minus_di": clean_float(trend_volume.get("minus_di")),
        "adx_interpretation": trend_volume.get("adx_interpretation"),
        "trend_direction": trend_volume.get("trend_direction"),
        "obv": clean_float(trend_volume.get("obv")),
        "obv_trend": trend_volume.get("obv_trend"),
        "volume_vs_20d": clean_float(trend_volume.get("volume_vs_20d")),
        "rising_volume_on_up_days": trend_volume.get("rising_volume_on_up_days"),
        "trend_alignment": trend_volume.get("trend_alignment"),
        "trend_strength_score": trend_volume.get("trend_strength_score"),
        "trend_strength_label": trend_volume.get("trend_strength_label"),
        "trend_strength_summary": trend_volume.get("trend_strength_summary"),
        "volume_confirmation": trend_volume.get("volume_confirmation"),
        "volume_confirmation_score": trend_volume.get("volume_confirmation_score"),
        "volume_confirmation_summary": trend_volume.get("volume_confirmation_summary"),
        "atr": clean_float(atr.iloc[-1]),
        "volume_ratio": clean_float(volume_ratio),
        "relative_strength": clean_float(relative_strength),
        "support": clean_float(support),
        "resistance": clean_float(resistance),
        "distance_to_support": clean_float((price / support - 1) * 100) if support else None,
        "distance_to_resistance": clean_float((resistance / price - 1) * 100) if price else None,
        "pattern_signal": pattern,
    }


def latest_research_adjustment(signals: list[dict]) -> tuple[int, str]:
    approved = [s for s in signals if s.get("applied")]
    if not approved:
        return 7, "Neutral"
    latest = approved[-1]
    sentiment = (latest.get("sentiment") or "Neutral").lower()
    impact = (latest.get("suggested_impact") or "Keep").lower()
    confidence = (latest.get("confidence") or "Medium").lower()
    size = 11 if confidence == "high" else 8 if confidence == "medium" else 5
    if "negative" in sentiment or "decrease" in impact:
        return max(0, 7 - size), "Negative"
    if "mixed" in sentiment or "caution" in impact:
        return 6, "Mixed"
    if "positive" in sentiment or "increase" in impact:
        return min(15, 7 + size), "Positive"
    return 7, "Neutral"


def label(value: float, strong: float, good: float, mixed: float) -> str:
    if value >= strong:
        return "Strong"
    if value >= good:
        return "Good"
    if value >= mixed:
        return "Mixed"
    return "Weak"


def plain_distance(value: float | None, near_word: str, far_word: str) -> str:
    if value is None:
        return "price location is unclear"
    if value < 3:
        return f"it is very close to {near_word}"
    if value < 8:
        return f"it is near {near_word}"
    if value < 15:
        return f"it has some room from {near_word}"
    return f"it is stretched from {far_word}"


def build_decision_reasons(checklist: dict, trend_label: str, momentum_label: str, volume_label: str, risk: str) -> list[str]:
    reasons = list(checklist.get("positive_factors") or [])
    if len(reasons) < 3:
        reasons.extend(
            [
                f"Trend reads {trend_label.lower()}",
                f"Momentum reads {momentum_label.lower()}",
                f"Volume reads {volume_label.lower()}",
                f"Risk is {risk.lower()}",
            ]
        )
    unique: list[str] = []
    for reason in reasons:
        if reason and reason not in unique:
            unique.append(reason)
    return unique[:3]


def risk_reward_at_buy_area(entry_low: float, entry_high: float, invalidation: float, target1: float) -> str:
    planned_entry = (entry_low + entry_high) / 2
    downside = max(planned_entry - invalidation, 0.01)
    upside = max(target1 - planned_entry, 0.01)
    ratio = upside / downside
    return (
        f"If bought near the middle of the preferred area (${planned_entry:.2f}), "
        f"the first review area offers about {ratio:.1f}:1 reward/risk "
        f"(${upside:.2f} upside vs ${downside:.2f} risk)."
    )


def improve_to_buy_trigger(decision: str, entry_low: float, entry_high: float, rsi: float, volume_label: str, trend_label: str) -> str:
    rsi_trigger = "RSI cools below 55" if rsi >= 55 else "RSI stays constructive"
    volume_trigger = "volume stays supportive" if volume_label in ["Supportive", "Constructive", "Strong", "Good"] else "volume improves"
    if decision == "Buy-worthy now":
        return f"Already qualifies. Cleaner entry would be a pullback toward ${entry_low:.2f}-${entry_high:.2f} while {volume_trigger}."
    if decision == "Wait for better price":
        return f"Pullback into ${entry_low:.2f}-${entry_high:.2f}, {rsi_trigger}, and {volume_trigger}."
    if decision == "Watch for breakout":
        return f"A strong close above the review area with {volume_trigger}; or a pullback into ${entry_low:.2f}-${entry_high:.2f}."
    if decision == "Avoid for now":
        return f"Trend needs to repair first, then price should reclaim the preferred area with improving momentum."
    if trend_label in ["Weak", "Mixed"]:
        return f"Trend improves, price holds ${entry_low:.2f}-${entry_high:.2f}, and {volume_trigger}."
    return f"Price gets closer to ${entry_low:.2f}-${entry_high:.2f}, {rsi_trigger}, and {volume_trigger}."


def score_ticker(ind: dict, research_signals: list[dict], portfolio_fit: int = 3, zone_context: dict | None = None) -> dict:
    price = ind.get("price") or 0
    ma20 = ind.get("ma20")
    ma50 = ind.get("ma50")
    ma200 = ind.get("ma200")
    rsi = ind.get("rsi") or 50
    momentum_quality = ind.get("momentum_score")
    momentum_summary = ind.get("momentum_summary")
    macd_trend = ind.get("macd_trend")
    trend_quality = ind.get("trend_strength_score")
    volume_quality = ind.get("volume_confirmation_score")
    trend_summary = ind.get("trend_strength_summary")
    volume_summary = ind.get("volume_confirmation_summary")
    volume_ratio = ind.get("volume_ratio") or 1
    rs = ind.get("relative_strength") or 0
    support = ind.get("support")
    resistance = ind.get("resistance")
    atr = ind.get("atr") or 0
    zone_context = zone_context or {}
    demand_zone = zone_context.get("buy_zone")
    supply_zones = zone_context.get("target_zones") or []
    fib_extensions = zone_context.get("fib_extensions") or {}

    trend = 0
    if trend_quality is not None:
        trend = max(0, min(20, (float(trend_quality) / 100) * 20))
    else:
        if ma20 and price > ma20:
            trend += 6
        if ma50 and price > ma50:
            trend += 6
        if ma200 and price > ma200:
            trend += 5
        if ma20 and ma50 and ma20 > ma50:
            trend += 3

    if momentum_quality is not None:
        momentum = max(0, min(15, (float(momentum_quality) / 100) * 15))
    else:
        momentum = 7
        if 45 <= rsi <= 68:
            momentum += 5
        elif 68 < rsi <= 75:
            momentum += 2
        elif rsi < 38 or rsi > 78:
            momentum -= 4
        if rs > 0:
            momentum += 3
        momentum = max(0, min(15, momentum))

    if volume_quality is not None:
        volume = max(0, min(10, (float(volume_quality) / 100) * 10))
    else:
        volume = max(0, min(10, 5 + (volume_ratio - 1) * 5))

    sr = 7
    if support and price:
        distance_support = (price / support - 1) * 100
        if 2 <= distance_support <= 10:
            sr += 5
        elif distance_support > 20:
            sr -= 3
    if resistance and price:
        distance_resistance = (resistance / price - 1) * 100
        if distance_resistance >= 10:
            sr += 3
        elif distance_resistance < 3:
            sr -= 1
    sr = max(0, min(15, sr))

    pattern_text = ind.get("pattern_signal") or "Base forming"
    pattern = {"Orderly uptrend": 9, "Near breakout area": 8, "Near support": 7, "Base forming": 6, "Needs repair": 3}.get(pattern_text, 5)
    news, news_label = latest_research_adjustment(research_signals)

    risk_reward = 5
    if support and resistance and price:
        downside = max(price - support, 0.01)
        upside = max(resistance - price, 0.01)
        ratio = upside / downside
        risk_reward = max(0, min(10, 4 + ratio * 2))
    if atr and price and atr / price > 0.06:
        risk_reward -= 2
    risk_reward = max(0, min(10, risk_reward))

    score = round(trend + momentum + volume + sr + pattern + news + risk_reward + portfolio_fit)
    if score >= 80:
        band = "Strong opportunity"
    elif score >= 65:
        band = "Conditional"
    elif score >= 50:
        band = "Mixed"
    else:
        band = "Avoid"

    risk = "Low" if risk_reward >= 8 and score >= 70 else "Medium" if score >= 50 else "High"
    distance_to_buy_zone = None
    if demand_zone and price:
        distance_to_buy_zone = max(0, (price / demand_zone["price_high"] - 1) * 100)
    checklist = build_confluence_checklist(ind, demand_zone, distance_to_buy_zone)
    setup_quality = checklist["total"]

    if score >= 78 and risk != "High" and (distance_to_buy_zone is None or distance_to_buy_zone <= 3):
        decision = "Buy-worthy now"
    elif score >= 68 and ((distance_to_buy_zone is not None and distance_to_buy_zone > 4) or (ind.get("distance_to_support") and ind["distance_to_support"] > 12)):
        decision = "Wait for better price"
    elif score >= 64 and pattern_text == "Near breakout area":
        decision = "Watch for breakout"
    elif 50 <= score < 64:
        decision = "Hold / no action"
    elif score < 50:
        decision = "Avoid for now"
    else:
        decision = "Hold / no action"

    distance_support = ind.get("distance_to_support")
    distance_resistance = ind.get("distance_to_resistance")
    trend_label = ind.get("trend_strength_label") or label(trend, 16, 11, 6)
    momentum_label = ind.get("momentum_label") or label(momentum, 12, 9, 5)
    volume_label = ind.get("volume_confirmation") or label(volume, 8, 6, 4)
    support_phrase = plain_distance(distance_support, "its support area", "a safer buy area")
    target_phrase = plain_distance(distance_resistance, "a review target", "the next review target")
    volume_phrase = "buyers are showing better activity" if volume_label in ["Strong", "Good", "Supportive", "Constructive"] else "volume is not adding much confirmation"
    trend_phrase = {
        "Strong": "the trend is in good shape",
        "Good": "the trend is constructive",
        "Mixed": "the trend is still uneven",
        "Weak": "the trend needs repair",
    }[trend_label]

    if decision == "Buy-worthy now":
        zone_text = f"near a {demand_zone['confluence_score']:.0f}/100 demand zone" if demand_zone else support_phrase
        summary = f"The setup qualifies because {trend_phrase}, price is {zone_text}, and momentum is {momentum_label.lower()}. Keep position size modest if risk is {risk.lower()}."
        action = "Consider a small starter buy only if it fits your portfolio and risk limit."
    elif decision == "Wait for better price":
        if demand_zone and distance_to_buy_zone is not None:
            summary = f"The score is decent, but price is about {distance_to_buy_zone:.1f}% above the best demand zone. Waiting closer to that zone may give cleaner risk/reward."
        else:
            summary = f"The score is decent, but {support_phrase}. Waiting closer to the buy zone may give a cleaner risk/reward."
        action = "Set an alert near the buy zone instead of chasing today’s price."
    elif decision == "Watch for breakout":
        summary = f"It is close to an area worth watching; {target_phrase}. A stronger close with healthy volume would improve the setup."
        action = "Watch for a clean move higher with healthy volume before acting."
    elif decision == "Avoid for now":
        summary = f"The setup does not qualify because {trend_phrase} and risk is {risk.lower()}. There is no need to force a buy."
        action = "Avoid new buys until the trend and risk picture improve."
    else:
        summary = f"The evidence is mixed: {trend_phrase}, momentum is {momentum_label.lower()}, and {target_phrase}. New buying does not look urgent."
        action = "Hold or wait for a clearer setup."

    if demand_zone:
        entry_low = demand_zone["price_low"]
        entry_high = demand_zone["price_high"]
        buffer = max((atr or 0) * 0.5, entry_low * 0.025)
        invalidation = entry_low - buffer
    else:
        entry_low = support * 1.02 if support else price * 0.97
        entry_high = min(price * 1.02, support * 1.08) if support else price * 1.02
        invalidation = support * 0.97 if support else price * 0.92

    if supply_zones:
        first_supply = supply_zones[0]
        target1 = first_supply["price_high"] if first_supply["price_low"] <= price <= first_supply["price_high"] else first_supply["price_low"]
        target2 = supply_zones[1]["price_low"] if len(supply_zones) > 1 else first_supply["price_high"]
    else:
        target1 = resistance if resistance and resistance > price else fib_extensions.get("1.272") or price * 1.08
        target2 = fib_extensions.get("1.618") or (price + (target1 - price) * 1.8 if target1 else price * 1.15)

    if target1 <= price and not supply_zones and fib_extensions.get("1.272"):
        target1 = fib_extensions["1.272"]
    if target2 <= target1 and fib_extensions.get("1.618"):
        target2 = fib_extensions["1.618"]

    decision_reasons = build_decision_reasons(checklist, trend_label, momentum_label, volume_label, risk)
    risk_reward_summary = risk_reward_at_buy_area(entry_low, entry_high, invalidation, target1)
    improve_trigger = improve_to_buy_trigger(decision, entry_low, entry_high, rsi, volume_label, trend_label)

    return {
        "score": score,
        "band": band,
        "decision": decision,
        "confidence": "High" if score >= 80 or score < 40 else "Medium" if score >= 55 else "Low",
        "risk": risk,
        "trend_label": trend_label,
        "trend_strength_summary": trend_summary,
        "momentum_label": momentum_label,
        "momentum_summary": momentum_summary,
        "macd_trend": macd_trend,
        "volume_label": volume_label,
        "volume_confirmation_summary": volume_summary,
        "news_label": news_label,
        "summary": summary,
        "suggested_action": action,
        "entry_range": f"${entry_low:.2f} - ${entry_high:.2f}",
        "invalidation_level": f"${invalidation:.2f}",
        "target1": f"${target1:.2f}",
        "target2": f"${target2:.2f}",
        "distance_to_buy_zone": round(distance_to_buy_zone, 1) if distance_to_buy_zone is not None else None,
        "buy_zone_confluence": setup_quality,
        "setup_factor_scores": checklist["factors"],
        "setup_positive_factors": checklist["positive_factors"],
        "setup_concern_factors": checklist["concern_factors"],
        "decision_reasons": decision_reasons,
        "risk_reward_summary": risk_reward_summary,
        "improve_to_buy": improve_trigger,
        "buy_zone_explanation": demand_zone.get("plain_english") if demand_zone else None,
        "target_zone_explanation": supply_zones[0].get("plain_english") if supply_zones else None,
        "hold_window": "4-8 weeks for a swing setup; longer only if fundamentals still fit.",
        "why_rating": f"Trend is {trend_label.lower()}, momentum is {momentum_label.lower()}, volume is {volume_label.lower()}, research is {news_label.lower()}, and risk is {risk.lower()}.",
        "changes_view": "A break below the risk level, weakening market, negative research, or heavy selling would lower the rating.",
    }


def market_condition(spy: dict | None, qqq: dict | None) -> MarketCondition:
    def points(ind: dict | None) -> int:
        if not ind or not ind.get("price"):
            return 0
        price = ind["price"]
        pts = 0
        if ind.get("ma50") and price > ind["ma50"]:
            pts += 1
        if ind.get("ma200") and price > ind["ma200"]:
            pts += 1
        if ind.get("ma20") and ind.get("ma50") and ind["ma20"] > ind["ma50"]:
            pts += 1
        return pts

    total = points(spy) + points(qqq)
    if total >= 6:
        return MarketCondition("Strong", "Market Today: Strong. Favor high-quality setups, but still manage risk.")
    if total >= 4:
        return MarketCondition("Healthy but selective", "Market Today: Healthy but selective. Choose cleaner setups.")
    if total >= 2:
        return MarketCondition("Mixed / cautious", "Market Today: Mixed / Cautious. Be selective.")
    if total >= 1:
        return MarketCondition("Weak", "Market Today: Weak. Waiting is a valid choice.")
    return MarketCondition("High-risk", "Market Today: High-risk. Avoid forcing new buys.")
