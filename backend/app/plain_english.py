from __future__ import annotations

import re
from typing import Any


REPLACEMENTS = [
    (r"RSI Bearish Divergence(?: detected)?", "the price is still rising, but the strength behind the move is getting weaker"),
    (r"MACD Bearish divergence", "the recent push higher is losing some strength"),
    (r"Bearish divergence", "the price is still rising, but the strength behind the move is getting weaker"),
    (r"Shooting Star|Evening Star|Dark Cloud Cover|Bearish Engulfing", "sellers showed up near the recent high"),
    (r"Overbought", "a fast move"),
    (r"RSI [\d.]+ is overbought", "price has climbed quickly"),
    (r"RSI [\d.]+ is bullish", "momentum is supportive"),
    (r"RSI [\d.]+, Bullish", "momentum is supportive"),
    (r"MACD is supportive", "buying pressure is supportive"),
    (r"MACD is not yet supportive", "buying pressure is not fully confirmed yet"),
    (r"Fib(?:onacci)?\s*[\d.]+%?\s*Extension", "next possible target if momentum continues"),
    (r"Golden Zone", "preferred value area"),
    (r"daily swing low", "recent buyer area"),
    (r"weekly swing low", "major buyer area"),
    (r"daily swing high", "recent review area"),
    (r"weekly swing high", "major review area"),
    (r"Bollinger range is wide at ([\d.]+)%", "price is moving in a wide range"),
    (r"ATR risk is elevated at ([\d.]+)% of price", "daily price swings are larger than usual"),
    (r"ATR risk is somewhat elevated at ([\d.]+)% of price", "daily price swings are a bit larger than usual"),
    (r"Volume is quiet: ([\d.]+)x average", "volume is quiet"),
    (r"Trend strength is weak: ADX [\d.]+,?", "trend strength is not forceful yet"),
    (r"ADX [\d.]+", "trend strength reading"),
    (r"Daily & weekly aligned", "short-term and longer-term trends agree"),
    (r"Trend is acceptable:", "Trend is in acceptable shape:"),
]


def translate_text(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, list):
        return [translate_text(item) for item in value]
    if isinstance(value, dict):
        return {key: translate_text(item) for key, item in value.items()}
    if not isinstance(value, str):
        return value
    text = value
    for pattern, replacement in REPLACEMENTS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def warning(what: str, means: str, action: str, label: str = "Heads up", severity: str = "yellow", category: str = "general") -> dict:
    return {
        "category": category,
        "severity": severity,
        "label": label,
        "what": translate_text(what),
        "means": translate_text(means),
        "action": translate_text(action),
        "message": warning_sentence(what, means, action),
    }


def warning_sentence(what: str, means: str, action: str) -> str:
    return f"{translate_text(what)} {translate_text(means)} {translate_text(action)}"


def translate_score(score: dict) -> dict:
    for key in [
        "summary",
        "suggested_action",
        "risk_reward_summary",
        "improve_to_buy",
        "buy_zone_explanation",
        "target_zone_explanation",
        "fresh_high_target_note",
        "why_rating",
        "changes_view",
        "momentum_summary",
        "trend_strength_summary",
        "volume_confirmation_summary",
    ]:
        if key in score:
            score[key] = translate_text(score[key])
    for key in ["setup_positive_factors", "setup_concern_factors", "decision_reasons", "warning_messages", "warning_actions"]:
        if key in score:
            score[key] = translate_text(score[key])
    if "setup_factor_scores" in score:
        score["setup_factor_scores"] = translate_text(score["setup_factor_scores"])
    return score
