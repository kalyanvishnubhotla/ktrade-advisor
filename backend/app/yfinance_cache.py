"""
yfinance_cache.py
─────────────────

Disk-backed TTL cache for slow Yahoo Finance lookups, plus a few small helpers
that make the rest of the codebase forget yfinance is slow.

WHY THIS EXISTS
───────────────
Before this module, every Refresh did roughly 6 sequential HTTP round-trips per
ticker — get_info, history, earnings_dates, calendar, eps_surprise, insider —
even for fields that almost never change (e.g. company name, sector, insider
filings update daily at most).

This cache lets us call expensive yfinance methods *once* and re-use the result
across:
  • multiple refreshes within a short window
  • multiple tickers that need the same auxiliary data (sector ETFs, VIX, etc.)
  • restarts of the backend (the cache survives in SQLite)

DESIGN DECISIONS
────────────────
1. **Per-kind TTLs** — a price history that's 4 minutes old is still useful;
   a company name from yesterday is fine. We pick TTLs per data type so a single
   "5 minute cache" doesn't waste calls on stable fields.
2. **SQLite-backed** — no new infrastructure; uses the same db() context as the
   rest of the app. Survives restarts. Cache state is inspectable with `sqlite3`.
3. **Pickle for payloads** — DataFrames and dicts both serialize cleanly. Cache
   keys never contain user input so the usual pickle-security caveats don't apply.
4. **Thread-safe by accident** — each call opens its own SQLite connection.
   Writes are serialized by SQLite's WAL/journal.
5. **`get_or_fetch()` is the only public API you need** — it does the read/write
   dance + miss handling in one place.

USAGE
─────
    from .yfinance_cache import yf_cached_info, yf_cached_history

    info = yf_cached_info("AAPL")                  # dict, 24h TTL
    df   = yf_cached_history("AAPL", period="2y")  # DataFrame, 5min TTL

You can also call the lower-level primitives directly when you need a custom
fetcher (e.g. for things that aren't yfinance — VIX bulk fetch, etc.):

    from .yfinance_cache import cache_get_or_fetch

    vix = cache_get_or_fetch('vix', 'spot', ttl_secs=300, fetcher=fetch_vix_now)
"""

from __future__ import annotations

import logging
import pickle
import time
from typing import Any, Callable, Optional

from .database import db

log = logging.getLogger("ktrade.yfcache")


# ── TTL defaults per data kind ────────────────────────────────────────────────
# Anything not in this dict gets a conservative 5-minute default.

DEFAULT_TTLS: dict[str, int] = {
    "history":        300,        # 5 min  — price data, intraday changes
    "info":           86_400,     # 24 hr  — sector, company name, market cap
    "insider":        86_400,     # 24 hr  — SEC filings refresh daily
    "earnings_dates": 86_400,     # 24 hr
    "eps_surprise":   604_800,    # 7 days — only changes each earnings report
    "calendar":       86_400,     # 24 hr
    "vix":            300,        # 5 min  — index level
    "regime":         300,        # 5 min  — derived from VIX + breadth
}


# ── Core primitives ───────────────────────────────────────────────────────────

def cache_get(kind: str, key: str) -> Optional[Any]:
    """
    Return a cached payload if it exists AND is still within its TTL.
    Otherwise return None — caller is expected to fetch fresh.
    """
    now = int(time.time())
    with db() as conn:
        row = conn.execute(
            "SELECT cached_at, ttl_secs, payload FROM yf_cache WHERE kind = ? AND key = ?",
            (kind, key),
        ).fetchone()
    if not row:
        return None
    age = now - int(row["cached_at"])
    if age > int(row["ttl_secs"]):
        return None  # expired — treat as miss
    try:
        return pickle.loads(row["payload"])
    except Exception as exc:
        # Cache poisoning shouldn't crash the app
        log.warning(f"yf_cache: failed to unpickle {kind}/{key}: {exc}")
        return None


def cache_set(kind: str, key: str, value: Any, ttl_secs: Optional[int] = None) -> None:
    """Persist a value with the given (or default-for-kind) TTL."""
    if ttl_secs is None:
        ttl_secs = DEFAULT_TTLS.get(kind, 300)
    try:
        blob = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        log.warning(f"yf_cache: failed to pickle {kind}/{key}: {exc}")
        return
    with db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO yf_cache (kind, key, cached_at, ttl_secs, payload)
            VALUES (?, ?, ?, ?, ?)
            """,
            (kind, key, int(time.time()), int(ttl_secs), blob),
        )


def cache_get_or_fetch(
    kind: str,
    key: str,
    fetcher: Callable[[], Any],
    ttl_secs: Optional[int] = None,
) -> Optional[Any]:
    """
    The one function 95% of callers should use.

    1. Try the cache.
    2. On miss, call fetcher().
    3. On success, write to cache and return.
    4. On fetcher failure, log and return None (NEVER raise — refresh must keep going).
    """
    cached = cache_get(kind, key)
    if cached is not None:
        return cached
    try:
        fresh = fetcher()
    except Exception as exc:
        log.info(f"yf_cache: fetch failed for {kind}/{key}: {exc}")
        return None
    if fresh is None:
        return None
    cache_set(kind, key, fresh, ttl_secs=ttl_secs)
    return fresh


# ── High-level helpers wrapping common yfinance fetches ───────────────────────

def yf_cached_info(symbol: str) -> Optional[dict]:
    """yfinance Ticker.get_info() with 24-hour cache."""
    def _fetch() -> dict:
        import yfinance as yf
        return yf.Ticker(symbol).get_info() or {}
    return cache_get_or_fetch("info", symbol.upper(), _fetch)


def yf_cached_history(symbol: str, period: str = "2y"):
    """yfinance Ticker.history() with 5-minute cache."""
    def _fetch():
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=period, auto_adjust=False)
        if df is None or df.empty:
            return None
        return df
    return cache_get_or_fetch("history", f"{symbol.upper()}:{period}", _fetch)


def yf_cached_earnings_dates(symbol: str):
    """Ticker.get_earnings_dates(limit=4) with 24-hour cache."""
    def _fetch():
        import yfinance as yf
        return yf.Ticker(symbol).get_earnings_dates(limit=4)
    return cache_get_or_fetch("earnings_dates", symbol.upper(), _fetch)


def yf_cached_calendar(symbol: str):
    """Ticker.calendar with 24-hour cache."""
    def _fetch():
        import yfinance as yf
        return yf.Ticker(symbol).calendar
    return cache_get_or_fetch("calendar", symbol.upper(), _fetch)


def yf_cached_eps_surprise(symbol: str) -> Optional[float]:
    """Avg EPS surprise % over last 4 quarters, with 7-day cache."""
    def _fetch():
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        hist = getattr(ticker, "earnings_history", None)
        if hist is None:
            hist = getattr(ticker, "quarterly_earnings", None)
        if hist is None or (hasattr(hist, "empty") and hist.empty):
            return None
        for col in ["Surprise(%)", "surprisePercent", "Surprise"]:
            if col in hist.columns:
                vals = hist[col].dropna().tail(4).tolist()
                if vals:
                    return round(sum(vals) / len(vals), 1)
        return None
    return cache_get_or_fetch("eps_surprise", symbol.upper(), _fetch)


def yf_cached_insider(symbol: str):
    """Ticker.insider_transactions DataFrame with 24-hour cache."""
    def _fetch():
        import yfinance as yf
        df = yf.Ticker(symbol).insider_transactions
        return df
    return cache_get_or_fetch("insider", symbol.upper(), _fetch)


# ── Maintenance ───────────────────────────────────────────────────────────────

def cache_stats() -> dict:
    """Return per-kind row count and oldest/newest age (seconds). For dashboards."""
    now = int(time.time())
    with db() as conn:
        rows = conn.execute(
            """
            SELECT kind,
                   COUNT(*)                 AS rows,
                   MIN(cached_at)           AS oldest,
                   MAX(cached_at)           AS newest,
                   AVG(ttl_secs)            AS avg_ttl
            FROM yf_cache GROUP BY kind ORDER BY kind
            """
        ).fetchall()
    return {
        row["kind"]: {
            "rows":         row["rows"],
            "age_oldest_s": now - int(row["oldest"]) if row["oldest"] else None,
            "age_newest_s": now - int(row["newest"]) if row["newest"] else None,
            "avg_ttl_s":    int(row["avg_ttl"] or 0),
        }
        for row in rows
    }


def cache_purge_expired() -> int:
    """Delete rows whose age exceeds ttl. Run on startup or periodically."""
    now = int(time.time())
    with db() as conn:
        cur = conn.execute(
            "DELETE FROM yf_cache WHERE (? - cached_at) > ttl_secs",
            (now,),
        )
        return cur.rowcount


def cache_clear(kind: Optional[str] = None) -> int:
    """Clear all (or one kind of) cache entries. Returns rows deleted."""
    with db() as conn:
        if kind:
            cur = conn.execute("DELETE FROM yf_cache WHERE kind = ?", (kind,))
        else:
            cur = conn.execute("DELETE FROM yf_cache")
        return cur.rowcount
