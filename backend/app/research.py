from __future__ import annotations

import re


FIELDS = {
    "ticker": "Ticker",
    "company": "Company",
    "date": "Date",
    "source_links": "Source Links",
    "summary": "Research Summary",
    "bullish": "Bullish Signals",
    "bearish": "Bearish Signals",
    "catalyst_type": "Catalyst Type",
    "time_sensitivity": "Time Sensitivity",
    "sentiment": "Sentiment",
    "confidence": "Confidence",
    "suggested_impact": "Suggested App Impact",
    "reason": "Reason",
}


def parse_research_signal(text: str) -> dict:
    normalized = text.replace("\r\n", "\n").strip()
    result = {key: "" for key in FIELDS}
    labels = "|".join(re.escape(label) for label in FIELDS.values())
    pattern = re.compile(rf"^({labels})\s*:\s*(.*)$", re.MULTILINE)
    matches = list(pattern.finditer(normalized))
    for index, match in enumerate(matches):
        label = match.group(1)
        value = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        body = normalized[start:end].strip()
        combined = "\n".join(part for part in [value, body] if part).strip()
        key = next(k for k, v in FIELDS.items() if v == label)
        result[key] = combined
    result["ticker"] = result["ticker"].upper().strip()
    return result

