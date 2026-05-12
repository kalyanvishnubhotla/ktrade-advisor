"""
Market Regime Engine
Uses VIX level + SPY/QQQ/IWM breadth to classify the macro environment.
Returns a regime label and score modifier applied to every ticker score.

Regime states:
  Expansion   — Broad market healthy, VIX calm.        Modifier: +5
  Caution     — Market stretched or VIX elevating.     Modifier: -2
  Distribution— Clear selling pressure building.       Modifier: -7
  Risk-Off    — High volatility / market breakdown.    Modifier: -12
"""
from __future__ import annotations


REGIME_META: dict[str, dict] = {
    "Expansion": {
        "modifier": 5,
        "description": "Market conditions are broad-based and healthy. Quality setups have a helpful tailwind.",
    },
    "Caution": {
        "modifier": -2,
        "description": "Market is healthy but becoming selective. Favor higher-quality setups and watch position size.",
    },
    "Distribution": {
        "modifier": -7,
        "description": "Selling pressure is building across the market. Stay defensive and require higher-quality setups.",
    },
    "Risk-Off": {
        "modifier": -12,
        "description": "High-risk environment. Raising cash and waiting for clarity is a valid choice.",
    },
}


def analyze_market_regime(
    spy_ind: dict | None = None,
    qqq_ind: dict | None = None,
    iwm_ind: dict | None = None,
    vix: float | None = None,
) -> dict:
    """
    Args:
        spy_ind: Indicators dict for SPY (output of compute_indicators).
        qqq_ind: Indicators dict for QQQ.
        iwm_ind: Indicators dict for IWM (Russell 2000, optional).
        vix: Latest VIX closing price, or None (will attempt live fetch).

    Returns dict with:
        regime_label: str
        regime_vix: float | None
        regime_breadth_score: int (0-9)
        regime_score_modifier: int
        regime_summary: str
    """
    # Try to fetch live VIX if not supplied
    if vix is None:
        vix = _fetch_vix()

    breadth = _breadth_score(spy_ind) + _breadth_score(qqq_ind) + _breadth_score(iwm_ind)

    regime = _classify(vix, breadth)
    meta = REGIME_META[regime]

    vix_str = f" VIX is {vix:.1f}." if vix is not None else ""
    summary = meta["description"] + vix_str

    return {
        "regime_label": regime,
        "regime_vix": round(vix, 1) if vix is not None else None,
        "regime_breadth_score": breadth,
        "regime_score_modifier": meta["modifier"],
        "regime_summary": summary,
    }


def _fetch_vix() -> float | None:
    try:
        import yfinance as yf
        data = yf.download("^VIX", period="5d", auto_adjust=True, progress=False)
        if data.empty:
            return None
        close_col = "close" if "close" in [str(c).lower() for c in data.columns] else data.columns[-1]
        return float(data[close_col].iloc[-1])
    except Exception:
        return None


def _breadth_score(ind: dict | None) -> int:
    """0-3 points per index based on MA alignment."""
    if not ind:
        return 0
    pts = 0
    price = ind.get("price") or 0
    if price and ind.get("ma50") and price > ind["ma50"]:
        pts += 1
    if price and ind.get("ma200") and price > ind["ma200"]:
        pts += 1
    if ind.get("ma20") and ind.get("ma50") and ind["ma20"] > ind["ma50"]:
        pts += 1
    return pts


def _classify(vix: float | None, breadth: int) -> str:
    """
    2×2 decision matrix: VIX level × breadth score.
    breadth is 0-9 (3 indices × 3 points each).
    """
    if vix is None:
        # Rely on breadth alone
        if breadth >= 7:
            return "Expansion"
        if breadth >= 4:
            return "Caution"
        if breadth >= 1:
            return "Distribution"
        return "Risk-Off"

    if vix > 35:
        return "Risk-Off"

    if vix > 25:
        return "Risk-Off" if breadth <= 3 else "Distribution"

    if vix > 20:
        if breadth >= 7:
            return "Caution"
        if breadth >= 4:
            return "Caution"
        return "Distribution"

    if vix > 16:
        if breadth >= 7:
            return "Expansion"
        if breadth >= 4:
            return "Caution"
        return "Distribution"

    # VIX ≤ 16 — calm volatility
    if breadth >= 7:
        return "Expansion"
    if breadth >= 4:
        return "Caution"
    return "Distribution"
