from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.technical_zone_analyzer import TechnicalZoneAnalyzer


def make_short_history() -> pd.DataFrame:
    start = datetime(2026, 1, 1)
    rows = []
    price = 100.0
    for index in range(45):
        price += 0.35
        rows.append(
            {
                "Open": price - 0.4,
                "High": price + 1.1,
                "Low": price - 1.0,
                "Close": price,
                "Volume": 1_000_000 + index * 5000,
            }
        )
    return pd.DataFrame(rows, index=[start + timedelta(days=i) for i in range(45)])


def main() -> None:
    analyzer = TechnicalZoneAnalyzer()
    result = analyzer.analyze("DEMO", history=make_short_history())
    print(f"Fallback used: {result.used_fallback}")
    print(f"Reason: {result.fallback_reason}")
    print(f"Decision: {result.score['decision']} | Score: {result.score['score']}")
    print(f"Buy zone: {result.score['entry_range']}")
    print(f"Risk level: {result.score['invalidation_level']}")
    print(f"Targets: {result.score['target1']} / {result.score['target2']}")
    print(result.score["summary"])


if __name__ == "__main__":
    main()
