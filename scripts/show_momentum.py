from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.technical_zone_analyzer import TechnicalZoneAnalyzer


def main() -> None:
    symbols = [symbol.upper() for symbol in sys.argv[1:]] or ["AEP", "NVDA", "SPY"]
    analyzer = TechnicalZoneAnalyzer()
    for symbol in symbols:
        analysis = analyzer.analyze(symbol)
        ind = analysis.indicators
        score = analysis.score
        print("=" * 72)
        print(f"{symbol} | price ${ind.get('price'):.2f}")
        print(f"Momentum label: {score.get('momentum_label')} | setup quality: {score.get('buy_zone_confluence')}/100")
        print(f"RSI(14): {ind.get('rsi'):.2f} | {ind.get('rsi_interpretation')}")
        print(
            "MACD(12,26,9): "
            f"line {ind.get('macd'):.3f}, signal {ind.get('macd_signal'):.3f}, "
            f"histogram {ind.get('macd_histogram'):.3f}, trend {ind.get('macd_trend')}"
        )
        print(f"Divergence: {ind.get('momentum_divergence') or 'None detected'}")
        print(f"Plain English: {ind.get('momentum_summary')}")
        print(f"Trend strength: {ind.get('trend_strength_summary')}")
        print(f"Volume confirmation: {ind.get('volume_confirmation_summary')}")


if __name__ == "__main__":
    main()
