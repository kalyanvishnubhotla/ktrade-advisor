from __future__ import annotations

import html
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

from .database import db, rows_to_dicts


RSS_SOURCES = [
    {
        "source": "Fox Business",
        "feed_name": "Markets",
        "url": "https://moxie.foxbusiness.com/google-publisher/markets.xml",
    },
    {
        "source": "Fox Business",
        "feed_name": "Economy",
        "url": "https://moxie.foxbusiness.com/google-publisher/economy.xml",
    },
    {
        "source": "Fox Business",
        "feed_name": "Technology",
        "url": "https://moxie.foxbusiness.com/google-publisher/technology.xml",
    },
    {
        "source": "CNBC",
        "feed_name": "Top News",
        "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    },
    {
        "source": "CNBC",
        "feed_name": "Business",
        "url": "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    },
    {
        "source": "CNBC",
        "feed_name": "Finance",
        "url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    },
    {
        "source": "CNBC",
        "feed_name": "Earnings",
        "url": "https://www.cnbc.com/id/15839135/device/rss/rss.html",
    },
    {
        "source": "MarketWatch",
        "feed_name": "Top Stories",
        "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
    },
    {
        "source": "MarketWatch",
        "feed_name": "Market Pulse",
        "url": "https://feeds.marketwatch.com/marketwatch/marketpulse/",
    },
    {
        "source": "Yahoo Finance",
        "feed_name": "Market News",
        "url": "https://finance.yahoo.com/news/rssindex",
    },
    {
        "source": "Nasdaq",
        "feed_name": "Markets",
        "url": "https://www.nasdaq.com/feed/rssoutbound?category=Markets",
    },
]

POSITIVE_WORDS = [
    "beat",
    "beats",
    "upgrade",
    "upgraded",
    "raises",
    "raised",
    "surge",
    "surges",
    "rally",
    "record",
    "growth",
    "profit",
    "profits",
    "strong",
    "tops",
    "wins",
]

NEGATIVE_WORDS = [
    "miss",
    "misses",
    "downgrade",
    "downgraded",
    "cuts",
    "cut",
    "falls",
    "fall",
    "drops",
    "drop",
    "slumps",
    "warning",
    "probe",
    "lawsuit",
    "risk",
    "tariff",
    "loss",
    "weak",
]

COMPANY_STOPWORDS = {
    "inc",
    "inc.",
    "corp",
    "corporation",
    "company",
    "co",
    "ltd",
    "plc",
    "class",
    "common",
    "stock",
    "etf",
    "trust",
    "fund",
    "shares",
    "nasdaq",
    "equity",
    "premium",
}


def strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def child_text(item: ET.Element, name: str) -> str:
    found = item.find(name)
    return strip_tags(found.text or "") if found is not None else ""


def parse_date(value: str) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except Exception:
        return None


def classify_sentiment(title: str, summary: str) -> str:
    text = f"{title} {summary}".lower()
    positive = sum(1 for word in POSITIVE_WORDS if re.search(rf"\b{re.escape(word)}\b", text))
    negative = sum(1 for word in NEGATIVE_WORDS if re.search(rf"\b{re.escape(word)}\b", text))
    if positive > negative:
        return "Positive"
    if negative > positive:
        return "Negative"
    if positive and negative:
        return "Mixed"
    return "Neutral"


def company_keywords(company: str | None) -> list[str]:
    if not company:
        return []
    words = re.findall(r"[A-Za-z][A-Za-z0-9&.-]+", company.lower())
    keywords = []
    for word in words:
        cleaned = word.strip(".,")
        if len(cleaned) >= 4 and cleaned not in COMPANY_STOPWORDS:
            keywords.append(cleaned)
    return keywords[:4]


def match_tickers(text: str, tickers: list[dict]) -> list[tuple[int, str]]:
    lowered = text.lower()
    matches = []
    for ticker in tickers:
        symbol = ticker["symbol"]
        if len(symbol) <= 2 and re.search(rf"\${re.escape(symbol)}(?![A-Z0-9])", text):
            matches.append((ticker["id"], f"cashtag {symbol}"))
            continue
        if len(symbol) > 2 and re.search(rf"(?<![A-Z0-9]){re.escape(symbol)}(?![A-Z0-9])", text):
            matches.append((ticker["id"], f"symbol {symbol}"))
            continue
        if ticker.get("asset_type") == "etf":
            continue
        for keyword in company_keywords(ticker.get("company")):
            if re.search(rf"\b{re.escape(keyword)}\b", lowered):
                matches.append((ticker["id"], f"company keyword {keyword}"))
                break
    return matches


def fetch_feed(source: dict) -> list[dict]:
    request = urllib.request.Request(source["url"], headers={"User-Agent": "KtradeAdvisor/1.0"})
    data = urllib.request.urlopen(request, timeout=15).read()
    root = ET.fromstring(data)
    items = []
    for item in root.findall(".//item")[:40]:
        title = child_text(item, "title")
        link = child_text(item, "link")
        summary = child_text(item, "description")
        if not title or not link:
            continue
        published_at = parse_date(child_text(item, "pubDate"))
        items.append(
            {
                "source": source["source"],
                "feed_name": source["feed_name"],
                "title": title,
                "link": link,
                "published_at": published_at,
                "summary": summary[:500],
                "sentiment": classify_sentiment(title, summary),
            }
        )
    return items


def refresh_news() -> dict:
    fetched = 0
    matched = 0
    failed = []
    with db() as conn:
        tickers = rows_to_dicts(conn.execute("SELECT id, symbol, company, asset_type FROM tickers ORDER BY symbol").fetchall())

    # Fetch all RSS feeds in parallel (14 feeds × ~1 s each → was 14 s serial,
    # now ~2 s using a small pool). Per-feed errors don't block the others.
    from concurrent.futures import ThreadPoolExecutor, as_completed
    feed_results: list[tuple[dict, list]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        future_to_source = {pool.submit(fetch_feed, source): source for source in RSS_SOURCES}
        for fut in as_completed(future_to_source):
            source = future_to_source[fut]
            try:
                feed_results.append((source, fut.result()))
            except Exception as exc:
                failed.append({"source": source["source"], "feed": source["feed_name"], "reason": str(exc)})

    # Single DB transaction across ALL feeds — was N transactions, now 1.
    for source, items in feed_results:
        fetched += len(items)
        with db() as conn:
            for item in items:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO news_items
                    (source, feed_name, title, link, published_at, summary, sentiment)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["source"],
                        item["feed_name"],
                        item["title"],
                        item["link"],
                        item["published_at"],
                        item["summary"],
                        item["sentiment"],
                    ),
                )
                row = conn.execute("SELECT id FROM news_items WHERE link = ?", (item["link"],)).fetchone()
                if not row:
                    continue
                text = f"{item['title']} {item['summary']}"
                for ticker_id, reason in match_tickers(text, tickers):
                    conn.execute(
                        "INSERT OR IGNORE INTO news_ticker_matches VALUES (?, ?, ?)",
                        (row["id"], ticker_id, reason),
                    )
                    matched += 1
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_news_refresh', ?)", (datetime.now(timezone.utc).isoformat(),))
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_news_failed_count', ?)", (str(len(failed)),))
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_news_error', ?)",
                ("; ".join(f"{item['source']} {item['feed']}: {item['reason']}" for item in failed[:4]),),
            )
    return {"fetched": fetched, "matched": matched, "failed": failed}


def news_for_ticker(ticker_id: int, limit: int = 8) -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT ni.*, ntm.match_reason
                FROM news_ticker_matches ntm
                JOIN news_items ni ON ni.id = ntm.news_item_id
                WHERE ntm.ticker_id = ?
                ORDER BY COALESCE(ni.published_at, ni.created_at) DESC
                LIMIT ?
                """,
                (ticker_id, limit),
            ).fetchall()
        )


def latest_news(limit: int = 30) -> list[dict]:
    with db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT ni.*, GROUP_CONCAT(t.symbol, ', ') AS tickers
                FROM news_items ni
                LEFT JOIN news_ticker_matches ntm ON ntm.news_item_id = ni.id
                LEFT JOIN tickers t ON t.id = ntm.ticker_id
                GROUP BY ni.id
                ORDER BY COALESCE(ni.published_at, ni.created_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        )
