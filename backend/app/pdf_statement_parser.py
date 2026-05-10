"""
pdf_statement_parser.py

Parses E*TRADE (Morgan Stanley) monthly PDF brokerage statements and extracts:
  • Current holdings (symbol, quantity, cost basis, market value)
  • Transaction activity (buys, sells, dividends, interest)

Returns a list of ParsedTransaction-compatible dicts that can be sent directly
to POST /api/portfolio/import.

Requires: pdfplumber  (pip install pdfplumber)
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Optional

try:
    import pdfplumber
    _HAS_PDFPLUMBER = True
except ImportError:
    _HAS_PDFPLUMBER = False


# ── Company name → ticker symbol lookup ───────────────────────────────────────
# Keys are uppercase company names as they appear in E*TRADE activity sections.
# The Holdings section supplements this at parse time via "(SYMBOL)" patterns.

COMPANY_TO_SYMBOL: dict[str, str] = {
    # ── Tech / Growth ─────────────────────────────────────────────────────────
    "APPLE INC": "AAPL",
    "MICROSOFT CORP": "MSFT",
    "MICROSOFT CORPORATION": "MSFT",
    "ALPHABET INC CL A": "GOOGL",
    "ALPHABET INC CL B": "GOOGL",
    "ALPHABET INC CL C": "GOOG",
    "ALPHABET INC": "GOOGL",
    "AMAZON.COM INC": "AMZN",
    "AMAZON COM INC": "AMZN",
    "META PLATFORMS INC": "META",
    "META PLATFORMS INC CL A": "META",
    "NVIDIA CORP": "NVDA",
    "NVIDIA CORPORATION": "NVDA",
    "TESLA INC": "TSLA",
    "NETFLIX INC": "NFLX",
    "ADOBE INC": "ADBE",
    "ADVANCED MICRO DEVICES INC": "AMD",
    "ADVANCED MICRO DEVICES": "AMD",
    "BROADCOM INC": "AVGO",
    "QUALCOMM INC": "QCOM",
    "INTEL CORP": "INTC",
    "INTEL CORPORATION": "INTC",
    "TAIWAN SEMICONDUCTOR MFG CO": "TSM",
    "TAIWAN SEMICONDUCTOR MFG": "TSM",
    # ── Cybersecurity ─────────────────────────────────────────────────────────
    "CROWDSTRIKE HLDGS INC": "CRWD",
    "CROWDSTRIKE HLDGS INC CL A": "CRWD",
    "CROWDSTRIKE HOLDINGS INC": "CRWD",
    "CROWDSTRIKE HOLDINGS INC CL A": "CRWD",
    "ZSCALER INC": "ZS",
    "ZSCALER, INC": "ZS",
    "PALO ALTO NETWORKS INC": "PANW",
    "FORTINET INC": "FTNT",
    "OKTA INC": "OKTA",
    "SENTINELONE INC": "S",
    "SENTINELONE INC CL A": "S",
    # ── SaaS / Cloud ──────────────────────────────────────────────────────────
    "SALESFORCE INC": "CRM",
    "SERVICENOW INC": "NOW",
    "WORKDAY INC": "WDAY",
    "SNOWFLAKE INC": "SNOW",
    "DATADOG INC": "DDOG",
    "DATADOG INC CL A": "DDOG",
    "MONGODB INC": "MDB",
    "CLOUDFLARE INC": "NET",
    "CLOUDFLARE INC CL A": "NET",
    "PALANTIR TECHNOLOGIES INC": "PLTR",
    "PALANTIR TECHNOLOGIES INC CL A": "PLTR",
    "HUBSPOT INC": "HUBS",
    "TWILIO INC": "TWLO",
    "TWILIO INC CL A": "TWLO",
    "SHOPIFY INC": "SHOP",
    "SHOPIFY INC CL A": "SHOP",
    # ── Fintech / Payments ────────────────────────────────────────────────────
    "PAYPAL HOLDINGS INC": "PYPL",
    "VISA INC": "V",
    "VISA INC CL A": "V",
    "MASTERCARD INC": "MA",
    "MASTERCARD INC CL A": "MA",
    "AMERICAN EXPRESS CO": "AXP",
    "COINBASE GLOBAL INC": "COIN",
    "ROBINHOOD MARKETS INC": "HOOD",
    "ROBINHOOD MARKETS INC CL A": "HOOD",
    "UBER TECHNOLOGIES INC": "UBER",
    "AIRBNB INC": "ABNB",
    "AIRBNB INC CL A": "ABNB",
    # ── Financials ────────────────────────────────────────────────────────────
    "JPMORGAN CHASE & CO": "JPM",
    "BANK OF AMERICA CORP": "BAC",
    "GOLDMAN SACHS GROUP INC": "GS",
    "MORGAN STANLEY": "MS",
    "WELLS FARGO & CO": "WFC",
    "BERKSHIRE HATHAWAY INC": "BRK.B",
    "BERKSHIRE HATHAWAY INC CL B": "BRK.B",
    # ── Healthcare ────────────────────────────────────────────────────────────
    "UNITEDHEALTH GROUP INC": "UNH",
    "ELI LILLY & CO": "LLY",
    "ELI LILLY AND CO": "LLY",
    "ABBVIE INC": "ABBV",
    "JOHNSON & JOHNSON": "JNJ",
    "PFIZER INC": "PFE",
    # ── Consumer / Industrials ────────────────────────────────────────────────
    "WALMART INC": "WMT",
    "HOME DEPOT INC": "HD",
    "COSTCO WHOLESALE CORP": "COST",
    "PROCTER & GAMBLE CO": "PG",
    "COCA COLA CO": "KO",
    "THE COCA-COLA CO": "KO",
    "PEPSICO INC": "PEP",
    "DISNEY WALT CO": "DIS",
    "WALT DISNEY CO": "DIS",
    "COMCAST CORP": "CMCSA",
    "COMCAST CORP CL A": "CMCSA",
    "VERIZON COMMUNICATIONS INC": "VZ",
    "AT&T INC": "T",
    "EXXON MOBIL CORP": "XOM",
    "CHEVRON CORP": "CVX",
    "BOEING CO": "BA",
    "LOCKHEED MARTIN CORP": "LMT",
    "CATERPILLAR INC": "CAT",
    "DEERE & CO": "DE",
    "3M CO": "MMM",
    "GENERAL ELECTRIC CO": "GE",
    # ── ETFs ──────────────────────────────────────────────────────────────────
    "SPDR S&P 500 ETF TRUST": "SPY",
    "INVESCO QQQ TRUST": "QQQ",
    "VANGUARD S&P 500 ETF": "VOO",
    "ISHARES RUSSELL 2000 ETF": "IWM",
    "VANGUARD TOTAL STOCK MKT ETF": "VTI",
    "SCHWAB US DIVIDEND EQUITY ETF": "SCHD",
    "JPMORGAN EQUITY PREMIUM INC ETF": "JEPQ",
    "ENERGY TRANSFER LP": "ET",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_amount(raw: str) -> Optional[float]:
    """Parse dollar amounts. $(7,980.00) → -7980.0, 11,604.97 → 11604.97."""
    if not raw:
        return None
    raw = raw.strip()
    negative = raw.startswith("(") or raw.startswith("$(")
    clean = re.sub(r"[\$\(\)\s,]", "", raw)
    try:
        val = float(clean)
        return -val if negative else val
    except ValueError:
        return None


def _parse_qty(raw: str) -> float:
    clean = re.sub(r"[,\s]", "", raw)
    try:
        return abs(float(clean))
    except ValueError:
        return 0.0


def _make_iso_date(month: int, day: int, year: int) -> str:
    return f"{year}-{month:02d}-{day:02d}"


def _company_to_symbol(name: str, extra_map: dict[str, str]) -> str:
    """Look up a ticker for a company name. Returns the cleaned name if not found."""
    key = name.strip().upper()
    if key in extra_map:
        return extra_map[key]
    if key in COMPANY_TO_SYMBOL:
        return COMPANY_TO_SYMBOL[key]
    # Try without common suffixes
    for suffix in [" CL A", " CL B", " CL C", " INC", " CORP", " CO", " LTD", " LLC", " LP"]:
        trimmed = key
        while trimmed.endswith(suffix):
            trimmed = trimmed[: -len(suffix)].rstrip()
        if trimmed != key and trimmed in COMPANY_TO_SYMBOL:
            return COMPANY_TO_SYMBOL[trimmed]
    return key  # fallback: return normalized company name


def _extract_year_and_month(full_text: str) -> tuple[int, int]:
    """Extract statement year and month from the header text."""
    m = re.search(
        r"For the Period\s+(\w+)\s+\d{1,2}[–\-]\d{1,2},?\s*(\d{4})", full_text
    )
    if m:
        month_name = m.group(1)
        year       = int(m.group(2))
        month_map = {
            "January": 1, "February": 2, "March": 3, "April": 4,
            "May": 5, "June": 6, "July": 7, "August": 8,
            "September": 9, "October": 10, "November": 11, "December": 12,
        }
        month = month_map.get(month_name, datetime.now().month)
        return year, month
    return datetime.now().year, datetime.now().month


def _extract_symbol_map_from_holdings(full_text: str) -> dict[str, str]:
    """
    Scan for patterns like "ZSCALER, INC (ZS)" and build company→symbol map
    to supplement COMPANY_TO_SYMBOL.
    """
    extra: dict[str, str] = {}
    for m in re.finditer(r"([A-Z][A-Z0-9\s,\.&\-]+?)\s+\(([A-Z]{1,5})\)", full_text):
        company = m.group(1).strip().upper()
        symbol  = m.group(2).strip()
        if len(company) > 3 and symbol.isalpha():
            extra[company] = symbol
    return extra


# ── Activity section parser ───────────────────────────────────────────────────
#
# E*TRADE activity lines look like:
#   "4/6 4/7 Bought CROWDSTRIKE HLDGS INC CL A ACTED AS AGENT 20.000 $399.0000 $(7,980.00)"
#   "4/30 Interest Income MORGAN STANLEY PRIVATE BANK NA (Period 04/01-04/30) 0.08"
#
# Key insight: after "ACTED AS AGENT" use [^0-9]* to skip any non-digit comment
# words (UNSOLICITED TRADE etc. that may appear on same line), then parse numbers.

_BUY_SELL_RE = re.compile(
    r"^(\d{1,2}/\d{1,2})"               # activity date  e.g. "4/6"
    r"(?:\s+(\d{1,2}/\d{1,2}))?"        # optional settle date  e.g. "4/7"
    r"\s+(Bought|Sold)"                  # transaction type
    r"\s+(.+?)"                          # description (lazy → stops at ACTED AS AGENT)
    r"\s+ACTED AS AGENT"                 # sentinel that ends the description
    r"[^0-9]*"                           # skip any non-digit comment text on same line
    r"([\d,]+\.\d+)"                     # quantity  e.g. "20.000"
    r"\s+\$?([\d,]+\.\d+)"              # price     e.g. "$399.0000" or "399.0000"
    r"\s+(\$?\([\d,]+\.\d+\)|\([\d,]+\.\d+\)|[\d,]+\.\d+)"  # amount handles $(x), (x), x
    r"\s*$",
    re.IGNORECASE,
)

_INTEREST_DIV_RE = re.compile(
    r"^(\d{1,2}/\d{1,2})"               # activity date
    r"(?:\s+\d{1,2}/\d{1,2})?"          # optional settle date (skip)
    r"\s+(Interest\s+Income|Dividend(?:\s+Income)?)"  # type
    r"\s+(.+?)"                          # description
    r"\s+([\d,]+\.\d+)"                 # amount (always positive)
    r"\s*$",
    re.IGNORECASE,
)

_SKIP_LINE_RE = re.compile(
    r"^(?:UNSOLICITED TRADE|ACTED AS AGENT|NET CREDITS|NET UNSETTLED|"
    r"PURCHASE AND SALE|Activity\s+Settlement|Date\s+Date\s+Activity|"
    r"CASH FLOW ACTIVITY|BANK DEPOSIT PROGRAM|Automatic |NET ACTIVITY|"
    r"Rating:|Asset Class:|Purchase and Sale|MESSAGES|Senior Investor)",
    re.IGNORECASE,
)


def _parse_activity_lines(
    lines: list[str],
    year: int,
    stmt_month: int,
    extra_sym_map: dict[str, str],
    file_name: str,
    broker: str = "E*TRADE",
) -> list[dict]:
    """Parse CASH FLOW ACTIVITY lines into ParsedTransaction dicts."""
    transactions: list[dict] = []

    def resolve_year(month: int) -> int:
        # Handle Jan statements that have Dec dates (prior year)
        if stmt_month == 1 and month == 12:
            return year - 1
        return year

    for raw_line in lines:
        line = raw_line.strip()
        if not line or _SKIP_LINE_RE.match(line):
            continue

        # ── Buy / Sell ────────────────────────────────────────────────────────
        m = _BUY_SELL_RE.match(line)
        if m:
            act_date_str = m.group(1)
            tx_type_raw  = m.group(3)
            description  = m.group(4).strip()
            qty          = _parse_qty(m.group(5))
            price_raw    = m.group(6)
            amount_raw   = m.group(7)

            act_month, act_day = map(int, act_date_str.split("/"))
            iso_date = _make_iso_date(act_month, act_day, resolve_year(act_month))

            symbol  = _company_to_symbol(description, extra_sym_map)
            price   = _parse_amount(price_raw)
            amount  = _parse_amount(amount_raw)

            if tx_type_raw.lower() == "bought":
                tx_type = "Buy"
                if amount is not None and amount > 0:
                    amount = -amount
            else:
                tx_type = "Sell"
                if amount is not None and amount < 0:
                    amount = -amount

            if qty == 0:
                continue

            derived_price = (
                abs(price) if price and abs(price) > 0
                else (abs(amount) / qty if amount and qty else None)
            )

            transactions.append({
                "transaction_date": iso_date,
                "symbol":           symbol,
                "type":             tx_type,
                "quantity":         qty,
                "price":            derived_price,
                "amount":           amount,
                "broker":           broker,
                "raw_row":          {"source_line": line, "file": file_name},
            })
            continue

        # ── Interest / Dividend ───────────────────────────────────────────────
        m2 = _INTEREST_DIV_RE.match(line)
        if m2:
            act_date_str = m2.group(1)
            type_raw     = m2.group(2).strip().lower()
            description  = m2.group(3).strip()
            amount       = _parse_amount(m2.group(4))

            act_month, act_day = map(int, act_date_str.split("/"))
            iso_date = _make_iso_date(act_month, act_day, resolve_year(act_month))

            if "interest" in type_raw:
                symbol  = "CASH"
                tx_type = "Interest"
            else:
                sym_m  = re.search(r"\(([A-Z]{1,5})\)", description)
                symbol = sym_m.group(1) if sym_m else _company_to_symbol(description, extra_sym_map)
                tx_type = "Dividend"

            transactions.append({
                "transaction_date": iso_date,
                "symbol":           symbol,
                "type":             tx_type,
                "quantity":         0.0,
                "price":            None,
                "amount":           amount,
                "broker":           broker,
                "raw_row":          {"source_line": line, "file": file_name},
            })

    return transactions


# ── Holdings section parser ───────────────────────────────────────────────────

def _parse_holdings_section(full_text: str) -> list[dict]:
    """
    Extract current holdings from the STOCKS section.
    Strategy: find "NAME (SYMBOL)" then extract all numbers that follow on the same line.
    """
    holdings: list[dict] = []

    # Work line by line for precision
    for line in full_text.splitlines():
        # Only process lines in the STOCKS area (has "( SYMBOL )" and dollar amounts)
        name_sym_m = re.search(
            r"([A-Z][A-Z0-9\s,\.&\-]+?)\s+\(([A-Z]{1,5})\)",
            line,
        )
        if not name_sym_m:
            continue

        company = name_sym_m.group(1).strip()
        symbol  = name_sym_m.group(2).strip()

        # Skip obvious non-holding matches (RSU grant lines, etc.)
        if any(kw in line for kw in ["RSU", "Grant Price", "Rating:", "Asset Class:"]):
            continue

        rest = line[name_sym_m.end():]

        # Extract all numeric tokens (plain numbers and parenthesized negatives)
        nums = re.findall(r"\([\d,]+\.\d+\)|[\d,]+\.\d+", rest)
        if len(nums) < 4:
            continue  # need at least qty, price, cost, market_value

        try:
            qty          = _parse_qty(nums[0])
            share_price  = _parse_amount(nums[1])
            total_cost   = _parse_amount(nums[2])
            market_value = _parse_amount(nums[3])
            unrealized   = _parse_amount(nums[4]) if len(nums) > 4 else None
        except Exception:
            continue

        holdings.append({
            "symbol":        symbol,
            "company":       company,
            "quantity":      qty,
            "share_price":   share_price,
            "total_cost":    total_cost,
            "market_value":  market_value,
            "unrealized_gl": unrealized,
        })

    return holdings


# ── Main entry point ──────────────────────────────────────────────────────────

def parse_etrade_pdf(
    pdf_bytes: bytes,
    file_name: str = "statement.pdf",
) -> dict:
    """
    Parse an E*TRADE monthly PDF statement.

    Returns:
        {
          "transactions": [ ParsedTransaction-compatible dicts ],
          "holdings":     [ current holdings from the Holdings section ],
          "metadata": {
            "statement_period": "April 2026",
            "account_number":   "326-606425-205",
            "total_value":      51238.19,
          },
          "warnings": [ str, ... ]
        }
    """
    if not _HAS_PDFPLUMBER:
        raise RuntimeError("pdfplumber is required: pip install pdfplumber")

    warnings_out: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]

    full_text = "\n".join(pages_text)

    # ── Metadata ──────────────────────────────────────────────────────────────
    year, stmt_month = _extract_year_and_month(full_text)

    month_names = ["", "January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]
    stmt_period = f"{month_names[stmt_month]} {year}"

    acct_m = re.search(r"(\d{3}-\d{6}-\d{3})", full_text)
    account_number = acct_m.group(1) if acct_m else "Unknown"

    total_val_m = re.search(r"Ending Total Value[^\$]*\$([\d,]+\.\d+)", full_text)
    total_value = _parse_amount(total_val_m.group(1)) if total_val_m else None

    # ── Build symbol map from Holdings ────────────────────────────────────────
    extra_sym_map = _extract_symbol_map_from_holdings(full_text)

    # ── Parse current holdings ────────────────────────────────────────────────
    holdings = _parse_holdings_section(full_text)

    # ── Find and parse CASH FLOW ACTIVITY sections ────────────────────────────
    activity_lines: list[str] = []
    in_activity = False

    for page_text in pages_text:
        for line in page_text.splitlines():
            stripped = line.strip()

            if re.match(r"CASH FLOW ACTIVITY BY DATE", stripped, re.IGNORECASE):
                in_activity = True
                continue

            if in_activity:
                # Stop collecting when we hit the summary line or a new section
                if re.match(r"NET CREDITS/?\(DEBITS\)", stripped, re.IGNORECASE):
                    in_activity = False
                    continue
                if re.match(r"UNSETTLED PURCHASES/SALES ACTIVITY", stripped, re.IGNORECASE):
                    in_activity = False
                    continue
                if re.match(r"MONEY MARKET FUND", stripped, re.IGNORECASE):
                    in_activity = False
                    continue

            if in_activity:
                activity_lines.append(line)

    if not activity_lines:
        warnings_out.append(
            "No 'CASH FLOW ACTIVITY BY DATE' section found — "
            "is this an E*TRADE monthly statement PDF?"
        )

    transactions = _parse_activity_lines(
        activity_lines,
        year=year,
        stmt_month=stmt_month,
        extra_sym_map=extra_sym_map,
        file_name=file_name,
        broker="E*TRADE",
    )

    # Warn on unresolved symbols (company names with spaces)
    unresolved = [
        t["symbol"] for t in transactions
        if " " in t["symbol"] and t["symbol"] != "CASH"
    ]
    if unresolved:
        warnings_out.append(
            f"Could not map to ticker: {', '.join(set(unresolved))}. "
            "These rows are imported with the company name as symbol — "
            "edit them in the Transactions tab after import."
        )

    return {
        "transactions": transactions,
        "holdings":     holdings,
        "metadata": {
            "statement_period": stmt_period,
            "account_number":   account_number,
            "total_value":      total_value,
            "broker":           "E*TRADE",
        },
        "warnings": warnings_out,
    }


# ── CLI smoke test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, json

    if len(sys.argv) < 2:
        print("Usage: python pdf_statement_parser.py <statement.pdf>")
        sys.exit(1)

    with open(sys.argv[1], "rb") as f:
        result = parse_etrade_pdf(f.read(), sys.argv[1])

    print(f"\n=== Metadata ===")
    print(json.dumps(result["metadata"], indent=2))

    print(f"\n=== Holdings ({len(result['holdings'])}) ===")
    for h in result["holdings"]:
        print(f"  {h['symbol']:6s}  {h['company'][:30]:30s}  qty={h['quantity']:>10.3f}  "
              f"cost=${h['total_cost'] or 0:>10,.2f}  mktval=${h['market_value'] or 0:>10,.2f}")

    print(f"\n=== Transactions ({len(result['transactions'])}) ===")
    for t in result["transactions"]:
        print(f"  {t['transaction_date']}  {t['type']:8s}  {t['symbol']:10s}  "
              f"qty={t['quantity']:>8.3f}  price={t['price'] or 0:>8.2f}  amt={t['amount'] or 0:>10.2f}")

    if result["warnings"]:
        print(f"\n=== Warnings ===")
        for w in result["warnings"]:
            print(f"  ⚠ {w}")
