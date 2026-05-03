from __future__ import annotations

import sys
from pathlib import Path

import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.pivots import detect_multi_timeframe_pivots, nearest_support_resistance


def main() -> None:
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "AEP"
    history = yf.Ticker(symbol).history(period="1y", auto_adjust=False)
    if history.empty:
        raise SystemExit(f"No price history returned for {symbol}")
    price = float(history["Close"].iloc[-1])
    old_support = float(history["Low"].tail(60).min())
    old_resistance = float(history["High"].tail(60).max())
    pivots = detect_multi_timeframe_pivots(history)
    pivot_support, pivot_resistance = nearest_support_resistance(pivots, price)

    print(f"{symbol} current price: ${price:.2f}")
    print("Old simple method:")
    print(f"  60-day low support: ${old_support:.2f}")
    print(f"  60-day high resistance: ${old_resistance:.2f}")
    print("New pivot method:")
    print(f"  nearest major swing-low support: ${pivot_support:.2f}" if pivot_support else "  nearest major swing-low support: none")
    print(f"  nearest major swing-high resistance: ${pivot_resistance:.2f}" if pivot_resistance else "  nearest major swing-high resistance: none")
    print()
    print("Why this matters: the old method only looked for the lowest and highest prices.")
    print("The new method looks for actual turning points across daily and weekly charts.")


if __name__ == "__main__":
    main()
