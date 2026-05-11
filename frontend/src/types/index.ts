export type SetupFactor = {
  key: string;
  label: string;
  score: number;
  weight: number;
  positive?: string;
  concern?: string;
};

export type SRZone = {
  zone_type: 'support' | 'resistance';
  price_low: number;
  price_high: number;
  strength_score: number;
  confluence_score: number;
  plain_english: string;
  sources: Array<{ method: string; label: string; weight: number; timeframe: string }>;
};

export type Card = {
  ticker_id: number;
  symbol: string;
  company?: string;
  theme: string;
  asset_type: string;
  price?: number;
  as_of?: string;
  support?: number;
  resistance?: number;
  pattern_signal?: string;
  distance_to_support?: number;
  distance_to_resistance?: number;
  score?: number;
  decision?: string;
  confidence?: string;
  risk?: string;
  trend_label?: string;
  momentum_label?: string;
  momentum_summary?: string;
  momentum_score?: number;
  rsi?: number;
  rsi_interpretation?: string;
  macd?: number;
  macd_signal?: number;
  macd_histogram?: number;
  macd_trend?: string;
  indicator_macd_trend?: string;
  momentum_divergence?: string;
  adx?: number;
  adx_interpretation?: string;
  trend_alignment?: string;
  trend_strength_score?: number;
  trend_strength_summary?: string;
  score_trend_strength_summary?: string;
  obv_trend?: string;
  volume_vs_20d?: number;
  rising_volume_on_up_days?: number;
  volume_confirmation?: string;
  volume_confirmation_summary?: string;
  score_volume_confirmation_summary?: string;
  volume_label?: string;
  news_label?: string;
  summary?: string;
  suggested_action?: string;
  entry_range?: string;
  invalidation_level?: string;
  target1?: string;
  target2?: string;
  distance_to_buy_zone?: number;
  buy_zone_confluence?: number;
  setup_factor_scores?: SetupFactor[];
  setup_positive_factors?: string[];
  setup_concern_factors?: string[];
  decision_reasons?: string[];
  risk_reward_summary?: string;
  improve_to_buy?: string;
  buy_zone_explanation?: string;
  target_zone_explanation?: string;
  fresh_high_targets?: boolean | number;
  fresh_high_target_note?: string;
  hold_window?: string;
  why_rating?: string;
  changes_view?: string;
  similar_setup_memory?: string;
  historical_accuracy_70_plus?: number | null;
  news_count?: number;
  positive_news_count?: number;
  negative_news_count?: number;
  latest_news_title?: string;
  latest_news_source?: string;
  latest_news_link?: string;
  nearest_support_zone?: SRZone | null;
  nearest_resistance_zone?: SRZone | null;
  // Week 3–4: New signal fields
  // Earnings Intelligence
  days_to_earnings?: number | null;
  earnings_score_modifier?: number;
  earnings_label?: string;
  earnings_summary?: string;
  // Sector Relative Strength
  sector_etf?: string | null;
  sector_rs_13w?: number | null;
  sector_rs_26w?: number | null;
  sector_rs_52w?: number | null;
  sector_rs_score_modifier?: number;
  sector_rs_label?: string;
  sector_rs_summary?: string;
  // Market Regime
  regime_label?: string;
  regime_vix?: number | null;
  regime_breadth_score?: number;
  regime_score_modifier?: number;
  regime_summary?: string;
  // Insider Transactions
  insider_buy_count?: number;
  insider_sell_count?: number;
  insider_net_value?: number;
  insider_score_modifier?: number;
  insider_label?: string;
  insider_summary?: string;
  // Fundamentals
  fundamentals_pe?: number | null;
  fundamentals_revenue_growth?: number | null;
  fundamentals_profit_margin?: number | null;
  fundamentals_debt_to_equity?: number | null;
  fundamentals_eps_growth?: number | null;
  fundamentals_score_modifier?: number;
  fundamentals_label?: string;
  fundamentals_summary?: string;
};

export type NewsItem = {
  id: number;
  source: string;
  feed_name: string;
  title: string;
  link: string;
  published_at?: string;
  summary?: string;
  sentiment: string;
  tickers?: string;
  match_reason?: string;
};

export type Watchlist = {
  id: number;
  name: string;
  theme: string;
  active: number;
  ticker_count: number;
  top_opportunities: number;
  wait_on: number;
  avoid: number;
  average_score?: number;
  theme_concentration: string;
  earnings_warnings: string;
  tickers?: Array<{ symbol: string; score?: number; decision?: string; theme: string }>;
};

export type Dashboard = {
  market: {
    label: string;
    explanation: string;
    last_refresh?: string;
    failed_count?: number;
    error?: string;
  };
  news: {
    last_refresh?: string;
    failed_count?: number;
    error?: string;
    latest: NewsItem[];
  };
  settings: { show_beginner_price_help: boolean; enable_portfolio_os: boolean };
  cards: Card[];
  watchlists: Watchlist[];
  disclaimer: string;
};

export type RecommendationSnapshot = {
  id: number;
  ticker: string;
  snapshot_date?: string;
  current_price: number;
  setup_quality: number;
  recommended_action: string;
  buy_zone_low?: number;
  buy_zone_high?: number;
  risk_line?: number;
  review_target1?: number;
  review_target2?: number;
  distance_to_buy_pct?: number;
  signal_summary?: Record<string, unknown>;
  full_signals?: Record<string, unknown>;
  user_action?: 'Bought' | 'Ignored' | 'Watched' | 'Sold' | null;
  user_action_date?: string | null;
  actual_outcome_pct?: number | null;
  hold_period_days?: number | null;
  notes?: string | null;
};

export type LearningInsights = {
  overallWinRate: number;
  avgReturn: number;
  highQualityWinRate: number;
  calibration: Array<{ predictedRange: string; actualSuccessRate: number }>;
  commonPatterns: string[];
  perTickerPerformance?: Array<{
    ticker: string;
    snapshots: number;
    bought: number;
    wins: number;
    winRate: number;
    avgReturn: number;
    highQualityWinRate: number;
  }>;
  recentSnapshots: RecommendationSnapshot[];
};

export type Page =
  | 'dashboard'
  | 'watchlists'
  | 'ticker'
  | 'research'
  | 'history'
  | 'learning'
  | 'learningInsights'
  | 'settings'
  | 'portfolio'
  | 'backtesting';

export type DashboardFilter =
  | 'all'
  | 'buy'
  | 'wait'
  | 'watch'
  | 'hold'
  | 'avoid'
  | 'close'
  | 'quality'
  | 'lower-risk'
  | 'news';

export type DashboardSort = 'score' | 'close' | 'quality' | 'risk' | 'ticker';
