/**
 * portfolioService.ts
 *
 * High-level portfolio data layer.  Talks to the backend REST API and returns
 * typed objects that the UI can consume directly.
 *
 * Holdings are automatically recalculated on the backend after every import
 * (handled by portfolioImportService → POST /api/portfolio/import).
 * Call recalculateHoldings() only when you need an explicit rebuild (e.g.
 * after manual edits or a settings change).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortfolioHolding {
  symbol:                string;
  quantity:              number;
  avg_cost_basis:        number | null;
  total_cost:            number | null;
  last_updated:          string;
  sources:               string | null;       // comma-separated broker names
  last_transaction_date: string | null;

  // Enriched by engine (absent if symbol not yet in tickers table)
  theme?:                string | null;       // e.g. "AI", "Cybersecurity"
  current_price?:        number | null;
  score?:                number | null;       // 0–100 setup quality
  decision?:             string | null;       // Buy / Wait / Watch / Avoid / Hold
  confidence?:           string | null;
  risk?:                 string | null;
  entry_range?:          string | null;
  target1?:              string | null;
  invalidation_level?:   string | null;
  distance_to_buy_zone?: number | null;       // % above buy zone centre (0 = in zone)
  buy_zone_confluence?:  number | null;
  suggested_action?:     string | null;
  summary?:              string | null;
  improve_to_buy?:       string | null;
  hold_window?:          string | null;
  unrealized_pnl_pct?:   number | null;
}

export interface PortfolioSummary {
  totalValue:           number;
  totalCost:            number;
  unrealizedPL:         number;
  unrealizedPLPercent:  number;
  cashBalance:          number;
  topHoldings:          PortfolioHolding[];
}

export interface TransactionFilters {
  symbol?:   string;
  type?:     'Buy' | 'Sell' | 'Dividend' | 'Interest' | 'Transfer' | 'Other';
  dateFrom?: string;    // ISO "YYYY-MM-DD"
}

export interface PortfolioTransaction {
  id:               number;
  broker:           string;
  file_name:        string | null;
  import_date:      string;
  transaction_date: string | null;
  symbol:           string | null;
  type:             string | null;
  quantity:         number | null;
  price:            number | null;
  amount:           number | null;
  raw_data:         Record<string, string> | null;
  notes:            string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    throw new Error(`[portfolioService] ${resp.status} ${path}: ${body}`);
  }
  return resp.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all current holdings with average-cost data.
 * Each holding is enriched with live price + engine score where available.
 */
export async function getAllHoldings(): Promise<PortfolioHolding[]> {
  return apiFetch<PortfolioHolding[]>('/api/portfolio/holdings');
}

/**
 * Rebuild portfolio_holdings from every stored transaction.
 * The backend uses the weighted-average cost method.
 *
 * You rarely need to call this manually — the import endpoint already
 * triggers a recalculation for every affected symbol.
 */
export async function recalculateHoldings(): Promise<void> {
  await apiFetch<{ refreshed: number; symbols: string[] }>(
    '/api/portfolio/recalculate',
    { method: 'POST' },
  );
}

/**
 * Return a single-object summary of the entire portfolio:
 *   • totalValue          – current market value (falls back to cost when no price)
 *   • totalCost           – original cost basis
 *   • unrealizedPL        – gain / loss in dollars
 *   • unrealizedPLPercent – gain / loss as a percentage
 *   • cashBalance         – value of the synthetic CASH symbol
 *   • topHoldings         – up to 10 holdings ranked by market value
 */
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  return apiFetch<PortfolioSummary>('/api/portfolio/summary');
}

/**
 * Run fresh engine analysis on every active portfolio holding.
 * Uses the backend refresh pipeline (indicators + scores) without
 * touching news or global watchlist data.
 *
 * This can take 30–90 seconds depending on how many holdings you have.
 */
export async function refreshPortfolioSignals(): Promise<{
  refreshed_count: number;
  failed_count: number;
  refreshed: string[];
  failed: Array<{ symbol: string; reason: string }>;
}> {
  return apiFetch('/api/portfolio/refresh-signals', { method: 'POST' });
}

/**
 * Fetch raw transactions with optional filtering.
 *
 * @param filters.symbol   – show only rows for this ticker (case-insensitive)
 * @param filters.type     – 'Buy' | 'Sell' | 'Dividend' | 'Interest' | 'Transfer' | 'Other'
 * @param filters.dateFrom – earliest transaction date, ISO "YYYY-MM-DD"
 */
export async function getTransactions(
  filters?: TransactionFilters,
): Promise<PortfolioTransaction[]> {
  const params = new URLSearchParams();
  if (filters?.symbol)   params.set('symbol',    filters.symbol.toUpperCase());
  if (filters?.type)     params.set('type',       filters.type);
  if (filters?.dateFrom) params.set('date_from',  filters.dateFrom);

  const qs = params.toString();
  return apiFetch<PortfolioTransaction[]>(
    `/api/portfolio/transactions${qs ? '?' + qs : ''}`,
  );
}
