"""
Sector Relative Strength Signal
Compares ticker performance vs its GICS sector ETF over 13w / 26w / 52w.
Returns a score modifier and plain-English label/summary.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# GICS sector → Select Sector SPDR ETF mapping
SECTOR_ETF_MAP: dict[str, str] = {
    "Technology": "XLK",
    "Health Care": "XLV",
    "Healthcare": "XLV",
    "Financials": "XLF",
    "Financial Services": "XLF",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Industrials": "XLI",
    "Energy": "XLE",
    "Utilities": "XLU",
    "Materials": "XLB",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
    "Telecommunications": "XLC",
}


def analyze_sector_rs(
    ticker_history: pd.DataFrame,
    sector: str | None,
    sector_etf_history: pd.DataFrame | None = None,
) -> dict:
    """
    Args:
        ticker_history: Daily OHLCV DataFrame for the ticker (1+ year).
        sector: GICS sector string from yfinance info (e.g. "Technology").
        sector_etf_history: Pre-fetched daily OHLCV for the sector ETF. If None
            the module will attempt to fetch it via yfinance.

    Returns dict with:
        sector_etf: str | None
        sector_rs_13w: float | None   (ticker return − sector ETF return, %)
        sector_rs_26w: float | None
        sector_rs_52w: float | None
        sector_rs_score_modifier: int (-8 to +8)
        sector_rs_label: str
        sector_rs_summary: str
    """
    result: dict = {
        "sector_etf": None,
        "sector_rs_13w": None,
        "sector_rs_26w": None,
        "sector_rs_52w": None,
        "sector_rs_score_modifier": 0,
        "sector_rs_label": "No sector data",
        "sector_rs_summary": "Could not compute sector relative strength.",
    }

    if ticker_history is None or ticker_history.empty:
        return result

    etf_symbol = SECTOR_ETF_MAP.get(sector or "")
    if not etf_symbol:
        result["sector_rs_summary"] = "Sector not recognized or not applicable (e.g. ETF)."
        return result

    result["sector_etf"] = etf_symbol

    # Fetch sector ETF if not provided
    if sector_etf_history is None or sector_etf_history.empty:
        try:
            import yfinance as yf
            sector_etf_history = yf.download(etf_symbol, period="1y", auto_adjust=True, progress=False)
        except Exception:
            result["sector_rs_summary"] = "Could not fetch sector ETF data."
            return result

    if sector_etf_history is None or sector_etf_history.empty:
        return result

    # Normalise column names
    ticker_hist = ticker_history.copy()
    ticker_hist.columns = [str(c).lower() for c in ticker_hist.columns]
    etf_hist = sector_etf_history.copy()
    etf_hist.columns = [str(c).lower() for c in etf_hist.columns]

    ticker_close = ticker_hist["close"] if "close" in ticker_hist.columns else ticker_hist.iloc[:, 3]
    etf_close = etf_hist["close"] if "close" in etf_hist.columns else etf_hist.iloc[:, 3]

    # Compute returns for 13w (65 bars), 26w (130 bars), 52w (252 bars)
    periods = {"13w": 65, "26w": 130, "52w": 252}
    rs_values: dict[str, float] = {}
    for name, bars in periods.items():
        if len(ticker_close) >= bars and len(etf_close) >= bars:
            try:
                t_ret = float(ticker_close.iloc[-1] / ticker_close.iloc[-bars] - 1) * 100
                e_ret = float(etf_close.iloc[-1] / etf_close.iloc[-bars] - 1) * 100
                rs_values[name] = round(t_ret - e_ret, 2)
            except Exception:
                pass

    if not rs_values:
        result["sector_rs_summary"] = "Not enough price history for sector RS calculation."
        return result

    result["sector_rs_13w"] = rs_values.get("13w")
    result["sector_rs_26w"] = rs_values.get("26w")
    result["sector_rs_52w"] = rs_values.get("52w")

    # Weighted composite: weight recent periods more
    weights = {"13w": 0.5, "26w": 0.3, "52w": 0.2}
    weighted_sum = sum(rs_values[k] * weights[k] for k in rs_values)
    weight_total = sum(weights[k] for k in rs_values)
    rs_avg = weighted_sum / weight_total if weight_total else 0.0

    # Score modifier and label
    if rs_avg > 15:
        modifier, label = 8, "Strong sector leader"
        summary = (
            f"Significantly outperforming the {sector} sector "
            f"(weighted avg +{rs_avg:.1f}%). Strong relative strength adds conviction."
        )
    elif rs_avg > 7:
        modifier, label = 5, "Sector outperformer"
        summary = (
            f"Outperforming the {sector} sector (weighted avg +{rs_avg:.1f}%). "
            "Relative strength supports the setup."
        )
    elif rs_avg > 2:
        modifier, label = 2, "Slight sector outperformer"
        summary = (
            f"Slightly ahead of the {sector} sector (weighted avg +{rs_avg:.1f}%). "
            "Modest relative strength."
        )
    elif rs_avg >= -2:
        modifier, label = 0, "In-line with sector"
        summary = (
            f"Moving in line with the {sector} sector. "
            "Neutral relative strength — neither a headwind nor a tailwind."
        )
    elif rs_avg >= -7:
        modifier, label = -3, "Slight sector underperformer"
        summary = (
            f"Lagging the {sector} sector (weighted avg {rs_avg:.1f}%). "
            "Mild relative weakness — worth monitoring."
        )
    elif rs_avg >= -15:
        modifier, label = -6, "Sector underperformer"
        summary = (
            f"Underperforming the {sector} sector (weighted avg {rs_avg:.1f}%). "
            "Relative weakness is a meaningful concern."
        )
    else:
        modifier, label = -8, "Significant sector laggard"
        summary = (
            f"Significantly lagging the {sector} sector (weighted avg {rs_avg:.1f}%). "
            "Strong relative weakness — consider waiting for sector rotation."
        )

    result["sector_rs_score_modifier"] = modifier
    result["sector_rs_label"] = label
    result["sector_rs_summary"] = summary
    return result


def get_sector_etf(sector: str | None) -> str | None:
    """Return the ETF ticker for a given GICS sector name, or None."""
    return SECTOR_ETF_MAP.get(sector or "")
