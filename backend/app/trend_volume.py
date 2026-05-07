from __future__ import annotations

import numpy as np
import pandas as pd

from .pivots import normalize_ohlc, weekly_ohlc


def wilder_smooth(series: pd.Series, period: int) -> pd.Series:
    smoothed = pd.Series(index=series.index, dtype="float64")
    if len(series) < period:
        return smoothed
    first = series.iloc[:period].sum()
    smoothed.iloc[period - 1] = first
    for index in range(period, len(series)):
        smoothed.iloc[index] = smoothed.iloc[index - 1] - (smoothed.iloc[index - 1] / period) + series.iloc[index]
    return smoothed


def calculate_adx(history: pd.DataFrame, period: int = 14) -> dict:
    df = normalize_ohlc(history)
    high = df["high"]
    low = df["low"]
    close = df["close"]

    up_move = high.diff()
    down_move = low.shift(1) - low
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)

    prev_close = close.shift(1)
    tr = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr_sum = wilder_smooth(tr, period)
    plus_di = 100 * (wilder_smooth(plus_dm, period) / atr_sum.replace(0, np.nan))
    minus_di = 100 * (wilder_smooth(minus_dm, period) / atr_sum.replace(0, np.nan))
    dx = 100 * ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    adx = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()

    current_adx = None if pd.isna(adx.iloc[-1]) else float(adx.iloc[-1])
    current_plus_di = None if pd.isna(plus_di.iloc[-1]) else float(plus_di.iloc[-1])
    current_minus_di = None if pd.isna(minus_di.iloc[-1]) else float(minus_di.iloc[-1])
    direction = "Bullish" if current_plus_di is not None and current_minus_di is not None and current_plus_di > current_minus_di else "Bearish / neutral"
    if current_adx is None:
        interpretation = "Unavailable"
    elif current_adx > 40:
        interpretation = "Very strong trend"
    elif current_adx > 25:
        interpretation = "Strong trend"
    elif current_adx > 18:
        interpretation = "Developing trend"
    else:
        interpretation = "Weak trend"

    return {
        "adx": current_adx,
        "plus_di": current_plus_di,
        "minus_di": current_minus_di,
        "adx_interpretation": interpretation,
        "trend_direction": direction,
    }


def calculate_obv(history: pd.DataFrame) -> pd.Series:
    df = normalize_ohlc(history)
    close = df["close"]
    volume = df["volume"]
    direction = np.where(close > close.shift(1), 1, np.where(close < close.shift(1), -1, 0))
    return pd.Series(direction * volume, index=df.index).fillna(0).cumsum()


def obv_trend(history: pd.DataFrame, lookback: int = 25) -> dict:
    obv = calculate_obv(history)
    if len(obv) < lookback:
        return {"obv": None, "obv_trend": "Unavailable"}
    start = float(obv.iloc[-lookback])
    end = float(obv.iloc[-1])
    scale = max(abs(start), abs(end), 1)
    change_pct = ((end - start) / scale) * 100
    if change_pct > 3:
        trend = "Rising"
    elif change_pct < -3:
        trend = "Falling"
    else:
        trend = "Flat"
    return {"obv": end, "obv_trend": trend, "obv_change_pct": change_pct}


def trend_alignment(history: pd.DataFrame) -> dict:
    daily = normalize_ohlc(history)
    weekly = weekly_ohlc(history)

    def aligned(df: pd.DataFrame) -> bool:
        if len(df) < 50:
            return False
        close = df["close"]
        ma50 = close.rolling(50).mean().iloc[-1]
        ma200 = close.rolling(200).mean().iloc[-1] if len(df) >= 200 else np.nan
        price = close.iloc[-1]
        if not pd.isna(ma200):
            return bool(price > ma50 and price > ma200)
        return bool(price > ma50)

    daily_up = aligned(daily)
    weekly_up = aligned(weekly)
    if daily_up and weekly_up:
        label = "Daily & weekly aligned"
        score = 100
    elif daily_up:
        label = "Daily improving, weekly not confirmed"
        score = 65
    elif weekly_up:
        label = "Weekly constructive, daily needs repair"
        score = 55
    else:
        label = "Daily & weekly not aligned"
        score = 30
    return {"daily_trend_aligned": daily_up, "weekly_trend_aligned": weekly_up, "trend_alignment": label, "trend_alignment_score": score}


def volume_confirmation(history: pd.DataFrame) -> dict:
    df = normalize_ohlc(history)
    close = df["close"]
    volume = df["volume"]
    if len(df) < 20:
        return {"volume_confirmation": "Unavailable"}
    volume_vs_20d = float(volume.iloc[-1] / volume.rolling(20).mean().iloc[-1])
    up_days = close > close.shift(1)
    recent = df.tail(20)
    recent_up_days = up_days.tail(20)
    up_volume = recent.loc[recent_up_days, "volume"].mean()
    down_volume = recent.loc[~recent_up_days, "volume"].mean()
    rising_on_advances = bool(not pd.isna(up_volume) and not pd.isna(down_volume) and up_volume > down_volume * 1.05)
    if volume_vs_20d >= 1.2 and rising_on_advances:
        label = "Supportive"
        score = 90
    elif volume_vs_20d >= 1.0 or rising_on_advances:
        label = "Constructive"
        score = 70
    elif volume_vs_20d < 0.75:
        label = "Quiet"
        score = 45
    else:
        label = "Neutral"
        score = 55
    return {
        "volume_vs_20d": volume_vs_20d,
        "rising_volume_on_up_days": rising_on_advances,
        "volume_confirmation": label,
        "volume_confirmation_score": score,
    }


def analyze_trend_volume(history: pd.DataFrame) -> dict:
    adx = calculate_adx(history)
    obv = obv_trend(history)
    alignment = trend_alignment(history)
    volume = volume_confirmation(history)
    adx_value = adx.get("adx")
    volume_ratio = volume.get("volume_vs_20d")

    trend_score = 50
    if adx_value is not None:
        if adx_value > 40:
            trend_score += 25
        elif adx_value > 25:
            trend_score += 18
        elif adx_value < 18:
            trend_score -= 10
    trend_score = max(0, min(100, round((trend_score * 0.55) + (alignment["trend_alignment_score"] * 0.45))))

    if trend_score >= 75:
        trend_label = "Strong"
    elif trend_score >= 60:
        trend_label = "Good"
    elif trend_score >= 40:
        trend_label = "Mixed"
    else:
        trend_label = "Weak"

    trend_summary = f"{adx.get('adx_interpretation')} ({adx_value:.1f} ADX), {alignment['trend_alignment'].lower()}." if adx_value is not None else alignment["trend_alignment"]
    volume_summary = (
        f"{volume.get('volume_confirmation')} ({volume_ratio:.1f}x 20-day average, "
        f"{'rising on up days' if volume.get('rising_volume_on_up_days') else 'not clearly rising on up days'})."
        if volume_ratio is not None
        else "Volume confirmation is unavailable."
    )

    return {
        **adx,
        **obv,
        **alignment,
        **volume,
        "trend_strength_score": trend_score,
        "trend_strength_label": trend_label,
        "trend_strength_summary": trend_summary,
        "volume_confirmation_summary": volume_summary,
    }
