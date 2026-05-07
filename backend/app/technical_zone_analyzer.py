from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import yfinance as yf

from .analysis import compute_indicators, score_ticker
from .fibonacci import FibSetup, FibZone, calculate_fib_extensions, calculate_recent_fib_zones
from .momentum import analyze_momentum
from .pivots import Pivot, detect_multi_timeframe_pivots, nearest_support_resistance
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
        info = {}
        try:
            raw_info = ticker.get_info()
            info = {
                "company": raw_info.get("shortName") or raw_info.get("longName"),
                "asset_type": "etf" if raw_info.get("quoteType") == "ETF" else "stock",
            }
        except Exception:
            info = {}
        return history, info

    def analyze(
        self,
        symbol: str,
        history: pd.DataFrame | None = None,
        spy_history: pd.DataFrame | None = None,
        research_signals: list[dict] | None = None,
    ) -> TechnicalZoneAnalysis:
        if history is None:
            history, info = self.fetch_latest_data(symbol)
        else:
            info = {}
        if history.empty:
            raise ValueError("No price data returned")

        signals = research_signals or []
        indicators = compute_indicators(history, spy_history)
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
