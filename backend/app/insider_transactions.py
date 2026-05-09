"""
Insider Transactions Signal
Analyses yfinance insider transaction data to detect cluster buys/sells
within the last 90 days.

Score modifier range: -5 (heavy selling) to +8 (cluster buys).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd


def analyze_insider_activity(insider_df: pd.DataFrame | None) -> dict:
    """
    Args:
        insider_df: DataFrame from yf.Ticker(symbol).insider_transactions.
                    May be None or empty if data is unavailable.

    Returns dict with:
        insider_buy_count: int
        insider_sell_count: int
        insider_net_value: float (positive = net buying in $)
        insider_score_modifier: int (-5 to +8)
        insider_label: str
        insider_summary: str
    """
    result: dict = {
        "insider_buy_count": 0,
        "insider_sell_count": 0,
        "insider_net_value": 0.0,
        "insider_score_modifier": 0,
        "insider_label": "No recent activity",
        "insider_summary": "No significant insider transactions in the last 90 days.",
    }

    if insider_df is None or (hasattr(insider_df, "empty") and insider_df.empty):
        return result

    try:
        df = insider_df.copy()

        # ── Detect date column ─────────────────────────────────────────────
        date_col = None
        for candidate in ["Date", "Start Date", "date", "startDate"]:
            if candidate in df.columns:
                date_col = candidate
                break

        cutoff = datetime.now(timezone.utc) - timedelta(days=90)

        if date_col:
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce", utc=True)
            df = df[df[date_col].notna() & (df[date_col] >= cutoff)]

        if df.empty:
            return result

        # ── Classify each row ──────────────────────────────────────────────
        buy_count = 0
        sell_count = 0
        net_value = 0.0

        # Text columns that describe transaction type
        text_cols = [c for c in ["Text", "Transaction", "transaction", "transactionText"] if c in df.columns]

        for _, row in df.iterrows():
            text = " ".join(str(row.get(c) or "") for c in text_cols).lower()
            value = _safe_float(row.get("Value") or row.get("value"))
            shares = _safe_float(row.get("Shares") or row.get("shares"))

            is_buy = any(w in text for w in ["purchase", "buy", "bought", "acquisition", "acquired", "open market purchase"])
            is_sell = any(w in text for w in ["sale", "sell", "sold", "dispose", "disposed", "open market sale"])

            # Fallback: if shares positive → buy, negative → sell
            if not is_buy and not is_sell and shares is not None:
                if shares > 0:
                    is_buy = True
                elif shares < 0:
                    is_sell = True

            if is_buy:
                buy_count += 1
                net_value += value or 0
            elif is_sell:
                sell_count += 1
                net_value -= value or 0

        result["insider_buy_count"] = buy_count
        result["insider_sell_count"] = sell_count
        result["insider_net_value"] = round(net_value, 0)

        # ── Score modifier ─────────────────────────────────────────────────
        if buy_count >= 3 and sell_count == 0:
            modifier = 8
            label = "Cluster insider buys"
            summary = (
                f"{buy_count} insiders bought in the last 90 days with no sells. "
                "Strong insider conviction is a meaningful positive signal."
            )
        elif buy_count >= 2 and buy_count > sell_count:
            modifier = 5
            label = "Multiple insider buys"
            summary = (
                f"{buy_count} insider buys vs {sell_count} sells recently. "
                "Insiders are net buyers — a positive signal."
            )
        elif buy_count == 1 and sell_count == 0:
            modifier = 2
            label = "Insider buy signal"
            summary = "One insider bought recently with no offsetting sells. Mild positive signal."
        elif sell_count >= 3 and buy_count == 0:
            modifier = -5
            label = "Cluster insider selling"
            summary = (
                f"{sell_count} insiders sold in the last 90 days. "
                "Heavy insider selling without any buys is a caution flag."
            )
        elif sell_count >= 2 and sell_count > buy_count:
            modifier = -3
            label = "Multiple insider sells"
            summary = (
                f"{sell_count} insider sells vs {buy_count} buys recently. "
                "Insiders are net sellers — worth monitoring."
            )
        elif sell_count == 1 and buy_count == 0:
            modifier = -1
            label = "Insider sell signal"
            summary = "One insider sold recently. Modest caution — lone sales are common and not always bearish."
        elif buy_count > 0 and sell_count > 0:
            modifier = 0
            label = "Mixed insider activity"
            summary = (
                f"{buy_count} insider buy(s) and {sell_count} sell(s) in the last 90 days. "
                "Mixed signals — no clear directional conviction."
            )
        else:
            modifier = 0
            label = "No recent activity"
            summary = "No significant insider transactions found in the last 90 days."

        result["insider_score_modifier"] = modifier
        result["insider_label"] = label
        result["insider_summary"] = summary

    except Exception:
        pass

    return result


def fetch_insider_transactions(symbol: str) -> pd.DataFrame | None:
    """Fetch insider transaction DataFrame from yfinance."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        return ticker.insider_transactions
    except Exception:
        return None


def _safe_float(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
