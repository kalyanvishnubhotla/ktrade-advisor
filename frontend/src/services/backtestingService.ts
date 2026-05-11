/**
 * backtestingService.ts
 *
 * Typed client for the Backtesting & Accuracy module API.
 * Mirrors backend/app/backtesting.py + the endpoints in main.py.
 *
 * The module is opt-in: pages should not call these endpoints unless
 * settings.enable_backtesting_accuracy is true.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DecisionStatus = 'active' | 'closed' | 'archived';
export type ReliabilityBucket = 'green' | 'orange' | 'blue';
export type CloseReason =
  | 'target1_hit'
  | 'target2_hit'
  | 'risk_breached'
  | 'manual_close'
  | 'expired';

export interface TrackedDecision {
  id: number;
  snapshot_id: number;
  ticker: string;
  tracked_at: string;                 // ISO timestamp
  entry_price: number;
  buy_zone_low:  number | null;
  buy_zone_high: number | null;
  risk_line:     number | null;
  review_target1: number | null;
  review_target2: number | null;
  setup_quality: number;
  recommended_action: string | null;
  status: DecisionStatus;
  close_reason:  CloseReason | null;
  close_price:   number | null;
  closed_at:     string | null;
  realized_return_pct: number | null;
  hold_days:     number | null;
  notes: string | null;

  // Augmented fields from the evaluator
  latest_close:        number | null;
  current_return_pct:  number | null;
  days_since_tracked:  number;
  buy_zone_hit_date:   string | null;
  target1_hit_date:    string | null;
  target2_hit_date:    string | null;
  risk_breached_date:  string | null;
  max_high_to_date:    number | null;
  min_low_to_date:     number | null;
}

export interface PricePathPoint {
  date:   string;
  open:   number | null;
  high:   number | null;
  low:    number | null;
  close:  number | null;
  volume: number | null;
}

export interface DecisionDetail {
  decision:    TrackedDecision;
  price_path:  PricePathPoint[];
  snapshot_context: {
    signal_summary?: Record<string, unknown>;
    snapshot_date?:  string;
  };
}

export interface DashboardMetrics {
  totalTracked: number;
  active:       number;
  closed:       number;
  hitRate:            number | null;
  hitRateReliability: ReliabilityBucket;
  buyZoneHitRate:     number | null;
  buyZoneReliability: ReliabilityBucket;
  riskProtectionRate: number | null;
  winRate:            number | null;
  winRateReliability: ReliabilityBucket;
  avgWin:    number;
  avgLoss:   number;
  avgReturn: number;
  realizedRR:  number | null;
  expectancy:  number | null;
  targetHits:    number;
  riskBreaches:  number;
  perTicker: Array<{
    ticker:      string;
    closed:      number;
    winRate:     number;
    avgReturn:   number;
    reliability: ReliabilityBucket;
  }>;
  coachInsights: string[];
}

export interface CalibrationBucket {
  bucket:        string;
  description:   string;
  predictedRate: number;
  actualRate:    number | null;
  sampleSize:    number;
  reliability:   ReliabilityBucket;
}

export interface CalibrationCurve {
  buckets:          CalibrationBucket[];
  avgDriftPct:      number | null;
  calibrationScore: number | null;
  reliability:      ReliabilityBucket;
}

export interface EquityCurvePoint {
  date:          string;
  equity:        number;
  cumReturnPct:  number;
  ticker?:       string;
  closeReason?:  CloseReason | null;
  tradeReturn?:  number;
  mark_to_market?: boolean;
}

export interface EquityCurve {
  points:          EquityCurvePoint[];
  startingCapital: number;
  finalEquity:     number;
  totalReturnPct:  number;
  tradeCount?:     number;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const API_BASE = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    throw new Error(`[backtestingService] ${resp.status} ${path}: ${body}`);
  }
  return resp.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function trackDecision(snapshotId: number, notes?: string): Promise<TrackedDecision> {
  return apiFetch<TrackedDecision>('/api/backtesting/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot_id: snapshotId, notes }),
  });
}

export async function listDecisions(status?: DecisionStatus): Promise<TrackedDecision[]> {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<TrackedDecision[]>(`/api/backtesting/decisions${qs}`);
}

export async function getDecisionDetail(decisionId: number): Promise<DecisionDetail> {
  return apiFetch<DecisionDetail>(`/api/backtesting/decisions/${decisionId}`);
}

export async function closeDecision(
  decisionId: number,
  closePrice: number,
  notes?: string,
): Promise<TrackedDecision> {
  return apiFetch<TrackedDecision>(`/api/backtesting/decisions/${decisionId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ close_price: closePrice, notes }),
  });
}

export async function untrackDecision(decisionId: number): Promise<void> {
  await apiFetch(`/api/backtesting/decisions/${decisionId}`, { method: 'DELETE' });
}

export async function evaluateAllDecisions(): Promise<{ newlyClosed: number }> {
  return apiFetch<{ newlyClosed: number }>('/api/backtesting/evaluate-all', { method: 'POST' });
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  return apiFetch<DashboardMetrics>('/api/backtesting/dashboard');
}

export async function getCalibrationCurve(): Promise<CalibrationCurve> {
  return apiFetch<CalibrationCurve>('/api/backtesting/calibration');
}

export async function getEquityCurve(startingCapital = 1000): Promise<EquityCurve> {
  return apiFetch<EquityCurve>(`/api/backtesting/equity-curve?starting_capital=${startingCapital}`);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Translate a reliability bucket → calm CSS color variables and friendly labels.
 * Aligns with the rest of KTrade's soft palette.
 */
export function reliabilityColors(bucket: ReliabilityBucket): {
  bg: string; border: string; text: string; label: string; emoji: string;
} {
  switch (bucket) {
    case 'green':
      return {
        bg:     'var(--green-muted)',
        border: 'var(--green-dim)',
        text:   'var(--green-text)',
        label:  'Strongly reliable',
        emoji:  '✓',
      };
    case 'orange':
      return {
        bg:     'var(--gold-muted)',
        border: 'var(--gold-dim)',
        text:   'var(--gold-text)',
        label:  'Solid',
        emoji:  '◐',
      };
    case 'blue':
    default:
      return {
        bg:     'var(--bg-surface-3)',
        border: 'var(--border-subtle)',
        text:   'var(--text-secondary)',
        label:  'Early data',
        emoji:  '○',
      };
  }
}

/**
 * Translate a close_reason → a calm, beginner-friendly sentence.
 */
export function explainCloseReason(reason: CloseReason | null): string {
  switch (reason) {
    case 'target1_hit':
      return 'Reached the first review target — engine call worked out.';
    case 'target2_hit':
      return 'Reached the second review target — even better than the engine planned.';
    case 'risk_breached':
      return 'Price crossed below the risk line — the safety floor did its job.';
    case 'manual_close':
      return 'You closed this manually.';
    case 'expired':
      return 'Decision aged out without target or risk firing.';
    default:
      return 'Still playing out — no exit event yet.';
  }
}

/**
 * Format a percentage with a leading sign and color hint.
 */
export function formatReturnPct(value: number | null): { text: string; positive: boolean } {
  if (value == null) return { text: '—', positive: false };
  const positive = value > 0;
  const text = `${positive ? '+' : ''}${value.toFixed(2)}%`;
  return { text, positive };
}
