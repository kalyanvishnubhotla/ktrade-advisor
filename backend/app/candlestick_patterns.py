"""
candlestick_patterns.py
───────────────────────

Lightweight, dependency-free detector for the four most-used Japanese
candlestick patterns. Powers the optional "Pro Chart Analysis" overlay
on the Ticker Detail page.

PHILOSOPHY
──────────
Candlestick patterns are useful as *signals worth a second look*, never as
standalone trade triggers. We deliberately keep the rules conservative so
the chart doesn't get spammed with weak signals. The frontend renders each
detection with a small icon and a plain-English explanation so beginners
learn what they're looking at, not just see a colorful marker.

PATTERNS DETECTED
─────────────────
  • Bullish Engulfing   — green body fully wraps the prior red body
  • Bearish Engulfing   — red body fully wraps the prior green body
  • Hammer              — small body near top, long lower wick (>2× body)
  • Shooting Star       — small body near bottom, long upper wick (>2× body)
  • Doji                — open ≈ close (body < 10% of range)

INPUT
─────
A pandas DataFrame with columns: Open, High, Low, Close (case-insensitive).
Typically a slice of the recent ~60 trading days.

OUTPUT
──────
List of detection dicts, oldest → newest:

    {
        "date":      "2026-05-11",
        "type":      "bullish_engulfing",
        "label":     "Bullish Engulfing",
        "direction": "bullish" | "bearish" | "neutral",
        "price":     412.34,           # close at the pattern bar
        "summary":   "Strong reversal upward — buyers absorbed sellers."
    }

The frontend uses `type` to pick the icon and color, `summary` for the tooltip.
"""

from __future__ import annotations

from typing import Optional

import pandas as pd


# ── Tuning knobs ──────────────────────────────────────────────────────────────
# These are deliberately conservative so we don't spam the chart with weak
# signals. Tighten further if a user finds the chart too noisy.

DOJI_BODY_FRAC          = 0.10   # body must be ≤10% of (high-low) to count as doji
HAMMER_LOWER_WICK_RATIO = 2.0    # lower wick must be ≥2× body for a hammer
HAMMER_BODY_TOP_FRAC    = 0.66   # body's bottom must sit above 66% of the range (top third)
STAR_UPPER_WICK_RATIO   = 2.0    # symmetric to hammer
STAR_BODY_BOTTOM_FRAC   = 0.34   # body's top must sit below 34% of the range (bottom third)


# ── Plain-English library ────────────────────────────────────────────────────
# Beginners-friendly explanations rendered in the chart tooltip.

PATTERN_LABELS: dict[str, dict] = {
    "bullish_engulfing": {
        "label":     "Bullish Engulfing",
        "direction": "bullish",
        "summary":   "Today's green candle completely covers yesterday's red one. Buyers took control after sellers were in charge — a classic short-term reversal signal.",
        "icon":      "⬆",
    },
    "bearish_engulfing": {
        "label":     "Bearish Engulfing",
        "direction": "bearish",
        "summary":   "Today's red candle fully wraps yesterday's green one. Sellers stepped in decisively after a rally — often a warning that the move is pausing or turning.",
        "icon":      "⬇",
    },
    "hammer": {
        "label":     "Hammer",
        "direction": "bullish",
        "summary":   "Long lower wick with a small body near the top. Price was pushed down hard during the day, then buyers reclaimed it by the close. Common at the end of a pullback.",
        "icon":      "🔨",
    },
    "shooting_star": {
        "label":     "Shooting Star",
        "direction": "bearish",
        "summary":   "Long upper wick with a small body near the bottom. Price reached for new highs but sellers dragged it back. Often shows up at the top of a short rally.",
        "icon":      "💫",
    },
    "doji": {
        "label":     "Doji",
        "direction": "neutral",
        "summary":   "Open and close finished almost identical, meaning buyers and sellers ended the day in a stalemate. Watch for the next bar to confirm direction.",
        "icon":      "✦",
    },
}


# ── Detector internals ────────────────────────────────────────────────────────

def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Accept columns in any case (Open / open / OPEN). Returns a copy."""
    out = df.copy()
    out.columns = [str(c).lower() for c in out.columns]
    required = {"open", "high", "low", "close"}
    missing = required - set(out.columns)
    if missing:
        raise ValueError(f"candlestick_patterns: missing OHLC columns: {missing}")
    return out


def _body_metrics(row) -> dict:
    """Pre-compute body/wick measurements used by every detector."""
    o, h, l, c = float(row["open"]), float(row["high"]), float(row["low"]), float(row["close"])
    full_range  = max(h - l, 1e-9)        # avoid division by zero on flat days
    body        = abs(c - o)
    body_top    = max(o, c)
    body_bottom = min(o, c)
    upper_wick  = h - body_top
    lower_wick  = body_bottom - l
    return {
        "open":        o, "high":   h, "low": l, "close": c,
        "range":       full_range,
        "body":        body,
        "body_top":    body_top,
        "body_bottom": body_bottom,
        "upper_wick":  upper_wick,
        "lower_wick":  lower_wick,
        "is_green":    c > o,
        "is_red":      c < o,
    }


def _is_doji(m: dict) -> bool:
    return m["body"] <= DOJI_BODY_FRAC * m["range"]


def _is_hammer(m: dict) -> bool:
    # Classical hammer: body in the upper third of the range with a long
    # lower wick. We don't constrain the upper wick directly — the
    # body-position requirement already implies it's small.
    if m["body"] < 0.05 * m["range"]:
        return False
    if m["lower_wick"] < HAMMER_LOWER_WICK_RATIO * m["body"]:
        return False
    body_bottom_pos = (m["body_bottom"] - m["low"]) / m["range"]
    return body_bottom_pos >= HAMMER_BODY_TOP_FRAC


def _is_shooting_star(m: dict) -> bool:
    # Classical shooting star: body in the lower third of the range with a
    # long upper wick. Mirror of hammer.
    if m["body"] < 0.05 * m["range"]:
        return False
    if m["upper_wick"] < STAR_UPPER_WICK_RATIO * m["body"]:
        return False
    body_top_pos = (m["body_top"] - m["low"]) / m["range"]
    return body_top_pos <= STAR_BODY_BOTTOM_FRAC


def _is_bullish_engulfing(prev: dict, cur: dict) -> bool:
    # Yesterday: red. Today: green AND today's body fully covers yesterday's body.
    if not (prev["is_red"] and cur["is_green"]):
        return False
    return (cur["body_top"]    >= prev["body_top"] and
            cur["body_bottom"] <= prev["body_bottom"] and
            cur["body"] > prev["body"])


def _is_bearish_engulfing(prev: dict, cur: dict) -> bool:
    if not (prev["is_green"] and cur["is_red"]):
        return False
    return (cur["body_top"]    >= prev["body_top"] and
            cur["body_bottom"] <= prev["body_bottom"] and
            cur["body"] > prev["body"])


def _date_string(idx_value) -> str:
    """Normalise the DataFrame's index value to a YYYY-MM-DD string."""
    try:
        ts = pd.Timestamp(idx_value)
        return ts.date().isoformat()
    except Exception:
        return str(idx_value)[:10]


# ── Public detector ───────────────────────────────────────────────────────────

def detect_patterns(
    history: pd.DataFrame,
    lookback: int = 60,
    max_patterns: Optional[int] = 12,
) -> list[dict]:
    """
    Scan the LAST `lookback` bars for candlestick patterns and return them
    in chronological order.

    The frontend caps how many it draws via `max_patterns` to keep the chart
    uncluttered; the most recent ones win.

    Returns: list of detection dicts (see module docstring).
    """
    if history is None or history.empty:
        return []

    df = _normalize_columns(history.tail(lookback))
    if len(df) < 2:
        return []

    rows = df.to_dict("records")
    dates = list(df.index)

    detections: list[dict] = []
    metrics_cache: list[dict] = [_body_metrics(r) for r in rows]

    for i in range(len(rows)):
        date_str = _date_string(dates[i])
        cur = metrics_cache[i]
        prev = metrics_cache[i - 1] if i > 0 else None

        # Engulfing patterns need a prior bar.
        if prev is not None:
            if _is_bullish_engulfing(prev, cur):
                detections.append(_build("bullish_engulfing", date_str, cur))
                continue   # one pattern per bar — engulfing wins over single-bar shapes
            if _is_bearish_engulfing(prev, cur):
                detections.append(_build("bearish_engulfing", date_str, cur))
                continue

        # Single-bar shapes. Order matters: hammer/star take priority over doji.
        if _is_hammer(cur):
            detections.append(_build("hammer", date_str, cur))
            continue
        if _is_shooting_star(cur):
            detections.append(_build("shooting_star", date_str, cur))
            continue
        if _is_doji(cur):
            detections.append(_build("doji", date_str, cur))

    # Keep only the most recent N so the chart doesn't get cluttered.
    if max_patterns and len(detections) > max_patterns:
        detections = detections[-max_patterns:]

    return detections


def _build(kind: str, date_str: str, m: dict) -> dict:
    meta = PATTERN_LABELS[kind]
    return {
        "date":      date_str,
        "type":      kind,
        "label":     meta["label"],
        "direction": meta["direction"],
        "icon":      meta["icon"],
        "summary":   meta["summary"],
        "price":     round(m["close"], 4),
    }
