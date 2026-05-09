"""
Earnings Intelligence Signal
Evaluates upcoming earnings risk and historical EPS surprise trend.
Returns a score modifier and plain-English label/summary.
"""
from __future__ import annotations

from datetime import datetime, timezone


def analyze_earnings(earnings_date: str | None, eps_surprise_avg: float | None = None) -> dict:
    """
    Args:
        earnings_date: ISO date string of next earnings ("YYYY-MM-DD") or None.
        eps_surprise_avg: Average EPS surprise % over last 4 quarters (positive = beat).

    Returns dict with:
        earnings_score_modifier: int (-8 to +3)
        earnings_label: str
        earnings_summary: str
        days_to_earnings: int | None
    """
    days = _days_until(earnings_date)

    modifier = 0
    label = "No earnings signal"
    summary = "No upcoming earnings event in the near-term."

    if days is not None:
        if 0 <= days <= 7:
            modifier = -8
            label = f"Earnings in {days} day{'s' if days != 1 else ''}"
            summary = (
                f"Earnings are in {days} day{'s' if days != 1 else ''}. "
                "Price can move sharply in either direction. New buyers may want to wait "
                "until the earnings reaction settles before entering."
            )
        elif 8 <= days <= 14:
            modifier = -5
            label = f"Earnings in {days} days"
            summary = (
                f"Earnings are {days} days away. "
                "Consider waiting until after the report to reduce short-term uncertainty."
            )
        elif 15 <= days <= 30:
            modifier = -2
            label = f"Earnings in ~{days} days"
            summary = (
                f"Earnings in about {days} days. "
                "Keep position sizing conservative heading into the event."
            )
        elif -7 <= days < 0:
            # Just reported
            abs_days = abs(days)
            if eps_surprise_avg is not None and eps_surprise_avg > 5:
                modifier = 3
                label = "Strong recent earnings beat"
                summary = (
                    f"Just beat estimates by an average of {eps_surprise_avg:.1f}%. "
                    "Positive earnings momentum supports the setup."
                )
            elif eps_surprise_avg is not None and eps_surprise_avg < -5:
                modifier = -4
                label = "Recent earnings miss"
                summary = (
                    f"Recently missed estimates by {abs(eps_surprise_avg):.1f}%. "
                    "Post-earnings pressure may continue near term."
                )
            else:
                modifier = 0
                label = "Just reported earnings"
                summary = (
                    f"Reported earnings {abs_days} day{'s' if abs_days != 1 else ''} ago. "
                    "The stock may need time to settle into the new range."
                )
        else:
            # No near-term earnings — evaluate historical surprise trend
            if eps_surprise_avg is not None:
                if eps_surprise_avg > 5:
                    modifier = 2
                    label = "Consistent earnings beats"
                    summary = (
                        f"Has beaten estimates by an average of {eps_surprise_avg:.1f}% recently. "
                        "A track record of positive surprises adds confidence."
                    )
                elif eps_surprise_avg < -5:
                    modifier = -2
                    label = "Earnings miss trend"
                    summary = (
                        f"Has been missing estimates by {abs(eps_surprise_avg):.1f}% on average. "
                        "An inconsistent earnings track record adds some risk."
                    )
                else:
                    modifier = 0
                    label = "Earnings in line"
                    summary = "Earnings have been roughly in line with expectations. Neutral signal."
            else:
                modifier = 0
                label = "No near-term earnings"
                summary = "No earnings event approaching in the next 30 days. Low earnings-driven risk right now."
    else:
        # No earnings date known
        if eps_surprise_avg is not None and eps_surprise_avg > 5:
            modifier = 2
            label = "Consistent earnings beats"
            summary = (
                f"Has beaten estimates by an average of {eps_surprise_avg:.1f}% recently. "
                "Positive earnings momentum."
            )
        elif eps_surprise_avg is not None and eps_surprise_avg < -5:
            modifier = -1
            label = "Earnings miss trend"
            summary = f"Has been missing estimates by {abs(eps_surprise_avg):.1f}% on average recently."

    return {
        "days_to_earnings": days,
        "earnings_score_modifier": modifier,
        "earnings_label": label,
        "earnings_summary": summary,
    }


def fetch_eps_surprise_avg(symbol: str) -> float | None:
    """Fetch average EPS surprise % over last 4 quarters via yfinance."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        # Try earnings_history first (newer yfinance)
        hist = getattr(ticker, "earnings_history", None)
        if hist is None:
            hist = getattr(ticker, "quarterly_earnings", None)
        if hist is None or (hasattr(hist, "empty") and hist.empty):
            return None

        # Look for 'Surprise(%)' column
        for col in ["Surprise(%)", "surprisePercent", "Surprise"]:
            if col in hist.columns:
                values = hist[col].dropna().tail(4).tolist()
                if values:
                    return round(sum(values) / len(values), 1)
    except Exception:
        pass
    return None


def _days_until(date_text: str | None) -> int | None:
    if not date_text:
        return None
    try:
        target = datetime.fromisoformat(str(date_text).replace("Z", "+00:00"))
    except ValueError:
        return None
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    today = datetime.now(timezone.utc).date()
    return (target.date() - today).days
