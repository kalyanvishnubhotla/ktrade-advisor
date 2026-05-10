/**
 * portfolioImportService.ts
 *
 * Parses E*TRADE and Robinhood CSV exports into a unified structure,
 * then persists them via the backend API which calculates average-cost holdings.
 */

// ── Public interface ───────────────────────────────────────────────────────────

export interface ParsedTransaction {
  transaction_date: string;            // ISO "YYYY-MM-DD"
  symbol: string;
  type: 'Buy' | 'Sell' | 'Dividend' | 'Interest' | 'Transfer' | 'Other';
  quantity: number;
  price: number | null;
  amount: number | null;
  broker: string;
  raw_row: Record<string, string>;
}

export interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  newHoldings: string[];
  hasBuys: boolean;           // true if at least one Buy transaction was saved
  divSymbols: string[];       // symbols seen in dividends (positions likely held)
  typeCounts: Record<string, number>;  // e.g. { Buy: 5, Dividend: 12 }
}

// ── CSV utilities ─────────────────────────────────────────────────────────────

/** RFC-4180 compliant CSV line splitter (handles quoted commas and escaped quotes). */
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function stripQuotes(s: string): string {
  return s.replace(/^["'\s]+|["'\s]+$/g, '');
}

interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

function parseCSV(text: string): ParsedCSV {
  // Strip BOM and split into non-empty lines
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = splitCSVLine(lines[0]).map(stripQuotes);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]).map(stripQuotes);
    // Skip rows where every cell is empty
    if (vals.every(v => !v)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }

  return { headers, rows };
}

/** Find the first header name that matches any candidate (case-insensitive). */
function findCol(headers: string[], ...candidates: string[]): string | null {
  for (const c of candidates) {
    const h = headers.find(h => h.toLowerCase() === c.toLowerCase());
    if (h) return h;
  }
  return null;
}

/** Parse US date formats → "YYYY-MM-DD". Returns empty string on failure. */
function parseDate(raw: string): string {
  if (!raw) return '';
  // MM/DD/YYYY or M/D/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  // YYYY-MM-DD (already ISO)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

/** Strip $, commas, spaces then parse float. Returns null on non-numeric. */
function parseAmount(raw: string): number | null {
  if (!raw || raw === '--' || raw === 'N/A' || raw === '') return null;
  const n = parseFloat(raw.replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseQty(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── E*TRADE parser ─────────────────────────────────────────────────────────────
//
// Supports both the legacy and current E*TRADE transaction history exports.
// Column name variants are tried in order of likelihood.
//
// Key rules:
//   • Only rows where Status column (if present) equals "Executed"
//   • "Bought" → Buy, "Sold" → Sell
//   • Quantity is always stored as a positive number
//   • Amount: negative for Buy (money out), positive for Sell (money in)

export function parseEtradeCSV(csvText: string, _fileName: string): ParsedTransaction[] {
  const { headers, rows } = parseCSV(csvText);
  if (!headers.length) return [];

  const dateCol   = findCol(headers, 'TransactionDate', 'Transaction Date', 'Date', 'Trade Date', 'Settlement Date');
  const typeCol   = findCol(headers, 'TransactionType', 'Transaction Type', 'Type', 'Description');
  const symbolCol = findCol(headers, 'Symbol', 'Ticker', 'Security', 'Security Symbol');
  const qtyCol    = findCol(headers, 'Quantity', 'Qty', 'Shares', 'Share Quantity');
  const priceCol  = findCol(headers, 'Price', 'Price Per Share', 'Trade Price', 'Unit Price');
  const amountCol = findCol(headers, 'Amount', 'Net Amount', 'Total', 'Principal Amount');
  const statusCol = findCol(headers, 'Status');

  if (!dateCol || !typeCol) return [];

  const out: ParsedTransaction[] = [];

  for (const row of rows) {
    // ── Status filter ──────────────────────────────────────────────────────
    if (statusCol) {
      const status = row[statusCol]?.toLowerCase() ?? '';
      if (status && status !== 'executed') continue;
    }

    const rawType  = (row[typeCol] ?? '').trim();
    const rawTypeLc = rawType.toLowerCase();
    const symbol   = symbolCol ? row[symbolCol]?.replace(/\*+$/, '').trim() ?? '' : '';

    // ── Type mapping ───────────────────────────────────────────────────────
    let type: ParsedTransaction['type'];
    if (rawTypeLc.includes('bought') || rawTypeLc === 'buy' || rawTypeLc === 'purchase' || rawTypeLc.includes('reinvest')) {
      type = 'Buy';
    } else if (rawTypeLc.includes('sold') || rawTypeLc === 'sell' || rawTypeLc === 'sale') {
      type = 'Sell';
    } else if (rawTypeLc.includes('dividend') || rawTypeLc === 'div') {
      type = 'Dividend';
    } else if (rawTypeLc.includes('interest')) {
      type = 'Interest';
    } else if (rawTypeLc.includes('transfer') || rawTypeLc.includes('contribution') || rawTypeLc.includes('withdrawal') || rawTypeLc.includes('journal')) {
      type = 'Transfer';
    } else {
      type = 'Other';
    }

    // Skip transferlike rows without a real security symbol
    if (!symbol || symbol === '--') {
      if (type !== 'Interest' && type !== 'Dividend') continue;
    }

    // ── Quantity & price ───────────────────────────────────────────────────
    const rawQty    = qtyCol    ? parseQty(row[qtyCol])       : 0;
    const rawPrice  = priceCol  ? parseAmount(row[priceCol])  : null;
    const rawAmount = amountCol ? parseAmount(row[amountCol]) : null;

    const quantity = Math.abs(rawQty);
    const price    = rawPrice !== null ? Math.abs(rawPrice) : null;

    // Normalise amount sign: negative for Buy, positive for Sell
    let amount = rawAmount;
    if (amount !== null) {
      if (type === 'Buy'  && amount > 0) amount = -amount;
      if (type === 'Sell' && amount < 0) amount = -amount;
    }

    // Derive price from amount+qty when missing
    const derivedPrice = (price == null && amount !== null && quantity > 0)
      ? Math.abs(amount) / quantity
      : price;

    const dateStr = dateCol ? parseDate(row[dateCol]) : '';
    if (!dateStr) continue;

    out.push({
      transaction_date: dateStr,
      symbol: symbol || 'CASH',
      type,
      quantity,
      price: derivedPrice,
      amount,
      broker: 'E*TRADE',
      raw_row: row,
    });
  }

  return out;
}

// ── Robinhood parser ──────────────────────────────────────────────────────────
//
// Standard Robinhood account activity CSV columns:
//   Activity Date, Process Date, Settle Date, Instrument, Description,
//   Trans Code, Quantity, Price, Amount
//
// Trans Code values handled:
//   Buy / BTO       → Buy
//   Sell / STC      → Sell
//   CDIV / DIV      → Dividend
//   INT             → Interest
//   SOFF / SPLIT    → Other
//   ACH / JNLC / JNLS / DIVTAX / MISC / GOLD → skipped

const RH_SKIP = new Set(['ACH', 'JNLC', 'JNLS', 'DIVTAX', 'MISC', 'GOLD', 'PFOF', '']);

export function parseRobinhoodCSV(csvText: string, _fileName: string): ParsedTransaction[] {
  const { headers, rows } = parseCSV(csvText);
  if (!headers.length) return [];

  const dateCol      = findCol(headers, 'Activity Date', 'Date', 'Process Date');
  const symbolCol    = findCol(headers, 'Instrument', 'Symbol', 'Ticker', 'Security');
  const transCodeCol = findCol(headers, 'Trans Code', 'TransCode', 'Transaction Code', 'Type');
  const qtyCol       = findCol(headers, 'Quantity', 'Qty', 'Shares');
  const priceCol     = findCol(headers, 'Price', 'Price Per Share');
  const amountCol    = findCol(headers, 'Amount', 'Net Amount');

  if (!dateCol || !transCodeCol) return [];

  const out: ParsedTransaction[] = [];

  for (const row of rows) {
    const code   = (transCodeCol ? row[transCodeCol] : '').trim().toUpperCase();
    const symbol = (symbolCol    ? row[symbolCol]    : '').trim();

    if (RH_SKIP.has(code)) continue;

    // ── Type mapping ───────────────────────────────────────────────────────
    let type: ParsedTransaction['type'];
    switch (code) {
      case 'BUY':
      case 'BTO':   type = 'Buy';      break;
      case 'SELL':
      case 'STC':   type = 'Sell';     break;
      case 'CDIV':
      case 'DIV':   type = 'Dividend'; break;
      case 'INT':   type = 'Interest'; break;
      case 'SOFF':
      case 'SPLIT': type = 'Other';    break;
      default:
        if (!symbol) continue;  // unknown code with no symbol → skip
        type = 'Other';
    }

    if (!symbol && type !== 'Interest') continue;

    // ── Quantity & price ───────────────────────────────────────────────────
    const rawQty    = qtyCol    ? parseQty(row[qtyCol])       : 0;
    const rawPrice  = priceCol  ? parseAmount(row[priceCol])  : null;
    const rawAmount = amountCol ? parseAmount(row[amountCol]) : null;

    const quantity = Math.abs(rawQty);
    const price    = rawPrice !== null ? Math.abs(rawPrice) : null;

    // Robinhood: amount is already signed (negative for buys, positive for sells)
    // but normalise defensively
    let amount = rawAmount;
    if (amount !== null) {
      if (type === 'Buy'  && amount > 0) amount = -amount;
      if (type === 'Sell' && amount < 0) amount = -amount;
    }

    const derivedPrice = (price == null && amount !== null && quantity > 0)
      ? Math.abs(amount) / quantity
      : price;

    const dateStr = dateCol ? parseDate(row[dateCol]) : '';
    if (!dateStr) continue;

    out.push({
      transaction_date: dateStr,
      symbol: symbol || 'CASH',
      type,
      quantity,
      price: derivedPrice,
      amount,
      broker: 'Robinhood',
      raw_row: row,
    });
  }

  return out;
}

// ── Broker auto-detection ─────────────────────────────────────────────────────

function detectBroker(csvText: string, fileName: string): 'etrade' | 'robinhood' | 'unknown' {
  const nameLc   = fileName.toLowerCase();
  const headerLc = csvText.split('\n')[0].toLowerCase();

  // File-name hints (fastest check)
  if (nameLc.includes('etrade') || nameLc.includes('e-trade') || nameLc.startsWith('et_')) return 'etrade';
  if (nameLc.includes('robinhood') || nameLc.startsWith('rh_')) return 'robinhood';

  // Header-content detection
  if (headerLc.includes('trans code') || headerLc.includes('activity date') || headerLc.includes('instrument')) {
    return 'robinhood';
  }
  if (
    headerLc.includes('transactiontype') ||
    headerLc.includes('transaction type') ||
    headerLc.includes('security type') ||
    headerLc.includes('commission')
  ) {
    return 'etrade';
  }

  return 'unknown';
}

// ── importPortfolioFiles ──────────────────────────────────────────────────────

const API_BASE = '';

export interface PDFParseResult {
  transactions: ParsedTransaction[];
  holdings: Array<{
    symbol: string;
    company: string;
    quantity: number;
    share_price: number | null;
    total_cost: number | null;
    market_value: number | null;
    unrealized_gl: number | null;
  }>;
  metadata: {
    statement_period: string;
    account_number: string;
    total_value: number | null;
    broker: string;
  };
  warnings: string[];
}

/**
 * Send a PDF file to the backend for parsing.
 * Returns structured transactions + holdings + statement metadata.
 */
export async function parsePDFStatement(file: File): Promise<PDFParseResult> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`${API_BASE}/api/portfolio/parse-pdf`, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    throw new Error(`PDF parse failed: ${body}`);
  }
  return resp.json();
}

/**
 * Parse one or more broker files (CSV or PDF), POST the transactions to the
 * backend, and return a summary of what was imported and which holdings are new.
 *
 * PDF files (E*TRADE statements) are sent to the backend for pdfplumber parsing.
 * CSV files are parsed client-side and then imported.
 */
export async function importPortfolioFiles(
  files: FileList | File[],
): Promise<ImportResult> {
  const fileArray = Array.from(files);
  const allTransactions: Array<ParsedTransaction & { file_name: string }> = [];
  let failedFiles = 0;

  for (const file of fileArray) {
    try {
      const isPDF = file.name.toLowerCase().endsWith('.pdf');

      if (isPDF) {
        // ── PDF path: backend parses it ──────────────────────────────────────
        const result = await parsePDFStatement(file);
        if (result.transactions.length === 0) {
          failedFiles++;
          continue;
        }
        allTransactions.push(...result.transactions.map(t => ({ ...t, file_name: file.name })));
      } else {
        // ── CSV path: client-side parsing ─────────────────────────────────────
        const text   = await file.text();
        const broker = detectBroker(text, file.name);

        let parsed: ParsedTransaction[];
        if (broker === 'etrade') {
          parsed = parseEtradeCSV(text, file.name);
        } else if (broker === 'robinhood') {
          parsed = parseRobinhoodCSV(text, file.name);
        } else {
          const et = parseEtradeCSV(text, file.name);
          const rh = parseRobinhoodCSV(text, file.name);
          parsed = et.length >= rh.length ? et : rh;
        }

        if (parsed.length === 0) {
          failedFiles++;
          continue;
        }

        allTransactions.push(...parsed.map(t => ({ ...t, file_name: file.name })));
      }
    } catch {
      failedFiles++;
    }
  }

  if (allTransactions.length === 0) {
    return { success: 0, failed: failedFiles || fileArray.length, skipped: 0, newHoldings: [], hasBuys: false, divSymbols: [], typeCounts: {} };
  }

  // POST to backend — backend saves rows + recalculates average-cost holdings
  const resp = await fetch(`${API_BASE}/api/portfolio/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: allTransactions }),
  });

  if (!resp.ok) {
    throw new Error(`Import failed: ${await resp.text()}`);
  }

  const result = await resp.json();
  return {
    success:    result.saved        ?? allTransactions.length,
    failed:     failedFiles         + (result.failed ?? 0),
    skipped:    result.skipped      ?? 0,
    newHoldings: result.new_holdings ?? [],
    hasBuys:    result.has_buys     ?? false,
    divSymbols: result.div_symbols  ?? [],
    typeCounts: result.type_counts  ?? {},
  };
}

// ── Utility re-exports ────────────────────────────────────────────────────────

/** Return a human-readable broker name for display in the UI. */
export function brokerDisplayName(broker: string): string {
  if (broker.toLowerCase().includes('etrade') || broker === 'E*TRADE') return 'E*TRADE';
  if (broker.toLowerCase().includes('robinhood'))                       return 'Robinhood';
  return broker;
}
