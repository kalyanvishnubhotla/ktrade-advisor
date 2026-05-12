# KTrade Advisor

**Beginner-friendly, local-first decision support for U.S. stocks and ETFs.**

KTrade Advisor runs on your machine, opens in your browser, stores everything locally in SQLite, and translates technical signals (RSI / MACD / pivots / Fibonacci / S/R zones / volume / earnings / insider / sector RS / fundamentals) into plain-English recommendations with setup-quality scores, preferred buy areas, target zones, and risk lines.

> **Decision support only. Not financial advice.**

---

## 🚀 Quick Start (Docker — recommended)

The fastest way to run KTrade Advisor on any machine: macOS (Intel or Apple Silicon), Linux, or Windows with WSL. No Python, no Node, no `.venv` — just Docker.

### Option A — One-line install (uses the published image)

```bash
docker run -d \
  --name ktrade-advisor \
  -p 8000:8000 \
  -v ktrade-data:/app/data \
  --restart unless-stopped \
  ghcr.io/kalyanvishnubhotla/ktrade-advisor:latest
```

Open **http://localhost:8000** in your browser. That's it.

The image is published as a **multi-arch manifest** so Docker auto-pulls the right binary for your CPU (Intel x86_64 and Apple Silicon ARM64 both run natively — no emulation).

### Option B — Docker Compose (if you cloned the repo)

```bash
git clone https://github.com/kalyanvishnubhotla/ktrade-advisor.git
cd ktrade-advisor
docker compose up -d
```

Compose handles the volume + port mapping + restart policy automatically. Data persists in `./data` on the host.

### Stopping / starting

```bash
docker stop ktrade-advisor      # stop
docker start ktrade-advisor     # start again
docker logs -f ktrade-advisor   # tail logs
docker rm -f ktrade-advisor     # remove the container (data in volume survives)
```

### Upgrading to a new version

```bash
docker pull ghcr.io/kalyanvishnubhotla/ktrade-advisor:latest
docker stop ktrade-advisor && docker rm ktrade-advisor
# then re-run the `docker run` command from Option A
```

The SQLite database in the `ktrade-data` volume survives — your tickers, history, and tracked decisions all carry over.

---

## 👋 First-time Walkthrough

When you open the app for the first time, a **5-step quickstart modal** appears. Here's what to do, in order:

### Step 1 — Add tickers to a watchlist

Click **Watchlists** in the left sidebar.

- Click "Create watchlist", give it a name (e.g. *My Picks*, *Tech*, *Dividends*).
- Add ticker symbols one per line: `AAPL`, `MSFT`, `NVDA`, `GOOGL`, `META`, `AMZN`, `TSLA`, etc.
- No limit on how many — performance scales sub-linearly thanks to the parallel refresh pipeline.

### Step 2 — Wait for the first refresh

The very first refresh after adding tickers takes **20–30 seconds for ~40 tickers** because it has to:
- Download 2 years of price history for each ticker from Yahoo Finance
- Compute indicators (RSI, MACD, ADX, ATR, pivots, Fibonacci, S/R zones, volume confirmation, trend strength)
- Run 5 additional signal modules (earnings, fundamentals, insider activity, sector relative strength, market regime)
- Save a snapshot per ticker for the learning module

You'll see a **live progress bar in the top-right** showing `14 / 40 · NVDA` as each ticker completes. Subsequent refreshes are **5–10× faster** because the disk-backed cache (sector ETFs, insider data, fundamentals, earnings dates) is warm.

If for some reason the auto-refresh on startup doesn't run, click the **Refresh** button manually in the top right.

### Step 3 — Read the Dashboard

Each tile shows:

| Field | What it means |
|---|---|
| **Score 0–100** | Setup quality. 75+ = strong confluence. 65–74 = solid. <65 = wait. |
| **Decision pill** | Plain-English call: *Buy / Wait for better price / Watch / Hold / Avoid*. |
| **Preferred buy area** | The price range where buyers tend to defend. Wait for the price to enter this zone. |
| **Review area** | Profit targets where you should re-evaluate (often Fibonacci or prior resistance). |
| **Risk line** | The price below which the setup is invalidated. Use as a mental stop. |
| **Signal grid** | Trend / Momentum / Volume / Risk — green = supportive, gold = mixed, gray = neutral. |
| **News badge** | Number of recent news items matched to this ticker. |

Tiles are sorted by score, so the strongest setups are always at the top.

### Step 4 — Drill into any tile

Click a tile to open the **Ticker Detail** page:
- Price chart with all the engine's zones overlaid
- Full signal breakdown (each indicator + interpretation)
- Recent news items matched to this ticker
- Snapshot history (every prior score for this ticker)
- "Track this decision" button — saves a point-in-time snapshot the engine can learn from

### Step 5 — Enable optional modules

In **Settings** you can toggle on two additional tabs:

- **Portfolio OS** — Import broker exports (Robinhood CSV, E*TRADE PDF/CSV). Tracks holdings, weighted-average cost basis, unrealized P&L, and gives hold/sell calls based on current engine scores.
- **Backtesting & Accuracy** — When enabled, clicking *Track this decision* also registers that snapshot with the accuracy engine. It then watches the price every day and tells you exactly how the call played out (buy zone hit, target reached, risk line breached). Shows hit rate, calibration curve, equity curve, and per-decision charts.

Both are **off by default** to keep the first-run experience simple. Turn them on when you're ready.

---

## 🗺️ Screen-by-screen reference

| Screen | What it shows | When to use it |
|---|---|---|
| **Dashboard** | Score-sorted grid of every ticker with score, decision, buy area, risk line, signal pills. | Your home base. Check first thing in the morning to see what changed overnight. |
| **Watchlists** | Create and edit lists of tickers. Each list is a group; you can have many. | Whenever you want to add or remove a ticker, or organize them by theme. |
| **Ticker Detail** | Deep-dive into one ticker: price chart with zones, full signal grid, matched news, snapshot history. | Click any dashboard tile to land here. Use it before making a decision. |
| **Research Signal** | Paste your own research notes. The app parses them and offers to adjust the score. | When you want to inject your own conviction into the engine. |
| **Portfolio**  *(optional)* | Import broker exports. Track holdings, cost basis, P&L, and get hold/sell calls. | After importing your transaction history. Enable in Settings. |
| **Accuracy**  *(optional)* | Live track-record: how many tracked decisions hit their targets, calibration curve, simulated equity, per-decision charts. | After tracking 5+ decisions. Enable in Settings. |
| **History** | All saved snapshots across every ticker, oldest to newest. The raw audit log. | When you want to see what the engine said about a ticker last week. |
| **Learning** | Patterns the engine has noticed: which signal combos win for you, which lose. | After several weeks of use. Builds a personalised mental model. |
| **Settings** | Toggle optional modules, manage manual portfolio positions, see app info. | On first launch and rarely after. |

---

## 🏎️ Performance characteristics

The refresh pipeline is heavily parallelized and disk-cached:

| Ticker count | Cold cache | Warm cache |
|---|---|---|
| 40 | ~22 s | ~7 s |
| 55 | ~28 s | ~9 s |
| 100 | ~50 s | ~15 s |
| 200 | ~95 s | ~25 s |

Cold runs go to Yahoo Finance for everything. Warm runs (within ~5 min of cold) serve price history from cache; within ~24 h, sector / insider / fundamentals also come from cache.

**The frontend never blocks.** A click on *Refresh* returns instantly with a `jobId`; the dashboard re-renders from existing data while a background worker streams progress updates to a topbar progress bar. Tiles update progressively as their new scores land.

---

## 🛠️ Developer setup (no Docker)

If you want to hack on the code, you can still run from source:

### Prerequisites

- Python 3.9 or newer (3.12 recommended)
- Node.js 18 LTS or newer (20 recommended)
- macOS / Linux / Windows WSL

### From source

```bash
git clone https://github.com/kalyanvishnubhotla/ktrade-advisor.git
cd ktrade-advisor

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..

# Run
python -m backend.app.main
```

Open http://127.0.0.1:8000.

For active frontend development you can run Vite in dev mode in a second terminal:

```bash
cd frontend
npm run dev    # http://localhost:5173 with hot reload
```

The dev server proxies `/api/*` to the FastAPI backend on port 8000.

---

## 🔧 Configuration

The Docker image and the standalone process both honor these environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `KTRADE_PORT` | `8000` | Port to bind the HTTP server to. |
| `KTRADE_DOCKER` | unset | When set to any value, disables `webbrowser.open()` and binds the server to `0.0.0.0` instead of loopback. Set automatically in the Docker image. |

---

## 🗄️ Where your data lives

| Path | Contents |
|---|---|
| `/app/data/ktrade_advisor.sqlite3`  *(in container)* | Tickers, watchlists, snapshots, indicators, scores, prices, portfolio, tracked decisions, yfinance cache. |
| Host mount: `./data/` *or* `ktrade-data` *volume* | Same file, persisted across container restarts/upgrades. |

To start completely fresh, stop the container and `rm -rf data/` (or `docker volume rm ktrade-data`).

To inspect the DB live, install any SQLite client on the host and open `./data/ktrade_advisor.sqlite3`. The file format is identical to a normal SQLite file; no special tooling required.

---

## 🤝 Architecture notes

- **Local-first, single-user.** No accounts, no cloud sync, no telemetry. Everything stays on your machine.
- **One container, one process.** FastAPI serves the API on `/api/*` and the built React app on `/`.
- **Disk-backed yfinance cache** with per-field TTLs (price: 5 min, info: 24 h, insider: 24 h, EPS: 7 d). Survives restarts.
- **Parallel refresh pipeline** with `ThreadPoolExecutor(max_workers=8)`. Bulk price downloads via one `yf.download()` call. Batched SQLite inserts via `executemany()`.
- **Non-blocking refresh API**: `POST /api/refresh` returns a `jobId` in ~5 ms; frontend polls `GET /api/refresh/status/{jobId}` every 1.2 s for live progress.
- **Auto-published multi-arch image** on every push to `main` and every git tag, via GitHub Actions → GHCR. Linux/amd64 + linux/arm64 in one manifest.

---

## ❓ Troubleshooting

**Port 8000 already in use.** Change the host port: `docker run -p 8001:8000 ...`, then open http://localhost:8001.

**First refresh never completes / many tickers fail.** Check `docker logs ktrade-advisor` for Yahoo rate-limiting (HTTP 429). Yahoo throttles at high concurrency. Workaround: reduce `MAX_WORKERS_TICKERS` in `backend/app/market_data.py` from 8 to 4.

**Image is huge / slow to download.** Compressed it's ~150 MB; uncompressed ~350 MB. If size matters, build locally without pdfplumber (it pulls in Pillow) by removing the `pdfplumber` line from `requirements.txt`.

**Friend says it runs slowly on their Mac.** Make sure they pulled the multi-arch image; if their Docker is misconfigured it may have pulled `linux/amd64` onto an M-series Mac and is running under QEMU. Force a re-pull: `docker pull --platform linux/arm64 ghcr.io/kalyanvishnubhotla/ktrade-advisor:latest`.

---

## 📜 License & disclaimer

This is decision support tooling for personal use. **Not financial advice.** Past performance / signal accuracy is not a guarantee of future results. Always do your own research.
