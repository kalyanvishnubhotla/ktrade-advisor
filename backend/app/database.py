from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "ktrade_advisor.sqlite3"


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS watchlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                theme TEXT NOT NULL DEFAULT 'General',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tickers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL UNIQUE,
                company TEXT,
                asset_type TEXT NOT NULL DEFAULT 'stock',
                theme TEXT NOT NULL DEFAULT 'General',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS watchlist_tickers (
                watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                PRIMARY KEY (watchlist_id, ticker_id)
            );

            CREATE TABLE IF NOT EXISTS prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                UNIQUE(ticker_id, date)
            );

            CREATE TABLE IF NOT EXISTS indicators (
                ticker_id INTEGER PRIMARY KEY REFERENCES tickers(id) ON DELETE CASCADE,
                as_of TEXT NOT NULL,
                price REAL,
                ma20 REAL,
                ma50 REAL,
                ma200 REAL,
                rsi REAL,
                macd REAL,
                atr REAL,
                volume_ratio REAL,
                relative_strength REAL,
                support REAL,
                resistance REAL,
                distance_to_support REAL,
                distance_to_resistance REAL,
                pattern_signal TEXT,
                earnings_date TEXT
            );

            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                as_of TEXT NOT NULL,
                score REAL NOT NULL,
                decision TEXT NOT NULL,
                confidence TEXT NOT NULL,
                risk TEXT NOT NULL,
                trend_label TEXT NOT NULL,
                momentum_label TEXT NOT NULL,
                volume_label TEXT NOT NULL,
                news_label TEXT NOT NULL,
                summary TEXT NOT NULL,
                suggested_action TEXT NOT NULL,
                entry_range TEXT,
                invalidation_level TEXT,
                target1 TEXT,
                target2 TEXT,
                hold_window TEXT,
                why_rating TEXT,
                changes_view TEXT,
                UNIQUE(ticker_id, as_of)
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                price REAL,
                score REAL,
                decision TEXT,
                entry_range TEXT,
                invalidation_level TEXT,
                target1 TEXT,
                target2 TEXT,
                market_condition TEXT,
                explanation TEXT
            );

            CREATE TABLE IF NOT EXISTS outcomes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
                window TEXT NOT NULL,
                checked_at TEXT,
                price REAL,
                return_pct REAL,
                note TEXT,
                UNIQUE(recommendation_id, window)
            );

            CREATE TABLE IF NOT EXISTS research_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                source_date TEXT,
                company TEXT,
                source_links TEXT,
                summary TEXT,
                bullish TEXT,
                bearish TEXT,
                catalyst_type TEXT,
                time_sensitivity TEXT,
                sentiment TEXT,
                confidence TEXT,
                suggested_impact TEXT,
                reason TEXT,
                approved INTEGER NOT NULL DEFAULT 0,
                applied INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                shares REAL NOT NULL DEFAULT 0,
                cost REAL NOT NULL DEFAULT 0,
                theme TEXT NOT NULL DEFAULT 'General',
                UNIQUE(ticker_id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


def seed_defaults() -> None:
    defaults = {
        "AI": ["MSFT", "NVDA", "GOOGL"],
        "Semiconductors": ["NVDA", "AMD", "AVGO", "SMH"],
        "Cybersecurity": ["CRWD", "PANW", "FTNT", "CIBR"],
        "ETFs": ["SPY", "QQQ", "VTI", "SCHD"],
        "Current Holdings": [],
    }
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0]
        if count:
            return
        for name, symbols in defaults.items():
            cur = conn.execute(
                "INSERT INTO watchlists (name, theme, active) VALUES (?, ?, 1)",
                (name, name),
            )
            watchlist_id = cur.lastrowid
            for symbol in symbols:
                ticker_id = upsert_ticker(conn, symbol, theme=name)
                conn.execute(
                    "INSERT OR IGNORE INTO watchlist_tickers VALUES (?, ?)",
                    (watchlist_id, ticker_id),
                )


def upsert_ticker(conn: sqlite3.Connection, symbol: str, company: str | None = None, theme: str = "General") -> int:
    normalized = symbol.strip().upper()
    conn.execute(
        """
        INSERT INTO tickers (symbol, company, theme)
        VALUES (?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            company = COALESCE(excluded.company, tickers.company),
            theme = CASE WHEN tickers.theme = 'General' THEN excluded.theme ELSE tickers.theme END
        """,
        (normalized, company, theme),
    )
    return int(conn.execute("SELECT id FROM tickers WHERE symbol = ?", (normalized,)).fetchone()[0])

