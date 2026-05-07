from __future__ import annotations

from dataclasses import asdict

import pandas as pd

from .pivots import Pivot, normalize_ohlc


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


def momentum_score(rsi_value: float | None, macd_line: float | None, signal_line: float | None, histogram: float | None, divergences: list[dict]) -> int:
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
    rsi_text = result.get("rsi_interpretation", "Unavailable").lower()
    macd_text = "MACD is supportive" if result.get("macd_trend") == "Bullish" else "MACD is not yet supportive"
    divergence_text = ""
    if result.get("divergences"):
        latest = result["divergences"][-1]
        divergence_text = f" {latest['type']} is present, so watch confirmation carefully."
    rsi_piece = f"RSI {rsi_value:.1f} is {rsi_text}" if rsi_value is not None else "RSI is unavailable"
    return f"{rsi_piece}; {macd_text}.{divergence_text}"


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

    score = momentum_score(current_rsi, current_macd, current_signal, current_histogram, divergences)
    result = {
        "rsi": current_rsi,
        "rsi_interpretation": rsi_interpretation(current_rsi),
        "macd": current_macd,
        "macd_signal": current_signal,
        "macd_histogram": current_histogram,
        "macd_trend": macd_trend,
        "divergences": divergences,
        "score": score,
        "label": momentum_label(score),
    }
    result["summary"] = plain_summary(result)
    return result
