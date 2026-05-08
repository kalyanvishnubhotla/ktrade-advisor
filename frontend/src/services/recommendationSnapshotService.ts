export interface RecommendationSnapshot {
  id?: number;
  ticker: string;
  current_price: number;
  setup_quality: number;
  recommended_action: string;
  buy_zone_low?: number;
  buy_zone_high?: number;
  risk_line?: number;
  review_target1?: number;
  review_target2?: number;
  distance_to_buy_pct: number;
  signal_summary: Record<string, any>;
  full_signals: Record<string, any>;
}

export type SnapshotUserAction = "Bought" | "Ignored" | "Watched" | "Sold";

export interface AccuracyMetrics {
  totalSnapshots: number;
  buyZoneHitRate: number;
  target1HitRate: number;
  riskLineBreachRate: number;
  averageReturnWhenBought: number;
  calibrationScore: number;
}

export interface LearningInsights {
  overallWinRate: number;
  avgReturn: number;
  highQualityWinRate: number;
  calibration: {
    predictedRange: string;
    actualSuccessRate: number;
  }[];
  commonPatterns: string[];
  recentSnapshots: RecommendationSnapshot[];
}

const API = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${url}`, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function saveSnapshot(ticker: string, analysisResult: any): Promise<void> {
  await request(`/api/snapshots/${encodeURIComponent(ticker.toUpperCase())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisResult })
  });
}

export async function getHistoryForTicker(ticker: string, limit = 50): Promise<RecommendationSnapshot[]> {
  return request(`/api/snapshots/${encodeURIComponent(ticker.toUpperCase())}?limit=${limit}`);
}

export async function getLatestSnapshot(ticker: string): Promise<RecommendationSnapshot | null> {
  return request(`/api/snapshots/${encodeURIComponent(ticker.toUpperCase())}/latest`);
}

export async function markUserAction(snapshotId: number, action: SnapshotUserAction, notes?: string): Promise<void> {
  await request(`/api/snapshots/${snapshotId}/action`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, notes })
  });
}

export async function recordOutcome(snapshotId: number, actualOutcomePct: number, holdPeriodDays?: number): Promise<void> {
  await request(`/api/snapshots/${snapshotId}/outcome`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actualOutcomePct, holdPeriodDays })
  });
}

export async function calculateAccuracyMetrics(ticker?: string): Promise<AccuracyMetrics> {
  const query = ticker ? `?ticker=${encodeURIComponent(ticker.toUpperCase())}` : '';
  return request(`/api/snapshots/metrics/accuracy${query}`);
}

export async function getLearningInsights(ticker?: string, daysBack = 90): Promise<LearningInsights> {
  const params = new URLSearchParams({ daysBack: String(daysBack) });
  if (ticker) params.set('ticker', ticker.toUpperCase());
  return request(`/api/snapshots/insights/learning?${params.toString()}`);
}
