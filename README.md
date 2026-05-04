# Ktrade Advisor

Beginner-friendly, local-first decision support for U.S. stocks and ETFs.

This app runs on your laptop, stores data in a local SQLite database, pulls market data with `yfinance`, and opens in your browser at `http://127.0.0.1:8000`.

> Decision support only. Not financial advice.

## Quick Start

On macOS:

1. Open this folder.
2. Double-click `start.command`.
3. Wait for the browser to open.

Terminal option:

```bash
./start.sh
```

The first run installs local Python and frontend dependencies. After that, normal usage is just launching the app.

## What It Does

- Creates and manages custom watchlists.
- Refreshes ticker prices and indicators from Yahoo Finance.
- Scores each ticker from 0 to 100 using trend, momentum, volume, support/resistance, research, risk/reward, and portfolio fit.
- Shows plain-English recommendation cards:
  - Buy-worthy now
  - Wait for better price
  - Watch for breakout
  - Hold / no action
  - Avoid for now
  - Review / possible trim
- Stores recommendation history locally.
- Parses pasted research signals from ChatGPT, Perplexity, or your own notes.
- Tracks manual portfolio positions and concentration warnings.
- Shows simple learning patterns from past recommendations.

## Project Layout

```text
backend/        FastAPI app, SQLite database, scoring, yfinance refresh
frontend/       React + TypeScript + Vite app
data/           Local SQLite database, created automatically
start.sh        One-command launcher
start.command   Double-click macOS launcher
```

## Notes

- All app data is local.
- The app avoids words like guaranteed, prediction, and risk-free.
- Some fields, such as earnings proximity, depend on availability from `yfinance`.
- If market data is unavailable, the app keeps existing local data and marks the refresh result.

## Manual Pivot Tests

To understand how support and resistance are now calculated:

```bash
.venv/bin/python scripts/show_pivots.py AEP
```

This prints recent daily/weekly swing highs and lows, including price, date, type, timeframe, strength, and touch count.

```bash
.venv/bin/python scripts/compare_old_vs_pivot_support.py AEP
```

This compares the old 60-day high/low method with the new multi-timeframe pivot method. For example, AEP recently showed old support near `$119.71`, while the pivot method found nearer swing support around `$131.20`.

```bash
.venv/bin/python scripts/show_fibs.py AEP
```

This shows the selected recent Fibonacci swing, standard retracement levels, the Golden Zone, and any nearby pivot confluence used to snap zone boundaries.

```bash
.venv/bin/python scripts/show_zones.py AEP
```

This shows unified support/resistance zones built from swing pivots, Fibonacci zones, and 50/200-day moving averages, including confluence score and plain-English explanation.

```bash
.venv/bin/python scripts/analyze_phase1.py AEP NVDA SPY
```

This runs the full Phase 1 technical analyzer and prints the decision, score, buy zone, risk level, targets, confluence, and summary.

```bash
.venv/bin/python scripts/analyze_fallback_example.py
```

This demonstrates graceful fallback when there are not enough bars to build reliable pivots, Fibonacci zones, or confluence zones.
