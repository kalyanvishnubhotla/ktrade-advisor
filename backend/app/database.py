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
                bb_upper REAL,
                bb_lower REAL,
                bb_width_pct REAL,
                rsi REAL,
                rsi_interpretation TEXT,
                macd REAL,
                macd_signal REAL,
                macd_histogram REAL,
                macd_trend TEXT,
                momentum_score REAL,
                momentum_summary TEXT,
                momentum_divergence TEXT,
                adx REAL,
                plus_di REAL,
                minus_di REAL,
                adx_interpretation TEXT,
                trend_direction TEXT,
                obv REAL,
                obv_trend TEXT,
                volume_vs_20d REAL,
                rising_volume_on_up_days INTEGER,
                trend_alignment TEXT,
                trend_strength_score REAL,
                trend_strength_label TEXT,
                trend_strength_summary TEXT,
                volume_confirmation TEXT,
                volume_confirmation_score REAL,
                volume_confirmation_summary TEXT,
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

            CREATE TABLE IF NOT EXISTS pivots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                price REAL NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('high', 'low')),
                strength INTEGER NOT NULL,
                timeframe TEXT NOT NULL CHECK(timeframe IN ('daily', 'weekly')),
                touches INTEGER NOT NULL DEFAULT 1,
                lookback INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker_id, date, type, timeframe, lookback)
            );

            CREATE TABLE IF NOT EXISTS fib_zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                setup_direction TEXT NOT NULL CHECK(setup_direction IN ('up', 'down')),
                swing_start_date TEXT NOT NULL,
                swing_start_price REAL NOT NULL,
                swing_end_date TEXT NOT NULL,
                swing_end_price REAL NOT NULL,
                level_name TEXT NOT NULL,
                ratio_low REAL NOT NULL,
                ratio_high REAL NOT NULL,
                price_low REAL NOT NULL,
                price_high REAL NOT NULL,
                snapped_price_low REAL,
                snapped_price_high REAL,
                confluence_note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sr_zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                zone_type TEXT NOT NULL CHECK(zone_type IN ('support', 'resistance')),
                price_low REAL NOT NULL,
                price_high REAL NOT NULL,
                strength_score REAL NOT NULL,
                confluence_score REAL NOT NULL,
                sources_json TEXT NOT NULL,
                plain_english TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                trend_strength_summary TEXT,
                momentum_label TEXT NOT NULL,
                momentum_summary TEXT,
                macd_trend TEXT,
                volume_label TEXT NOT NULL,
                volume_confirmation_summary TEXT,
                news_label TEXT NOT NULL,
                summary TEXT NOT NULL,
                suggested_action TEXT NOT NULL,
                entry_range TEXT,
                invalidation_level TEXT,
                target1 TEXT,
                target2 TEXT,
                distance_to_buy_zone REAL,
                buy_zone_confluence REAL,
                setup_factor_scores TEXT,
                setup_positive_factors TEXT,
                setup_concern_factors TEXT,
                decision_reasons TEXT,
                risk_reward_summary TEXT,
                improve_to_buy TEXT,
                buy_zone_explanation TEXT,
                target_zone_explanation TEXT,
                fresh_high_targets INTEGER DEFAULT 0,
                fresh_high_target_note TEXT,
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

            CREATE TABLE IF NOT EXISTS recommendation_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ticker TEXT NOT NULL,
              snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
              current_price REAL NOT NULL,
              setup_quality INTEGER NOT NULL,
              recommended_action TEXT NOT NULL,
              buy_zone_low REAL,
              buy_zone_high REAL,
              risk_line REAL,
              review_target1 REAL,
              review_target2 REAL,
              distance_to_buy_pct REAL,
              signal_summary JSON,
              full_signals JSON,
              user_action TEXT,
              user_action_date DATETIME,
              actual_outcome_pct REAL,
              hold_period_days INTEGER,
              notes TEXT,
              FOREIGN KEY (ticker) REFERENCES tickers(symbol)
            );

            CREATE INDEX IF NOT EXISTS idx_snapshots_ticker_date ON recommendation_snapshots(ticker, snapshot_date DESC);

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

            CREATE TABLE IF NOT EXISTS news_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                feed_name TEXT NOT NULL,
                title TEXT NOT NULL,
                link TEXT NOT NULL UNIQUE,
                published_at TEXT,
                summary TEXT,
                sentiment TEXT NOT NULL DEFAULT 'Neutral',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS news_ticker_matches (
                news_item_id INTEGER NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
                ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
                match_reason TEXT NOT NULL,
                PRIMARY KEY (news_item_id, ticker_id)
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
        indicator_existing = [row["name"] for row in conn.execute("PRAGMA table_info(indicators)").fetchall()]
        for column, definition in [
            ("rsi_interpretation", "TEXT"),
            ("macd_signal", "REAL"),
            ("macd_histogram", "REAL"),
            ("macd_trend", "TEXT"),
            ("momentum_score", "REAL"),
            ("momentum_summary", "TEXT"),
            ("momentum_divergence", "TEXT"),
            ("adx", "REAL"),
            ("plus_di", "REAL"),
            ("minus_di", "REAL"),
            ("adx_interpretation", "TEXT"),
            ("trend_direction", "TEXT"),
            ("obv", "REAL"),
            ("obv_trend", "TEXT"),
            ("volume_vs_20d", "REAL"),
            ("rising_volume_on_up_days", "INTEGER"),
            ("trend_alignment", "TEXT"),
            ("trend_strength_score", "REAL"),
            ("trend_strength_label", "TEXT"),
            ("trend_strength_summary", "TEXT"),
            ("volume_confirmation", "TEXT"),
            ("volume_confirmation_score", "REAL"),
            ("volume_confirmation_summary", "TEXT"),
            ("bb_upper", "REAL"),
            ("bb_lower", "REAL"),
            ("bb_width_pct", "REAL"),
            # Week 3-4 signal columns (JSON blobs)
            ("earnings_signal_json", "TEXT"),
            ("sector_rs_signal_json", "TEXT"),
            ("regime_signal_json", "TEXT"),
            ("insider_signal_json", "TEXT"),
            ("fundamentals_signal_json", "TEXT"),
        ]:
            if column not in indicator_existing:
                conn.execute(f"ALTER TABLE indicators ADD COLUMN {column} {definition}")

        existing = [row["name"] for row in conn.execute("PRAGMA table_info(scores)").fetchall()]
        for column, definition in [
            ("distance_to_buy_zone", "REAL"),
            ("buy_zone_confluence", "REAL"),
            ("buy_zone_explanation", "TEXT"),
            ("target_zone_explanation", "TEXT"),
            ("momentum_summary", "TEXT"),
            ("macd_trend", "TEXT"),
            ("trend_strength_summary", "TEXT"),
            ("volume_confirmation_summary", "TEXT"),
            ("setup_factor_scores", "TEXT"),
            ("setup_positive_factors", "TEXT"),
            ("setup_concern_factors", "TEXT"),
            ("decision_reasons", "TEXT"),
            ("risk_reward_summary", "TEXT"),
            ("improve_to_buy", "TEXT"),
            ("fresh_high_targets", "INTEGER DEFAULT 0"),
            ("fresh_high_target_note", "TEXT"),
        ]:
            if column not in existing:
                conn.execute(f"ALTER TABLE scores ADD COLUMN {column} {definition}")


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
