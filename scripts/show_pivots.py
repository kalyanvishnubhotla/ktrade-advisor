from __future__ import annotations

import sys
from pathlib import Path

import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.pivots import detect_multi_timeframe_pivots, major_swings, nearest_support_resistance, pivot_rank


def main() -> None:
    symbol = sys.argv[1].upper() if len(sys.argv) > 1 else "AEP"
    history = yf.Ticker(symbol).history(period="2y", auto_adjust=False)
    if history.empty:
        raise SystemExit(f"No price history returned for {symbol}")
    pivots = detect_multi_timeframe_pivots(history)
    price = float(history["Close"].iloc[-1])
    support, resistance = nearest_support_resistance(pivots, price)
    print(f"{symbol} current price: ${price:.2f}")
    print(f"Nearest major support pivot: ${support:.2f}" if support else "Nearest major support pivot: none")
    print(f"Nearest major resistance pivot: ${resistance:.2f}" if resistance else "Nearest major resistance pivot: none")
    print()
    print("Top major swings:")
    for pivot in major_swings(pivots, limit=12):
        print(
            f"{pivot['date']} | {pivot['timeframe']:6} | {pivot['type']:4} | "
            f"${pivot['price']:.2f} | strength {pivot['strength']} | "
            f"touches {pivot['touches']} | rank {pivot_rank(pivot)}"
        )


if __name__ == "__main__":
    main()
