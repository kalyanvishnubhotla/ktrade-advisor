# Demo Walkthrough

Use this as a quick recording script for a first-time user. A 3-5 minute video is enough.

## Setup Shot

Show the GitHub page or downloaded folder.

Say:

> This is Ktrade Advisor. It runs locally on your Mac and opens in the browser. Your watchlists, notes, recommendations, and outcomes stay in a local SQLite database.

Show:

- `start.command`
- `README.md`
- `backend/`
- `frontend/`

## Launch

Double-click `start.command`.

Say:

> First launch may take a few minutes because it installs Python and frontend dependencies locally. After that, opening the app is just this launcher.

When the browser opens:

> The app runs at `127.0.0.1:8000`, which means it is running on this laptop.

## First-Time Guide

Show the first-time guide modal.

Say:

> The guide explains the basic workflow: refresh, scan cards, click a ticker, track decisions, and record outcomes later.

## Dashboard

Show recommendation cards.

Say:

> The dashboard is intentionally not a trading terminal. It translates signals into plain English: buy-worthy, wait, hold, watch, or avoid.

Point out:

- Current price
- Setup quality
- Signal Health
- Preferred buy area
- Review area
- Risk line
- Track this decision

Say:

> Preferred buy area means a calmer price area to consider. Review area means reassess, not automatically sell. Risk line means the setup may be weakening if price breaks below it.

## Filters And Table

Show filters and card/table toggle.

Say:

> You can filter by decision, setup quality, risk, closeness to buy area, or news. Table view is useful when comparing many tickers.

## Ticker Detail

Open a ticker, for example `CRWD`.

Say:

> Ticker detail shows the full reasoning: decision plan, signal health, price map, key price areas, reasons, concerns, and recommendation history.

Show the interactive chart.

Say:

> The chart shows the current price, buy area, risk line, and review targets. You can zoom and pan.

## Research Signal

Open Research Signal.

Say:

> If you ask ChatGPT or Perplexity to summarize an article or video, paste the structured signal here. The app stores it locally and asks you before it affects the score.

## Tracking Decisions

Go back to a card or ticker detail and click **Track this decision**.

Say:

> Tracking saves a point-in-time snapshot. Later, mark whether you bought, ignored, watched, or sold, and add the outcome. This helps the learning dashboard become personalized.

## Learning Insights

Open Learning.

Say:

> Learning Insights shows whether high-scoring setups actually worked for you. It is based only on your saved snapshots and marked outcomes.

## Closing Reminder

Say:

> This is decision support only, not financial advice. It helps slow down the decision, compare setups, and keep a local memory of what worked.

## Recording Tip On Mac

If creating a quick demo video:

1. Open QuickTime Player.
2. Choose **File > New Screen Recording**.
3. Record the browser window and launcher.
4. Keep the walkthrough under 5 minutes.
5. Export as `docs/ktrade-advisor-demo.mov` if you want to keep it outside Git, or upload it separately to GitHub Releases/YouTube/Loom.

Large video files should usually not be committed directly to Git.

