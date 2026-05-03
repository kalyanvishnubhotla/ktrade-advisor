from __future__ import annotations

import sys
from pathlib import Path

import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.fibonacci import calculate_fib_levels, calculate_recent_fib_zones
from backend.app.pivots import detect_multi_timeframe_pivots


def main() -> None:
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "AEP"
    history = yf.Ticker(symbol).history(period="2y", auto_adjust=False)
    if history.empty:
        raise SystemExit(f"No price history returned for {symbol}")
    pivots = detect_multi_timeframe_pivots(history)
    setup, zones = calculate_recent_fib_zones(pivots)
    price = float(history["Close"].iloc[-1])
    print(f"{symbol} current price: ${price:.2f}")
    if setup is None:
        print("No recent Fibonacci setup found.")
        return
    print(
        f"Selected {setup.direction} swing: {setup.start_date} ${setup.start_price:.2f} "
        f"to {setup.end_date} ${setup.end_price:.2f} ({setup.swing_pct:.1f}%)"
    )
    print()
    print("Standard retracement levels:")
    for ratio, level in calculate_fib_levels(setup.start_price, setup.end_price).items():
        print(f"  {ratio * 100:5.1f}%: ${level:.2f}")
    print()
    print("Key zones:")
    for zone in zones:
        low = zone.snapped_price_low if zone.snapped_price_low is not None else zone.price_low
        high = zone.snapped_price_high if zone.snapped_price_high is not None else zone.price_high
        note = f" | {zone.confluence_note}" if zone.confluence_note else ""
        print(f"  {zone.level_name}: ${low:.2f} - ${high:.2f}{note}")


if __name__ == "__main__":
    main()
