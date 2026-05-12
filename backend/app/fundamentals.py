"""
Fundamentals Quality Layer
Evaluates business quality from yfinance ticker.info:
  - Revenue growth
  - Profit margin
  - EPS / earnings growth
  - Debt-to-equity ratio
  - P/E valuation sanity check

Score modifier range: -8 (poor fundamentals) to +8 (strong fundamentals).
ETFs return a neutral result (no fundamental score applied).
"""
from __future__ import annotations


def analyze_fundamentals(info: dict, asset_type: str = "stock") -> dict:
    """
    Args:
        info: Raw dict from yf.Ticker(symbol).get_info().
        asset_type: "stock" or "etf". ETFs skip fundamental scoring.

    Returns dict with:
        fundamentals_pe: float | None
        fundamentals_revenue_growth: float | None  (%)
        fundamentals_profit_margin: float | None   (%)
        fundamentals_debt_to_equity: float | None
        fundamentals_eps_growth: float | None      (%)
        fundamentals_score_modifier: int (-8 to +8)
        fundamentals_label: str
        fundamentals_summary: str
    """
    result: dict = {
        "fundamentals_pe": None,
        "fundamentals_revenue_growth": None,
        "fundamentals_profit_margin": None,
        "fundamentals_debt_to_equity": None,
        "fundamentals_eps_growth": None,
        "fundamentals_score_modifier": 0,
        "fundamentals_label": "N/A",
        "fundamentals_summary": "Fundamental analysis not applicable.",
    }

    # ETFs don't have traditional fundamentals
    if asset_type == "etf":
        result["fundamentals_summary"] = "Fundamental scoring is not applied to ETFs."
        return result

    if not info:
        result["fundamentals_label"] = "No data"
        result["fundamentals_summary"] = "Fundamental data not available for this ticker."
        return result

    try:
        # ── Extract raw values ─────────────────────────────────────────────
        pe = _safe(info.get("trailingPE") or info.get("forwardPE"))
        rev_growth = _safe(info.get("revenueGrowth"))          # decimal (0.15 = 15%)
        profit_margin = _safe(info.get("profitMargins"))        # decimal
        dte = _safe(info.get("debtToEquity"))                   # percentage (50 = 50%)
        eps_growth = _safe(info.get("earningsGrowth"))          # decimal

        # Store as rounded display values
        result["fundamentals_pe"] = round(pe, 1) if pe is not None else None
        result["fundamentals_revenue_growth"] = round(rev_growth * 100, 1) if rev_growth is not None else None
        result["fundamentals_profit_margin"] = round(profit_margin * 100, 1) if profit_margin is not None else None
        result["fundamentals_debt_to_equity"] = round(dte, 1) if dte is not None else None
        result["fundamentals_eps_growth"] = round(eps_growth * 100, 1) if eps_growth is not None else None

        # ── Score each factor ──────────────────────────────────────────────
        points = 0
        factors = 0

        # Revenue growth
        if rev_growth is not None:
            factors += 1
            if rev_growth > 0.25:
                points += 3
            elif rev_growth > 0.12:
                points += 2
            elif rev_growth > 0.03:
                points += 1
            elif rev_growth < -0.05:
                points -= 2
            elif rev_growth < 0:
                points -= 1

        # Profit margin
        if profit_margin is not None:
            factors += 1
            if profit_margin > 0.25:
                points += 3
            elif profit_margin > 0.15:
                points += 2
            elif profit_margin > 0.05:
                points += 1
            elif profit_margin < 0:
                points -= 2

        # EPS growth
        if eps_growth is not None:
            factors += 1
            if eps_growth > 0.25:
                points += 2
            elif eps_growth > 0.08:
                points += 1
            elif eps_growth < -0.10:
                points -= 2
            elif eps_growth < 0:
                points -= 1

        # Debt to equity (lower → safer)
        if dte is not None:
            factors += 1
            if dte < 30:
                points += 2
            elif dte < 80:
                points += 1
            elif dte > 200:
                points -= 2
            elif dte > 120:
                points -= 1

        # PE valuation check
        if pe is not None:
            factors += 1
            if 8 < pe < 20:
                points += 1          # reasonable value
            elif pe > 80:
                points -= 1         # stretched valuation
            elif pe > 50:
                pass                # neutral — growth stocks can be expensive

        if factors == 0:
            result["fundamentals_label"] = "No data"
            result["fundamentals_summary"] = "Fundamental data not available for this ticker."
            return result

        # Normalise to -8..+8 range
        # Max possible points ≈ 3+3+2+2+1 = 11, min ≈ -2-2-2-2-1 = -9
        modifier = max(-8, min(8, round(points * 8 / 11)))

        # ── Build label and summary ────────────────────────────────────────
        if modifier >= 6:
            label = "Strong fundamentals"
        elif modifier >= 3:
            label = "Good fundamentals"
        elif modifier >= 0:
            label = "Mixed fundamentals"
        elif modifier >= -3:
            label = "Weak fundamentals"
        else:
            label = "Poor fundamentals"

        summary = _build_summary(label, rev_growth, profit_margin, eps_growth, dte)

        result["fundamentals_score_modifier"] = modifier
        result["fundamentals_label"] = label
        result["fundamentals_summary"] = summary

    except Exception:
        pass

    return result


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe(value: object) -> float | None:
    try:
        if value is None:
            return None
        import math
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _build_summary(quality: str, rev_growth, profit_margin, eps_growth, dte) -> str:
    quality_phrase = {
        "Strong fundamentals": "The underlying business is in strong shape.",
        "Good fundamentals": "The business fundamentals are solid.",
        "Mixed fundamentals": "Fundamentals present a mixed picture.",
        "Weak fundamentals": "Some fundamental weaknesses are worth noting.",
        "Poor fundamentals": "Fundamental challenges add risk to the trade.",
    }.get(quality, "")

    parts: list[str] = []
    if rev_growth is not None:
        pct = round(rev_growth * 100, 1)
        direction = "growing" if pct >= 0 else "declining"
        parts.append(f"revenue {direction} at {abs(pct):.1f}%")
    if profit_margin is not None:
        pct = round(profit_margin * 100, 1)
        parts.append(f"profit margin {pct:.1f}%")
    if eps_growth is not None:
        pct = round(eps_growth * 100, 1)
        parts.append(f"EPS growth {pct:.1f}%")
    if dte is not None:
        parts.append(f"debt/equity {dte:.0f}%")

    if parts:
        detail = "; ".join(parts[:3]).capitalize() + "."
    else:
        detail = "Limited fundamental data available."

    return f"{quality_phrase} {detail}".strip()
