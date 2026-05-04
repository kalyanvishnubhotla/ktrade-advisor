from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.technical_zone_analyzer import TechnicalZoneAnalyzer


def print_analysis(symbol: str) -> None:
    analyzer = TechnicalZoneAnalyzer()
    result = analyzer.analyze(symbol)
    score = result.score
    price = result.indicators.get("price")
    print("=" * 72)
    print(f"{symbol} | price ${price:.2f}" if price else symbol)
    print(f"Decision: {score['decision']} | Score: {score['score']} | Risk: {score['risk']}")
    print(f"Buy zone: {score['entry_range']} | Confluence: {score['buy_zone_confluence'] or '--'}/100")
    print(f"Risk level: {score['invalidation_level']}")
    print(f"Targets: {score['target1']} / {score['target2']}")
    if score.get("distance_to_buy_zone") is not None:
        print(f"Distance to buy zone: {score['distance_to_buy_zone']}%")
    if score.get("buy_zone_explanation"):
        print(f"Buy zone basis: {score['buy_zone_explanation']}")
    if score.get("target_zone_explanation"):
        print(f"Target basis: {score['target_zone_explanation']}")
    print(f"Summary: {score['summary']}")
    print(f"Pivots: {len(result.pivots)} | Fib zones: {len(result.fib_zones)} | Unified zones: {len(result.sr_zones)}")
    if result.used_fallback:
        print(f"Fallback used: {result.fallback_reason}")


def main() -> None:
    symbols = [arg.upper() for arg in sys.argv[1:]] or ["AEP", "NVDA", "SPY"]
    for symbol in symbols:
        print_analysis(symbol)


if __name__ == "__main__":
    main()
