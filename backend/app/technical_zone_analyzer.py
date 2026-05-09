from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

from .analysis import compute_indicators, score_ticker
from .earnings_intelligence import analyze_earnings, fetch_eps_surprise_avg
from .fibonacci import FibSetup, FibZone, calculate_fib_extensions, calculate_recent_fib_zones
from .fundamentals import analyze_fundamentals
from .insider_transactions import analyze_insider_activity, fetch_insider_transactions
from .momentum import analyze_momentum
from .pivots import Pivot, detect_multi_timeframe_pivots, major_swings, nearest_support_resistance
from .sector_relative_strength import analyze_sector_rs
from .zones import SRZone, calculate_sr_zones, recommendation_zones


@dataclass
class TechnicalZoneAnalysis:
    symbol: str
    history: pd.DataFrame
    info: dict
    indicators: dict
    pivots: list[Pivot]
    fib_setup: FibSetup | None
    fib_zones: list[FibZone]
    sr_zones: list[SRZone]
    buy_zone: dict | None
    target_zones: list[dict]
    fib_extensions: dict[str, float | None]
    score: dict
    used_fallback: bool
    fallback_reason: str


class TechnicalZoneAnalyzer:
    def __init__(self, period: str = "2y") -> None:
        self.period = period

    def fetch_latest_data(self, symbol: str) -> tuple[pd.DataFrame, dict]:
        ticker = yf.Ticker(symbol)
        history = ticker.history(period=self.period, auto_adjust=False)
        info: dict = {}
        try:
            raw_info = ticker.get_info()
            asset_type = "etf" if raw_info.get("quoteType") == "ETF" else "stock"
            info = {
                "company": raw_info.get("shortName") or raw_info.get("longName"),
                "asset_type": asset_type,
                # Sector (used by sector_relative_strength)
                "sector": raw_info.get("sector"),
                # Fundamentals raw fields (used by fundamentals module)
                "_raw_info": raw_info,
            }
            earnings_date = self.next_earnings_date(ticker)
            if earnings_date:
                info["earnings_date"] = earnings_date
            # EPS surprise average (used by earnings_intelligence)
            try:
                info["eps_surprise_avg"] = fetch_eps_surprise_avg(symbol)
            except Exception:
                info["eps_surprise_avg"] = None
            # Insider transactions DataFrame
            try:
                info["_insider_df"] = ticker.insider_transactions
            except Exception:
                info["_insider_df"] = None
        except Exception:
            info = {}
        return history, info

    def next_earnings_date(self, ticker: yf.Ticker) -> str | None:
        candidates: list[pd.Timestamp] = []
        try:
            dates = ticker.get_earnings_dates(limit=4)
            if dates is not None and not dates.empty:
                candidates.extend(pd.Timestamp(index_value) for index_value in dates.index)
        except Exception:
            pass
        try:
            calendar = ticker.calendar
            if isinstance(calendar, dict):
                for value in calendar.values():
                    if isinstance(value, (list, tuple)):
                        candidates.extend(pd.Timestamp(item) for item in value if item is not None)
                    elif value is not None:
                        candidates.append(pd.Timestamp(value))
        except Exception:
            pass
        if not candidates:
            return None
        now = pd.Timestamp(datetime.now(timezone.utc))
        normalized = []
        for candidate in candidates:
            if candidate.tzinfo is None:
                candidate = candidate.tz_localize("UTC")
            else:
                candidate = candidate.tz_convert("UTC")
            normalized.append(candidate)
        future = sorted([candidate for candidate in normalized if candidate >= now])
        chosen = future[0] if future else max(normalized)
        return chosen.date().isoformat()

    def analyze(
        self,
        symbol: str,
        history: pd.DataFrame | None = None,
        spy_history: pd.DataFrame | None = None,
        research_signals: list[dict] | None = None,
        regime_data: dict | None = None,
        sector_etf_history: pd.DataFrame | None = None,
    ) -> TechnicalZoneAnalysis:
        if history is None:
            history, info = self.fetch_latest_data(symbol)
        else:
            info = {}
        if history.empty:
            raise ValueError("No price data returned")

        signals = research_signals or []
        indicators = compute_indicators(history, spy_history)
        if info.get("earnings_date"):
            indicators["earnings_date"] = info["earnings_date"]

        # ── New signal modules ─────────────────────────────────────────────
        # 1. Earnings Intelligence
        try:
            earnings_sig = analyze_earnings(
                earnings_date=info.get("earnings_date"),
                eps_surprise_avg=info.get("eps_surprise_avg"),
            )
            indicators.update(earnings_sig)
        except Exception:
            pass

        # 2. Sector Relative Strength
        try:
            sector_sig = analyze_sector_rs(
                ticker_history=history,
                sector=info.get("sector"),
                sector_etf_history=sector_etf_history,
            )
            indicators.update(sector_sig)
        except Exception:
            pass

        # 3. Market Regime (use pre-computed if available)
        try:
            if regime_data:
                indicators.update(regime_data)
            # If not provided, regime_data will be computed in market_data.py and merged later
        except Exception:
            pass

        # 4. Insider Transactions
        try:
            insider_sig = analyze_insider_activity(info.get("_insider_df"))
            indicators.update(insider_sig)
        except Exception:
            pass

        # 5. Fundamentals Quality
        try:
            fund_sig = analyze_fundamentals(
                info=info.get("_raw_info") or {},
                asset_type=info.get("asset_type", "stock"),
            )
            indicators.update(fund_sig)
        except Exception:
            pass
        pivots: list[Pivot] = []
        fib_setup: FibSetup | None = None
        fib_zones: list[FibZone] = []
        sr_zones: list[SRZone] = []
        buy_zone = None
        target_zones: list[dict] = []
        fib_extensions: dict[str, float | None] = {"1.272": None, "1.618": None}
        used_fallback = False
        fallback_reason = ""

        try:
            if len(history) < 120:
                raise ValueError("Not enough bars for reliable pivot/Fib zones")
            pivots = detect_multi_timeframe_pivots(history)
            if len(pivots) < 4:
                raise ValueError("Not enough swing pivots for confluence zones")
            momentum = analyze_momentum(history, pivots)
            indicators.update(
                {
                    "rsi": momentum.get("rsi"),
                    "rsi_interpretation": momentum.get("rsi_interpretation"),
                    "macd": momentum.get("macd"),
                    "macd_signal": momentum.get("macd_signal"),
                    "macd_histogram": momentum.get("macd_histogram"),
                    "macd_trend": momentum.get("macd_trend"),
                    "momentum_score": momentum.get("score"),
                    "momentum_label": momentum.get("label"),
                    "momentum_summary": momentum.get("summary"),
                    "momentum_divergence": ", ".join([f"{item.get('indicator')} {item.get('type')}" for item in momentum.get("divergences", [])]) or None,
                    "momentum_warnings": momentum.get("warnings") or [],
                }
            )
            fib_setup, fib_zones = calculate_recent_fib_zones(pivots)
            sr_zones = calculate_sr_zones(pivots, fib_zones, indicators)
            if not sr_zones:
                raise ValueError("No confluence zones found")
            buy_zone, target_zones = recommendation_zones(sr_zones, indicators.get("price") or 0)
            if fib_setup:
                raw_extensions = calculate_fib_extensions(fib_setup.start_price, fib_setup.end_price)
                fib_extensions = {"1.272": raw_extensions.get(1.272), "1.618": raw_extensions.get(1.618)}
            fresh_high_extensions = self.fresh_high_extensions(history, pivots, indicators.get("price") or 0)
            if fresh_high_extensions:
                fib_extensions = fresh_high_extensions

            support, resistance = nearest_support_resistance(pivots, indicators.get("price") or 0)
            if support:
                indicators["support"] = support
                indicators["distance_to_support"] = (indicators["price"] / support - 1) * 100 if indicators.get("price") else None
            if resistance:
                indicators["resistance"] = resistance
                indicators["distance_to_resistance"] = (resistance / indicators["price"] - 1) * 100 if indicators.get("price") else None
        except Exception as exc:
            used_fallback = True
            fallback_reason = str(exc)

        score = self.compute_recommendation(
            indicators=indicators,
            research_signals=signals,
            buy_zone=buy_zone,
            target_zones=target_zones,
            fib_extensions=fib_extensions,
        )

        return TechnicalZoneAnalysis(
            symbol=symbol,
            history=history,
            info=info,
            indicators=indicators,
            pivots=pivots,
            fib_setup=fib_setup,
            fib_zones=fib_zones,
            sr_zones=sr_zones,
            buy_zone=buy_zone,
            target_zones=target_zones,
            fib_extensions=fib_extensions,
            score=score,
            used_fallback=used_fallback,
            fallback_reason=fallback_reason,
        )

    def compute_recommendation(
        self,
        indicators: dict,
        research_signals: list[dict],
        buy_zone: dict | None,
        target_zones: list[dict],
        fib_extensions: dict[str, float | None],
    ) -> dict:
        return score_ticker(
            indicators,
            research_signals,
            zone_context={
                "buy_zone": buy_zone,
                "target_zones": target_zones,
                "fib_extensions": fib_extensions,
            },
        )

    def fresh_high_extensions(self, history: pd.DataFrame, pivots: list[Pivot], price: float) -> dict[str, float | None]:
        if price <= 0 or history.empty:
            return {"1.272": None, "1.618": None}
        df = history.copy()
        df.columns = [str(column).lower() for column in df.columns]
        if "high" not in df.columns or "low" not in df.columns:
            return {"1.272": None, "1.618": None}

        recent = df.tail(252)
        high_52_week = float(recent["high"].max())
        available_high = float(df["high"].max())
        near_52_week_high = price >= high_52_week * 0.98
        near_available_high = price >= available_high * 0.98
        if not (near_52_week_high or near_available_high):
            return {"1.272": None, "1.618": None}

        rows = major_swings(pivots, min_rank=14, limit=120)
        highs = [row for row in rows if row["type"] == "high"]
        high_pivot = max(highs, key=lambda row: float(row["price"]), default=None)
        high_price = max(available_high, float(high_pivot["price"]) if high_pivot else available_high)
        high_date = high_pivot["date"] if high_pivot else str(df["high"].idxmax().date())
        lows_before_high = [
            row for row in rows
            if row["type"] == "low" and row["date"] < high_date and float(row["price"]) < high_price
        ]
        low_pivot = max(lows_before_high, key=lambda row: (row.get("strength", 0), row["date"]), default=None)
        if low_pivot:
            low_price = float(low_pivot["price"])
            low_date = low_pivot["date"]
        else:
            before_high = df.loc[df.index <= pd.Timestamp(high_date)]
            if before_high.empty:
                before_high = df
            low_price = float(before_high.tail(252)["low"].min())
            low_date = str(before_high.tail(252)["low"].idxmin().date())
        if low_price <= 0 or high_price <= low_price:
            return {"1.272": None, "1.618": None}

        raw_extensions = calculate_fib_extensions(low_price, high_price)
        return {
            "1.272": raw_extensions.get(1.272),
            "1.618": raw_extensions.get(1.618),
            "fresh_high": True,
            "near_52_week_high": near_52_week_high,
            "near_available_high": near_available_high,
            "swing_low": low_price,
            "swing_high": high_price,
            "swing_low_date": low_date,
            "swing_high_date": high_date,
        }
