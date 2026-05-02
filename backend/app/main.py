from __future__ import annotations

import csv
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .analysis import DISCLAIMER
from .database import ROOT, db, init_db, rows_to_dicts, seed_defaults, upsert_ticker
from .market_data import refresh_all, refresh_if_empty
from .research import parse_research_signal

app = FastAPI(title="Ktrade Advisor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WatchlistIn(BaseModel):
    name: str
    theme: str = "General"
    active: bool = True


class TickerIn(BaseModel):
    symbol: str
    company: str | None = None
    theme: str = "General"


class RenameIn(BaseModel):
    name: str
    theme: str | None = None
    active: bool | None = None


class ResearchIn(BaseModel):
    text: str
    approved: bool = False
    apply_impact: bool = False


class ResearchApprovalIn(BaseModel):
    approved: bool
    apply_impact: bool = False


class PositionIn(BaseModel):
    ticker: str
    shares: float
    cost: float
    theme: str = "General"


@app.on_event("startup")
def startup() -> None:
    init_db()
    seed_defaults()
    threading.Thread(target=refresh_if_empty, daemon=True).start()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "disclaimer": DISCLAIMER}


@app.get("/api/dashboard")
def dashboard() -> dict:
    with db() as conn:
        cards = rows_to_dicts(
            conn.execute(
                """
                SELECT t.id AS ticker_id, t.symbol, t.company, t.theme, t.asset_type,
                       i.price, i.as_of, i.support, i.resistance, i.distance_to_support, i.distance_to_resistance,
                       i.pattern_signal, s.score, s.decision, s.confidence, s.risk, s.trend_label, s.momentum_label,
                       s.volume_label, s.news_label, s.summary, s.suggested_action, s.entry_range,
                       s.invalidation_level, s.target1, s.target2, s.hold_window, s.why_rating, s.changes_view
                FROM tickers t
                LEFT JOIN indicators i ON i.ticker_id = t.id
                LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                ORDER BY COALESCE(s.score, 0) DESC, t.symbol
                """
            ).fetchall()
        )
        watchlists = watchlist_summary(conn)
        settings = dict(conn.execute("SELECT key, value FROM settings").fetchall())
    return {
        "market": {
            "label": settings.get("market_condition", "Mixed / cautious"),
            "explanation": settings.get("market_explanation", "Market Today: Mixed / Cautious. Be selective."),
            "last_refresh": settings.get("last_refresh"),
        },
        "cards": cards,
        "watchlists": watchlists,
        "disclaimer": DISCLAIMER,
    }


def watchlist_summary(conn) -> list[dict]:
    watchlists = rows_to_dicts(conn.execute("SELECT * FROM watchlists ORDER BY active DESC, name").fetchall())
    for item in watchlists:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT t.symbol, t.theme, s.score, s.decision
                FROM watchlist_tickers wt
                JOIN tickers t ON t.id = wt.ticker_id
                LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                WHERE wt.watchlist_id = ?
                """,
                (item["id"],),
            ).fetchall()
        )
        scores = [r["score"] for r in rows if r["score"] is not None]
        item["ticker_count"] = len(rows)
        item["average_score"] = round(sum(scores) / len(scores), 1) if scores else None
        item["top_opportunities"] = len([r for r in rows if (r["score"] or 0) >= 80])
        item["wait_on"] = len([r for r in rows if r["decision"] == "Wait for better price"])
        item["avoid"] = len([r for r in rows if r["decision"] == "Avoid for now"])
        themes = {}
        for row in rows:
            themes[row["theme"]] = themes.get(row["theme"], 0) + 1
        item["theme_concentration"] = max(themes, key=themes.get) if themes else item["theme"]
        item["earnings_warnings"] = "Unavailable in MVP when yfinance does not expose dates."
    return watchlists


@app.post("/api/refresh")
def refresh() -> dict:
    return refresh_all()


@app.get("/api/watchlists")
def get_watchlists() -> list[dict]:
    with db() as conn:
        summaries = watchlist_summary(conn)
        for item in summaries:
            item["tickers"] = rows_to_dicts(
                conn.execute(
                    """
                    SELECT t.*, s.score, s.decision
                    FROM watchlist_tickers wt
                    JOIN tickers t ON t.id = wt.ticker_id
                    LEFT JOIN scores s ON s.id = (SELECT id FROM scores WHERE ticker_id = t.id ORDER BY as_of DESC LIMIT 1)
                    WHERE wt.watchlist_id = ?
                    ORDER BY t.symbol
                    """,
                    (item["id"],),
                ).fetchall()
            )
    return summaries


@app.post("/api/watchlists")
def create_watchlist(payload: WatchlistIn) -> dict:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO watchlists (name, theme, active) VALUES (?, ?, ?)",
            (payload.name.strip(), payload.theme.strip(), int(payload.active)),
        )
        return {"id": cur.lastrowid}


@app.patch("/api/watchlists/{watchlist_id}")
def update_watchlist(watchlist_id: int, payload: RenameIn) -> dict:
    with db() as conn:
        existing = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Watchlist not found")
        conn.execute(
            "UPDATE watchlists SET name = ?, theme = ?, active = ? WHERE id = ?",
            (
                payload.name.strip(),
                payload.theme if payload.theme is not None else existing["theme"],
                int(payload.active) if payload.active is not None else existing["active"],
                watchlist_id,
            ),
        )
    return {"ok": True}


@app.post("/api/watchlists/{watchlist_id}/duplicate")
def duplicate_watchlist(watchlist_id: int) -> dict:
    with db() as conn:
        original = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not original:
            raise HTTPException(404, "Watchlist not found")
        name = f"{original['name']} Copy"
        cur = conn.execute("INSERT INTO watchlists (name, theme, active) VALUES (?, ?, ?)", (name, original["theme"], original["active"]))
        conn.execute(
            "INSERT INTO watchlist_tickers SELECT ?, ticker_id FROM watchlist_tickers WHERE watchlist_id = ?",
            (cur.lastrowid, watchlist_id),
        )
        return {"id": cur.lastrowid}


@app.delete("/api/watchlists/{watchlist_id}/tickers/{symbol}")
def remove_ticker(watchlist_id: int, symbol: str) -> dict:
    with db() as conn:
        conn.execute(
            """
            DELETE FROM watchlist_tickers
            WHERE watchlist_id = ? AND ticker_id = (SELECT id FROM tickers WHERE symbol = ?)
            """,
            (watchlist_id, symbol.upper()),
        )
    return {"ok": True}


@app.post("/api/watchlists/{watchlist_id}/tickers")
def add_ticker(watchlist_id: int, payload: TickerIn) -> dict:
    with db() as conn:
        watchlist = conn.execute("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,)).fetchone()
        if not watchlist:
            raise HTTPException(404, "Watchlist not found")
        ticker_id = upsert_ticker(conn, payload.symbol, payload.company, payload.theme or watchlist["theme"])
        conn.execute("INSERT OR IGNORE INTO watchlist_tickers VALUES (?, ?)", (watchlist_id, ticker_id))
    return {"ok": True}


@app.get("/api/tickers/{symbol}")
def ticker_detail(symbol: str) -> dict:
    with db() as conn:
        ticker = conn.execute("SELECT * FROM tickers WHERE symbol = ?", (symbol.upper(),)).fetchone()
        if not ticker:
            raise HTTPException(404, "Ticker not found")
        ticker_id = ticker["id"]
        prices = rows_to_dicts(
            conn.execute("SELECT date, close, volume FROM prices WHERE ticker_id = ? ORDER BY date DESC LIMIT 180", (ticker_id,)).fetchall()
        )
        indicators = conn.execute("SELECT * FROM indicators WHERE ticker_id = ?", (ticker_id,)).fetchone()
        scores = rows_to_dicts(conn.execute("SELECT * FROM scores WHERE ticker_id = ? ORDER BY as_of DESC LIMIT 20", (ticker_id,)).fetchall())
        research = rows_to_dicts(conn.execute("SELECT * FROM research_signals WHERE ticker_id = ? ORDER BY created_at DESC", (ticker_id,)).fetchall())
        recommendations = rows_to_dicts(conn.execute("SELECT * FROM recommendations WHERE ticker_id = ? ORDER BY created_at DESC LIMIT 20", (ticker_id,)).fetchall())
    return {
        "ticker": dict(ticker),
        "prices": list(reversed(prices)),
        "indicators": dict(indicators) if indicators else None,
        "scores": scores,
        "research": research,
        "recommendations": recommendations,
    }


@app.post("/api/research/parse")
def research_parse(payload: ResearchIn) -> dict:
    parsed = parse_research_signal(payload.text)
    if not parsed.get("ticker"):
        raise HTTPException(400, "Could not find Ticker field")
    with db() as conn:
        ticker_id = upsert_ticker(conn, parsed["ticker"], parsed.get("company"))
        cur = conn.execute(
            """
            INSERT INTO research_signals
            (ticker_id, source_date, company, source_links, summary, bullish, bearish, catalyst_type, time_sensitivity,
             sentiment, confidence, suggested_impact, reason, approved, applied)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticker_id,
                parsed.get("date"),
                parsed.get("company"),
                parsed.get("source_links"),
                parsed.get("summary"),
                parsed.get("bullish"),
                parsed.get("bearish"),
                parsed.get("catalyst_type"),
                parsed.get("time_sensitivity"),
                parsed.get("sentiment"),
                parsed.get("confidence"),
                parsed.get("suggested_impact"),
                parsed.get("reason"),
                int(payload.approved),
                int(payload.apply_impact and payload.approved),
            ),
        )
    return {"id": cur.lastrowid, "parsed": parsed, "message": "Stored locally. Review and approve before applying impact."}


@app.patch("/api/research/{signal_id}/approval")
def approve_research(signal_id: int, payload: ResearchApprovalIn) -> dict:
    with db() as conn:
        conn.execute(
            "UPDATE research_signals SET approved = ?, applied = ? WHERE id = ?",
            (int(payload.approved), int(payload.apply_impact and payload.approved), signal_id),
        )
    return {"ok": True}


@app.get("/api/history")
def history() -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT r.*, t.symbol, t.company
                FROM recommendations r
                JOIN tickers t ON t.id = r.ticker_id
                ORDER BY r.created_at DESC
                LIMIT 250
                """
            ).fetchall()
        )


@app.get("/api/learning")
def learning() -> dict:
    with db() as conn:
        recs = rows_to_dicts(
            conn.execute(
                """
                SELECT r.*, t.symbol, t.theme
                FROM recommendations r
                JOIN tickers t ON t.id = r.ticker_id
                ORDER BY r.created_at DESC
                LIMIT 500
                """
            ).fetchall()
        )
    buckets: dict[str, int] = {"80-100": 0, "65-79": 0, "50-64": 0, "<50": 0}
    watch: dict[str, int] = {}
    poor: dict[str, int] = {}
    for rec in recs:
        score = rec.get("score") or 0
        if score >= 80:
            buckets["80-100"] += 1
        elif score >= 65:
            buckets["65-79"] += 1
        elif score >= 50:
            buckets["50-64"] += 1
        else:
            buckets["<50"] += 1
        watch[rec["theme"]] = watch.get(rec["theme"], 0) + 1
        if rec.get("decision") == "Avoid for now":
            poor[rec["symbol"]] = poor.get(rec["symbol"], 0) + 1
    return {
        "best_score_ranges": buckets,
        "best_setups": ["Orderly uptrend", "Near support with room to target", "Positive approved research"],
        "best_watchlists": sorted(watch.items(), key=lambda x: x[1], reverse=True)[:5],
        "poor_signals": sorted(poor.items(), key=lambda x: x[1], reverse=True)[:5],
        "outcome_patterns": "Rule-based MVP: add outcome checks over 2w, 4w, 6w, and 8w as recommendations age.",
    }


@app.get("/api/positions")
def positions() -> dict:
    with db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT p.*, t.symbol, t.company, i.price
                FROM positions p
                JOIN tickers t ON t.id = p.ticker_id
                LEFT JOIN indicators i ON i.ticker_id = t.id
                ORDER BY t.symbol
                """
            ).fetchall()
        )
    exposure: dict[str, float] = {}
    for row in rows:
        value = (row.get("price") or row["cost"]) * row["shares"]
        exposure[row["theme"]] = exposure.get(row["theme"], 0) + value
    total = sum(exposure.values()) or 1
    warnings = [f"{theme} is above 35% of tracked portfolio value." for theme, value in exposure.items() if value / total > 0.35]
    return {"positions": rows, "theme_exposure": exposure, "warnings": warnings}


@app.post("/api/positions")
def save_position(payload: PositionIn) -> dict:
    with db() as conn:
        ticker_id = upsert_ticker(conn, payload.ticker, theme=payload.theme)
        conn.execute(
            """
            INSERT INTO positions (ticker_id, shares, cost, theme)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(ticker_id) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, theme = excluded.theme
            """,
            (ticker_id, payload.shares, payload.cost, payload.theme),
        )
    return {"ok": True}


@app.post("/api/positions/import")
async def import_positions(file: UploadFile) -> dict:
    content = (await file.read()).decode("utf-8").splitlines()
    reader = csv.DictReader(content)
    imported = 0
    with db() as conn:
        for row in reader:
            symbol = (row.get("Ticker") or row.get("ticker") or "").strip()
            if not symbol:
                continue
            ticker_id = upsert_ticker(conn, symbol, theme=row.get("Theme") or row.get("theme") or "General")
            conn.execute(
                """
                INSERT INTO positions (ticker_id, shares, cost, theme)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(ticker_id) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, theme = excluded.theme
                """,
                (
                    ticker_id,
                    float(row.get("Shares") or row.get("shares") or 0),
                    float(row.get("Cost") or row.get("cost") or 0),
                    row.get("Theme") or row.get("theme") or "General",
                ),
            )
            imported += 1
    return {"imported": imported}


frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


def open_browser() -> None:
    time.sleep(1.2)
    webbrowser.open("http://127.0.0.1:8000")


if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=False)

