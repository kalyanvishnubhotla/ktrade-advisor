# Ktrade Advisor

Beginner-friendly, local-first decision support for U.S. stocks and ETFs.

Ktrade Advisor runs on your Mac, opens in your browser, stores everything locally in SQLite, and translates technical signals into plain-English recommendations.

> Decision support only. Not financial advice.

## What You Need Once

- macOS
- Python 3.9 or newer
- Node.js LTS, which includes `npm`
- Internet access for market/news refreshes

Download Node.js here if needed: https://nodejs.org

## Quick Start On Mac

1. Download or clone this GitHub project.
2. Open the project folder.
3. Double-click `start.command`.
4. Wait for the browser to open at `http://127.0.0.1:8000`.

The first run can take a few minutes because it installs local dependencies and builds the browser app. After that, normal use is just launching `start.command`.

Terminal option:

```bash
./start.sh
```

If macOS blocks the double-click launcher, open Terminal in this folder and run:

```bash
chmod +x start.command start.sh
./start.sh
```

## What Happens On First Launch

- A local Python environment is created in `.venv/`.
- Frontend dependencies are installed in `frontend/node_modules/`.
- The React app is built into `frontend/dist/`.
- A local SQLite database is created in `data/`.
- The browser opens automatically.
- A first-time guide explains the main workflow.

These generated folders are intentionally ignored by Git.

## Normal Workflow

1. Open the app.
2. Click **Refresh** to update prices, news, indicators, and recommendation snapshots.
3. Scan dashboard cards:
   - **Buy-worthy now**
   - **Wait for better price**
   - **Watch for breakout**
   - **Hold / no action**
   - **Avoid for now**
4. Click a ticker to see the price map, setup checklist, signal health, recommendation history, and research/news context.
5. Use **Track this decision** when a recommendation matters.
6. Later, mark what you did and record the outcome so the learning dashboard becomes useful.

## Key Features

- Custom watchlists
- Local SQLite storage
- yfinance price refresh
- Free RSS news matching
- Support/resistance zones
- Pivot, moving average, momentum, trend, volume, volatility, and catalyst checks
- Plain-English recommendation cards
- Paste Research Signal workflow
- Recommendation snapshots and outcome tracking
- Learning insights based on your own marked decisions
- Portfolio input and concentration warnings

## Paste Research Signal

Use this after asking ChatGPT, Perplexity, or another research tool to summarize an article, video, earnings note, or transcript.

Paste the structured signal into **Research Signal**, review it, then choose whether it should affect the score. The app never blindly trusts pasted research.

## Local Data And Privacy

All app data is stored locally on your machine:

```text
data/ktrade_advisor.sqlite3
```

This file contains your watchlists, positions, research notes, snapshots, outcomes, and settings. It is ignored by Git so you do not accidentally share personal data.

## Troubleshooting

**Browser did not open**

Go to `http://127.0.0.1:8000` manually.

**Node/npm not found**

Install Node.js LTS from https://nodejs.org, then run `start.command` again.

**Python too old**

Install Python 3.9 or newer, then run `start.command` again.

**Market data does not refresh**

Check internet access and try Refresh again. The app keeps existing local data when a refresh fails.

**Port 8000 already in use**

Stop the other local app using port 8000, or launch with another port:

```bash
KTRADE_PORT=8010 ./start.sh
```

## Demo Walkthrough

See [docs/demo-walkthrough.md](docs/demo-walkthrough.md) for a first-time user walkthrough and recording script.

## Project Layout

```text
backend/          FastAPI app, SQLite schema, scoring, yfinance refresh
frontend/         React + TypeScript + Vite app
scripts/          Manual analyzer/debug scripts
docs/             Friend-facing walkthrough notes
data/             Local SQLite database, created automatically and ignored by Git
start.sh          One-command terminal launcher
start.command     Double-click macOS launcher
requirements.txt  Python dependencies
```

## Developer Checks

```bash
PYTHONPYCACHEPREFIX=.pycache .venv/bin/python -m compileall backend/app
npm --prefix frontend run build
```

## Safety

The app avoids words like guaranteed, prediction, and risk-free. Treat every recommendation as decision support only.
