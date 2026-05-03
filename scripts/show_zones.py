from __future__ import annotations

import sys
from pathlib import Path

import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.analysis import compute_indicators
from backend.app.fibonacci import calculate_recent_fib_zones
from backend.app.pivots import detect_multi_timeframe_pivots
from backend.app.zones import calculate_sr_zones


def main() -> None:
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "AEP"
    history = yf.Ticker(symbol).history(period="2y", auto_adjust=False)
    if history.empty:
        raise SystemExit(f"No price history returned for {symbol}")

    indicators = compute_indicators(history)
    pivots = detect_multi_timeframe_pivots(history)
    _, fib_zones = calculate_recent_fib_zones(pivots)
    zones = calculate_sr_zones(pivots, fib_zones, indicators)
    price = indicators["price"]

    print(f"{symbol} current price: ${price:.2f}")
    print("Top unified support/resistance zones:")
    for zone in zones[:10]:
        source_labels = ", ".join(source.label for source in zone.sources[:4])
        print(
            f"{zone.zone_type:10} ${zone.price_low:.2f}-${zone.price_high:.2f} | "
            f"confluence {zone.confluence_score:.0f}/100 | strength {zone.strength_score:.0f} | "
            f"{source_labels}"
        )
        print(f"  {zone.plain_english}")


if __name__ == "__main__":
    main()
