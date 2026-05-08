from __future__ import annotations

from dataclasses import asdict

import pandas as pd

from .pivots import Pivot, normalize_ohlc
from .plain_english import warning


def rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    rsi = pd.Series(index=close.index, dtype="float64")
    if len(close) <= period:
        return rsi

    avg_gain = gains.iloc[1 : period + 1].mean()
    avg_loss = losses.iloc[1 : period + 1].mean()
    if avg_loss == 0:
        rsi.iloc[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi.iloc[period] = 100 - (100 / (1 + rs))

    for index in range(period + 1, len(close)):
        avg_gain = ((avg_gain * (period - 1)) + gains.iloc[index]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses.iloc[index]) / period
        if avg_loss == 0:
            rsi.iloc[index] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi.iloc[index] = 100 - (100 / (1 + rs))
    return rsi


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal_period: int = 9) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def rsi_interpretation(value: float | None) -> str:
    if value is None:
        return "Unavailable"
    if value > 70:
        return "Overbought"
    if value < 30:
        return "Oversold"
    if 40 <= value <= 60:
        return "Neutral"
    if value > 50:
        return "Bullish"
    return "Bearish"


def pivot_rows(pivots: list[Pivot] | list[dict], pivot_type: str) -> list[dict]:
    rows = [asdict(pivot) if isinstance(pivot, Pivot) else dict(pivot) for pivot in pivots]
    return sorted(
        [row for row in rows if row.get("type") == pivot_type and row.get("timeframe") == "daily"],
        key=lambda row: row["date"],
    )[-10:]


def indicator_at(series: pd.Series, date: str) -> float | None:
    timestamp = pd.Timestamp(date)
    if getattr(series.index, "tz", None) is not None and timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(series.index.tz)
    elif getattr(series.index, "tz", None) is None and timestamp.tzinfo is not None:
        timestamp = timestamp.tz_localize(None)
    if timestamp in series.index:
        value = series.loc[timestamp]
    else:
        earlier = series.loc[series.index <= timestamp]
        if earlier.empty:
            return None
        value = earlier.iloc[-1]
    if pd.isna(value):
        return None
    return float(value)


def detect_divergence(price_pivots: list[dict], oscillator: pd.Series, direction: str) -> dict | None:
    if len(price_pivots) < 2:
        return None
    previous, current = price_pivots[-2], price_pivots[-1]
    prev_osc = indicator_at(oscillator, previous["date"])
    curr_osc = indicator_at(oscillator, current["date"])
    if prev_osc is None or curr_osc is None:
        return None

    if direction == "bullish" and current["price"] < previous["price"] and curr_osc > prev_osc:
        return {
            "type": "Bullish divergence",
            "price_from": previous["price"],
            "price_to": current["price"],
            "indicator_from": prev_osc,
            "indicator_to": curr_osc,
            "date": current["date"],
        }
    if direction == "bearish" and current["price"] > previous["price"] and curr_osc < prev_osc:
        return {
            "type": "Bearish divergence",
            "price_from": previous["price"],
            "price_to": current["price"],
            "indicator_from": prev_osc,
            "indicator_to": curr_osc,
            "date": current["date"],
        }
    return None


def detect_rsi_bearish_divergence(highs: list[dict], rsi_series: pd.Series) -> dict | None:
    recent = highs[-3:]
    if len(recent) < 2:
        return None
    pairs = []
    for pivot in recent:
        value = indicator_at(rsi_series, pivot["date"])
        if value is not None:
            pairs.append((pivot, value))
    if len(pairs) < 2:
        return None
    previous, current = pairs[-2], pairs[-1]
    if current[0]["price"] > previous[0]["price"] and current[1] < previous[1]:
        return {
            "type": "RSI Bearish Divergence",
            "date": current[0]["date"],
            "price_from": previous[0]["price"],
            "price_to": current[0]["price"],
            "indicator_from": previous[1],
            "indicator_to": current[1],
            "plain": "The price is still going up, but the strength behind it is getting weaker.",
            "means": "This often happens before a stock takes a short rest or pulls back.",
            "action": "Consider waiting for a better entry. It can still be okay to hold if you have a long-term view.",
        }
    if len(pairs) == 3:
        first, middle, latest = pairs
        price_rising = first[0]["price"] < middle[0]["price"] < latest[0]["price"]
        rsi_falling = first[1] > middle[1] > latest[1]
        if price_rising and rsi_falling:
            return {
                "type": "RSI Bearish Divergence",
                "date": latest[0]["date"],
                "price_from": first[0]["price"],
                "price_to": latest[0]["price"],
                "indicator_from": first[1],
                "indicator_to": latest[1],
                "plain": "The speed of the climb is getting weaker.",
                "means": "This often happens before a stock pauses or pulls back.",
                "action": "Consider waiting for a better entry. It can still be okay to hold if you have a long-term view.",
            }
    return None


def candle_parts(row: pd.Series) -> tuple[float, float, float, float, float, float]:
    open_price = float(row["open"])
    high = float(row["high"])
    low = float(row["low"])
    close = float(row["close"])
    body = abs(close - open_price)
    full_range = max(high - low, 0.01)
    return open_price, high, low, close, body, full_range


def detect_bearish_reversal_candle(df: pd.DataFrame) -> dict | None:
    if len(df) < 60:
        return None
    recent_high = float(df["high"].tail(60).max())
    last = df.iloc[-1]
    prev = df.iloc[-2]
    third = df.iloc[-3]
    near_high = float(last["high"]) >= recent_high * 0.96 or float(prev["high"]) >= recent_high * 0.96
    if not near_high:
        return None

    open_price, high, low, close, body, full_range = candle_parts(last)
    prev_open, prev_high, prev_low, prev_close, prev_body, prev_range = candle_parts(prev)
    third_open, _, _, third_close, third_body, _ = candle_parts(third)
    upper_shadow = high - max(open_price, close)
    lower_shadow = min(open_price, close) - low

    warning = None
    if upper_shadow >= body * 2 and upper_shadow >= full_range * 0.45 and lower_shadow <= full_range * 0.25 and close < open_price:
        warning = "Shooting Star"
    elif prev_close > prev_open and close < open_price and open_price >= prev_close and close <= prev_open:
        warning = "Bearish Engulfing"
    elif prev_close > prev_open and open_price > prev_close and close < (prev_open + prev_close) / 2 and close > prev_open:
        warning = "Dark Cloud Cover"
    elif third_close > third_open and prev_body <= third_body * 0.55 and close < open_price and close < (third_open + third_close) / 2:
        warning = "Evening Star"

    if not warning:
        return None
    return {
        "type": warning,
        "date": str(df.index[-1].date()) if hasattr(df.index[-1], "date") else str(df.index[-1]),
        "plain": "Recent price action shows sellers stepping in near the high.",
        "means": "The stock may need a short break before trying to move higher again.",
        "action": "Consider waiting for a better entry. If you already own it for the long term, review your risk line calmly.",
    }


def momentum_score(
    rsi_value: float | None,
    macd_line: float | None,
    signal_line: float | None,
    histogram: float | None,
    divergences: list[dict],
    warnings: list[dict] | None = None,
) -> int:
    score = 50
    if rsi_value is not None:
        if 50 < rsi_value <= 68:
            score += 18
        elif 68 < rsi_value <= 75:
            score += 10
        elif 40 <= rsi_value <= 50:
            score += 5
        elif rsi_value < 30:
            score -= 8
        elif rsi_value > 78:
            score -= 12
        else:
            score -= 4
    if macd_line is not None and signal_line is not None and histogram is not None:
        if macd_line > signal_line and macd_line > 0:
            score += 20
        elif macd_line > signal_line:
            score += 10
        elif macd_line < signal_line and macd_line < 0:
            score -= 15
        if histogram > 0:
            score += 5
    for divergence in divergences:
        if divergence["type"].startswith("Bullish"):
            score += 8
        elif divergence["type"].startswith("Bearish"):
            score -= 8
    for warning in warnings or []:
        if warning.get("category") == "momentum":
            score -= 10
        elif warning.get("category") == "candle":
            score -= 7
    return max(0, min(100, round(score)))


def momentum_label(score: int) -> str:
    if score >= 75:
        return "Strong"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Mixed"
    return "Weak"


def plain_summary(result: dict) -> str:
    rsi_value = result.get("rsi")
    if rsi_value is None:
        speed_text = "Momentum is unclear"
    elif rsi_value > 70:
        speed_text = "The recent climb may be getting stretched"
    elif rsi_value >= 50:
        speed_text = "Momentum is supportive"
    elif rsi_value >= 40:
        speed_text = "Momentum is neutral"
    else:
        speed_text = "Momentum needs improvement"
    confirmation_text = "buying pressure is supportive" if result.get("macd_trend") == "Bullish" else "buying pressure is not fully confirmed yet"
    warning_text = ""
    if result.get("warnings"):
        latest = result["warnings"][0]
        warning_text = f" {latest['message']}"
    return f"{speed_text}; {confirmation_text}.{warning_text}"


def analyze_momentum(history: pd.DataFrame, pivots: list[Pivot] | list[dict] | None = None) -> dict:
    df = normalize_ohlc(history)
    close = df["close"]
    rsi_series = rsi_wilder(close)
    macd_line, signal_line, histogram = macd(close)

    current_rsi = None if pd.isna(rsi_series.iloc[-1]) else float(rsi_series.iloc[-1])
    current_macd = None if pd.isna(macd_line.iloc[-1]) else float(macd_line.iloc[-1])
    current_signal = None if pd.isna(signal_line.iloc[-1]) else float(signal_line.iloc[-1])
    current_histogram = None if pd.isna(histogram.iloc[-1]) else float(histogram.iloc[-1])
    macd_trend = "Bullish" if current_macd is not None and current_signal is not None and current_macd > current_signal and current_macd > 0 else "Bearish / neutral"

    divergences: list[dict] = []
    warnings: list[dict] = []
    if pivots:
        lows = pivot_rows(pivots, "low")
        highs = pivot_rows(pivots, "high")
        for oscillator_name, oscillator in [("RSI", rsi_series), ("MACD", macd_line)]:
            bullish = detect_divergence(lows, oscillator, "bullish")
            if bullish:
                bullish["indicator"] = oscillator_name
                divergences.append(bullish)
            bearish = detect_divergence(highs, oscillator, "bearish")
            if bearish:
                bearish["indicator"] = oscillator_name
                divergences.append(bearish)
        rsi_warning = detect_rsi_bearish_divergence(highs, rsi_series)
        if rsi_warning:
            item = warning(rsi_warning["plain"], rsi_warning["means"], rsi_warning["action"], label="Momentum is cooling", category="momentum")
            item["code"] = rsi_warning["type"]
            warnings.append(item)

    candle_warning = detect_bearish_reversal_candle(df)
    if candle_warning:
        item = warning(candle_warning["plain"], candle_warning["means"], candle_warning["action"], label="Time for a breather?", category="candle")
        item["code"] = candle_warning["type"]
        warnings.append(item)

    score = momentum_score(current_rsi, current_macd, current_signal, current_histogram, divergences, warnings)
    result = {
        "rsi": current_rsi,
        "rsi_interpretation": rsi_interpretation(current_rsi),
        "macd": current_macd,
        "macd_signal": current_signal,
        "macd_histogram": current_histogram,
        "macd_trend": macd_trend,
        "divergences": divergences,
        "warnings": warnings,
        "score": score,
        "label": momentum_label(score),
    }
    result["summary"] = plain_summary(result)
    return result
