import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorType, createChart, LineSeries, LineStyle } from 'lightweight-charts';
import {
  Activity,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock,
  History,
  Info as InfoIcon,
  LineChart,
  ListPlus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Target,
  Trash2
} from 'lucide-react';
import './styles.css';

const API = '';

type Card = {
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
  hold_window?: string;
  why_rating?: string;
  changes_view?: string;
  news_count?: number;
  positive_news_count?: number;
  negative_news_count?: number;
  latest_news_title?: string;
  latest_news_source?: string;
  latest_news_link?: string;
  nearest_support_zone?: SRZone | null;
  nearest_resistance_zone?: SRZone | null;
};

type SetupFactor = {
  key: string;
  label: string;
  score: number;
  weight: number;
  positive?: string;
  concern?: string;
};

type Watchlist = {
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

type Dashboard = {
  market: { label: string; explanation: string; last_refresh?: string; failed_count?: number; error?: string };
  news: { last_refresh?: string; failed_count?: number; error?: string; latest: NewsItem[] };
  settings: { show_beginner_price_help: boolean };
  cards: Card[];
  watchlists: Watchlist[];
  disclaimer: string;
};

type Page = 'dashboard' | 'watchlists' | 'ticker' | 'research' | 'history' | 'learning' | 'settings';
type DashboardFilter = 'all' | 'buy' | 'wait' | 'hold' | 'avoid' | 'close' | 'quality' | 'lower-risk' | 'news';
type DashboardSort = 'score' | 'close' | 'quality' | 'risk' | 'ticker';

type NewsItem = {
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

type SRZone = {
  zone_type: 'support' | 'resistance';
  price_low: number;
  price_high: number;
  strength_score: number;
  confluence_score: number;
  plain_english: string;
  sources: Array<{ method: string; label: string; weight: number; timeframe: string }>;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(`${API}${url}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function sendJson<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function scoreClass(score?: number) {
  if (!score) return 'muted';
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 50) return 'mixed';
  return 'weak';
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string>('NVDA');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      setDashboard(await getJson<Dashboard>('/api/dashboard'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load app data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await sendJson('/api/refresh');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const cards = dashboard?.cards ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><LineChart size={22} /></div>
          <div>
            <h1>Ktrade Advisor</h1>
            <p>Local decision support</p>
          </div>
        </div>
        <nav>
          <NavButton page="dashboard" current={page} setPage={setPage} icon={<Activity />} label="Dashboard" />
          <NavButton page="watchlists" current={page} setPage={setPage} icon={<ListPlus />} label="Watchlists" />
          <NavButton page="ticker" current={page} setPage={setPage} icon={<Search />} label="Ticker Detail" />
          <NavButton page="research" current={page} setPage={setPage} icon={<BookOpen />} label="Research Signal" />
          <NavButton page="history" current={page} setPage={setPage} icon={<History />} label="History" />
          <NavButton page="learning" current={page} setPage={setPage} icon={<Target />} label="Learning" />
          <NavButton page="settings" current={page} setPage={setPage} icon={<Settings />} label="Settings" />
        </nav>
        <p className="disclaimer">Decision support only. Not financial advice.</p>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Market Today</p>
            <h2>{dashboard?.market.label ?? 'Loading...'}</h2>
            <p>{dashboard?.market.explanation ?? 'Checking local data.'}</p>
          </div>
          <button className="primary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </header>

        {error && <div className="alert"><ShieldAlert size={18} /> {error}</div>}
        {dashboard?.market.failed_count ? (
          <div className="alert">
            <ShieldAlert size={18} />
            Refresh could not update {dashboard.market.failed_count} ticker{dashboard.market.failed_count === 1 ? '' : 's'}. {dashboard.market.error || 'Check internet access and try again.'}
          </div>
        ) : null}
        {dashboard?.news.failed_count ? (
          <div className="alert">
            <ShieldAlert size={18} />
            News refresh could not update {dashboard.news.failed_count} feed{dashboard.news.failed_count === 1 ? '' : 's'}. {dashboard.news.error || 'Check internet access and try again.'}
          </div>
        ) : null}
        {loading && <div className="panel">Loading local dashboard...</div>}

        {!loading && page === 'dashboard' && dashboard && (
          <DashboardView cards={cards} watchlists={dashboard.watchlists} news={dashboard.news.latest} showHelp={dashboard.settings.show_beginner_price_help} onSelect={(symbol) => { setSelectedTicker(symbol); setPage('ticker'); }} />
        )}
        {!loading && page === 'watchlists' && <WatchlistsView reload={load} />}
        {!loading && page === 'ticker' && <TickerView symbol={selectedTicker} setSymbol={setSelectedTicker} />}
        {!loading && page === 'research' && <ResearchView />}
        {!loading && page === 'history' && <HistoryView />}
        {!loading && page === 'learning' && <LearningView />}
        {!loading && page === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function NavButton({ page, current, setPage, icon, label }: { page: Page; current: Page; setPage: (page: Page) => void; icon: React.ReactNode; label: string }) {
  return <button className={current === page ? 'nav active' : 'nav'} onClick={() => setPage(page)}>{icon}{label}</button>;
}

function DashboardView({ cards, watchlists, news, showHelp, onSelect }: { cards: Card[]; watchlists: Watchlist[]; news: NewsItem[]; showHelp: boolean; onSelect: (symbol: string) => void }) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [sort, setSort] = useState<DashboardSort>('score');
  const counts = {
    buy: cards.filter((c) => c.decision === 'Buy-worthy now').length,
    wait: cards.filter((c) => c.decision === 'Wait for better price').length,
    avoid: cards.filter((c) => c.decision === 'Avoid for now').length
  };
  const filteredCards = useMemo(() => {
    const riskRank: Record<string, number> = { Low: 1, Medium: 2, High: 3 };
    const filtered = cards.filter((card) => {
      if (filter === 'buy') return card.decision === 'Buy-worthy now';
      if (filter === 'wait') return card.decision === 'Wait for better price';
      if (filter === 'hold') return card.decision === 'Hold / no action';
      if (filter === 'avoid') return card.decision === 'Avoid for now';
      if (filter === 'close') return card.distance_to_buy_zone !== null && card.distance_to_buy_zone !== undefined && card.distance_to_buy_zone >= -2 && card.distance_to_buy_zone <= 5;
      if (filter === 'quality') return (card.buy_zone_confluence || 0) >= 70 || (card.score || 0) >= 70;
      if (filter === 'lower-risk') return card.risk === 'Low' || card.risk === 'Medium';
      if (filter === 'news') return (card.news_count || 0) > 0;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'close') return Math.abs(a.distance_to_buy_zone ?? 999) - Math.abs(b.distance_to_buy_zone ?? 999);
      if (sort === 'quality') return (b.buy_zone_confluence || 0) - (a.buy_zone_confluence || 0);
      if (sort === 'risk') return (riskRank[a.risk || 'High'] || 9) - (riskRank[b.risk || 'High'] || 9);
      if (sort === 'ticker') return a.symbol.localeCompare(b.symbol);
      return (b.score || 0) - (a.score || 0);
    });
  }, [cards, filter, sort]);
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Buy-worthy now" value={counts.buy} />
        <Metric label="Wait for better price" value={counts.wait} />
        <Metric label="Avoid for now" value={counts.avoid} />
        <Metric label="Active watchlists" value={watchlists.filter((w) => w.active).length} />
      </div>
      <div className="section-head">
        <div>
          <h3>Recommendations</h3>
          <p>All tickers, ranked by local score</p>
        </div>
        <div className="segmented" aria-label="Choose recommendation view">
          <button className={view === 'cards' ? 'selected' : ''} onClick={() => setView('cards')}>Cards</button>
          <button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
      <div className="help-strip">
        <span><b>Buy zone</b> is the price area where the setup looks more reasonable.</span>
        <span><b>Risk level</b> is the price that would weaken the setup.</span>
        <span><b>Targets</b> are review areas, not guarantees.</span>
      </div>
      <div className="filter-bar">
        <div className="filter-group">
          <span>Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as DashboardFilter)}>
            <option value="all">All tickers</option>
            <option value="buy">Buy-worthy now</option>
            <option value="wait">Wait for better price</option>
            <option value="hold">Hold / no action</option>
            <option value="avoid">Avoid for now</option>
            <option value="close">Close to buy area</option>
            <option value="quality">Strong setup quality</option>
            <option value="lower-risk">Low / medium risk</option>
            <option value="news">Has news signal</option>
          </select>
        </div>
        <div className="filter-group">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as DashboardSort)}>
            <option value="score">Highest score</option>
            <option value="close">Closest to buy area</option>
            <option value="quality">Best setup quality</option>
            <option value="risk">Lower risk first</option>
            <option value="ticker">Ticker A-Z</option>
          </select>
        </div>
        <span className="result-count">{filteredCards.length} of {cards.length} shown</span>
      </div>
      {view === 'cards' ? (
        <div className="card-grid">
          {filteredCards.map((card) => <TickerCard key={card.symbol} card={card} showHelp={showHelp} onSelect={onSelect} />)}
        </div>
      ) : (
        <RecommendationTable cards={filteredCards} onSelect={onSelect} />
      )}
      <div className="section-head"><h3>Free News Signals</h3><p>Headlines matched locally to your tickers</p></div>
      <NewsList items={news} compact />
      <div className="section-head"><h3>Watchlist Snapshot</h3><p>Simple health checks</p></div>
      <div className="watch-grid">
        {watchlists.slice(0, 6).map((watchlist) => <WatchlistSummary key={watchlist.id} watchlist={watchlist} />)}
      </div>
    </section>
  );
}

function RecommendationTable({ cards, onSelect }: { cards: Card[]; onSelect: (symbol: string) => void }) {
  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Decision</th>
            <th>Score</th>
            <th>Price</th>
              <th>Risk</th>
              <th>News</th>
              <th>Buy zone</th>
            <th>Review targets</th>
            <th>Plain-English read</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.symbol} onClick={() => onSelect(card.symbol)}>
              <td>
                <b>{card.symbol}</b>
                <span>{card.company || card.theme}</span>
              </td>
              <td>{card.decision || 'Refresh needed'}</td>
              <td><span className={`score-mini ${scoreClass(card.score)}`}>{card.score ?? '--'}</span></td>
              <td><span className="table-price">{card.price ? `$${card.price.toFixed(2)}` : '--'}</span></td>
              <td>{card.risk || '--'}</td>
              <td>{card.news_count ? `${card.news_count} headline${card.news_count === 1 ? '' : 's'}` : 'No match'}</td>
              <td>{card.entry_range || '--'}</td>
              <td>{card.target1 || '--'} / {card.target2 || '--'}</td>
              <td>{card.summary || 'Run a refresh to calculate this setup.'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HelpIcon({ text }: { text: string }) {
  return (
    <span className="info-wrap" tabIndex={0} aria-label={text} onClick={(event) => event.stopPropagation()}>
      <InfoIcon size={14} />
      <span className="tooltip">{text}</span>
    </span>
  );
}

function PriceLine({ label, value, help, showHelp }: { label: string; value: string; help: string; showHelp: boolean }) {
  return (
    <span>
      {label}: {value}
      {showHelp && <HelpIcon text={help} />}
    </span>
  );
}

function technicalSourceToPlain(label: string) {
  return label
    .replace(/daily swing low/gi, 'recent buyer area')
    .replace(/weekly swing low/gi, 'major buyer area')
    .replace(/daily swing high/gi, 'recent hesitation area')
    .replace(/weekly swing high/gi, 'major hesitation area')
    .replace(/Golden Zone/gi, 'value area')
    .replace(/50-day moving average/gi, '50-day average')
    .replace(/200-day moving average/gi, '200-day average')
    .replace(/Fib/gi, 'price retracement');
}

function plainZoneReason(card: Card) {
  const supportSources = card.nearest_support_zone?.sources ?? [];
  const labels = supportSources
    .map((source) => technicalSourceToPlain(source.label))
    .filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels)).slice(0, 3);
  if (uniqueLabels.length) return `This area is based on ${uniqueLabels.join(' + ')}.`;
  if (card.buy_zone_explanation) return technicalSourceToPlain(card.buy_zone_explanation);
  return 'This area is based on recent price behavior and longer-term averages.';
}

function decisionNudge(card: Card) {
  const distance = card.distance_to_buy_zone;
  if (distance === null || distance === undefined) return card.summary || 'Run a refresh to calculate this setup.';
  if (distance > 8) {
    return `Price is ${distance.toFixed(1)}% above the preferred buy area, so patience may reduce risk.`;
  }
  if (distance > 3) {
    return `Price is ${distance.toFixed(1)}% above the preferred buy area. It is close enough to watch, but not an urgent buy.`;
  }
  if (distance >= -2) {
    return 'Price is near the preferred buy area. Review the score, risk, and your portfolio fit before acting.';
  }
  return 'Price is below the preferred buy area. That can mean a discount, but also check whether the setup is weakening.';
}

function plainFactor(text?: string) {
  if (!text) return '';
  return text
    .replace(/Momentum is supportive: RSI [\d.]+, Bullish/gi, 'Momentum is supportive')
    .replace(/RSI [\d.]+ is bullish; MACD is supportive\./gi, 'Buying pressure is positive.')
    .replace(/RSI cools below \d+/gi, 'momentum cools')
    .replace(/Trend is acceptable: Daily & weekly aligned/gi, 'Short-term and longer-term trends agree')
    .replace(/Daily & weekly aligned/gi, 'short-term and longer-term trends agree')
    .replace(/Weak trend \([\d.]+ ADX\)/gi, 'Trend is not forceful yet')
    .replace(/Strong trend \([\d.]+ ADX\)/gi, 'Trend has strong follow-through')
    .replace(/Very strong trend \([\d.]+ ADX\)/gi, 'Trend has very strong follow-through')
    .replace(/Bollinger range is wide at [\d.]+%/gi, 'Price is moving in a wide range')
    .replace(/Quiet \([\d.]+x 20-day average, not clearly rising on up days\)\./gi, 'Volume is quiet, so buying interest is not loud yet.')
    .replace(/Constructive \([\d.]+x 20-day average, rising on up days\)\./gi, 'Volume is constructive.')
    .replace(/Supportive \([\d.]+x 20-day average, rising on up days\)\./gi, 'Volume supports the move.')
    .replace(/preferred buy area/g, 'preferred buy area');
}

function signalTone(label?: string) {
  const value = (label || '').toLowerCase();
  if (['strong', 'good', 'supportive', 'constructive', 'low'].some((word) => value.includes(word))) return 'green';
  if (['mixed', 'neutral', 'medium', 'developing'].some((word) => value.includes(word))) return 'yellow';
  if (['weak', 'high', 'falling', 'quiet'].some((word) => value.includes(word))) return 'red';
  return 'yellow';
}

function SignalHealthGrid({ card }: { card: Card }) {
  const signals = [
    { label: 'Trend', value: card.trend_label || '--' },
    { label: 'Momentum', value: card.momentum_label || '--' },
    { label: 'Volume', value: card.volume_label || '--' },
    { label: 'Risk', value: card.risk || '--' }
  ];
  return (
    <div className="signal-health-grid">
      {signals.map((signal) => (
        <span className={`signal-pill ${signalTone(signal.value)}`} key={signal.label}>
          <i aria-hidden="true" />
          <b>{signal.label}</b>
          {signal.value}
        </span>
      ))}
    </div>
  );
}

function TickerCard({ card, showHelp, onSelect }: { card: Card; showHelp: boolean; onSelect: (symbol: string) => void }) {
  return (
    <article className="ticker-card" onClick={() => onSelect(card.symbol)}>
      <div className="ticker-top">
        <div>
          <h3>{card.symbol}</h3>
          <p>{card.company || card.theme}</p>
        </div>
        <div className={`score ${scoreClass(card.score)}`}>{card.score ?? '--'}</div>
      </div>
      <div className="decision">{card.decision || 'Refresh needed'}</div>
      <p className="summary">{decisionNudge(card)}</p>
      <div className="facts">
        <span className="price-chip">Current price <b>{card.price ? `$${card.price.toFixed(2)}` : '--'}</b></span>
        <span>Confidence <b>{card.confidence || '--'}</b></span>
        <span>News <b>{card.news_count || 0}</b></span>
        {card.buy_zone_confluence ? (
          <span>
            Setup quality <b>{Math.round(card.buy_zone_confluence)}/100</b>
            {showHelp && <HelpIcon text="Weighted checklist score: price zones 30%, trend 25%, momentum 20%, volume 15%, volatility 10%. Higher is cleaner, not guaranteed." />}
          </span>
        ) : null}
      </div>
      {card.latest_news_title && (
        <a className="news-teaser" href={card.latest_news_link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          {card.latest_news_source}: {card.latest_news_title}
        </a>
      )}
      <SignalHealthGrid card={card} />
      <div className="decision-plan">
        <div className="plan-row">
          <span className="plan-label">
            Preferred buy area
            {showHelp && <HelpIcon text="A calmer price area to consider a new buy. It is not a command to buy." />}
          </span>
          <span className="plan-value">{card.entry_range || '--'}</span>
        </div>
        <div className="plan-row">
          <span className="plan-label">
            Review area
            {showHelp && <HelpIcon text="A price area to reassess. It is not an automatic sell point and not a guarantee." />}
          </span>
          <span className="plan-value">{card.target1 || '--'} / {card.target2 || '--'}</span>
        </div>
        <div className="plan-row">
          <span className="plan-label">
            Risk line
            {showHelp && <HelpIcon text="If price falls below this area and stays weak, the setup may be breaking down." />}
          </span>
          <span className="plan-value">{card.invalidation_level || '--'}</span>
        </div>
      </div>
      <div className="card-scan">
        <span><b>Best point:</b> {plainFactor((card.decision_reasons || card.setup_positive_factors || [])[0]) || 'Setup has enough evidence to review.'}</span>
        {(card.setup_concern_factors || [])[0] && <span><b>Watch:</b> {plainFactor(card.setup_concern_factors?.[0])}</span>}
        <span className="open-detail">Click for the full checklist and learning details</span>
      </div>
    </article>
  );
}

function NewsList({ items, compact = false, ticker, onApplied }: { items: NewsItem[]; compact?: boolean; ticker?: string; onApplied?: () => void }) {
  if (!items.length) {
    return <div className="panel compact">No RSS headlines stored yet. Run Refresh to pull free news feeds.</div>;
  }
  return (
    <div className={compact ? 'news-grid compact-news' : 'news-grid'}>
      {items.map((item) => (
        <article className="news-item" key={item.id}>
          <div className="row">
            <span className={`sentiment ${item.sentiment.toLowerCase()}`}>{item.sentiment}</span>
            <span>{item.source}</span>
          </div>
          <h4>{item.title}</h4>
          {item.tickers && <p>Matched: {item.tickers}</p>}
          {item.match_reason && <p>Why matched: {item.match_reason}</p>}
          <div className="news-actions">
            <a href={item.link} target="_blank" rel="noreferrer">Open source</a>
            {ticker && (
              <button onClick={async () => {
                await sendJson(`/api/news/${item.id}/apply`, { ticker, confidence: 'Medium' });
                alert('Applied as a research signal. Press Refresh to recalculate the score.');
                onApplied?.();
              }}>Consider in score</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function WatchlistSummary({ watchlist }: { watchlist: Watchlist }) {
  return (
    <article className="panel compact">
      <div className="row">
        <h3>{watchlist.name}</h3>
        <span className={watchlist.active ? 'pill active-pill' : 'pill'}>{watchlist.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="facts">
        <span>Tickers <b>{watchlist.ticker_count}</b></span>
        <span>Average <b>{watchlist.average_score ?? '--'}</b></span>
        <span>Top <b>{watchlist.top_opportunities}</b></span>
      </div>
      <p>Theme concentration: {watchlist.theme_concentration}</p>
      <p>Wait: {watchlist.wait_on} · Avoid: {watchlist.avoid}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><p>{label}</p><strong>{value}</strong></div>;
}

function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'string') return value.startsWith('$') ? value : value;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value?: number | null, digits = 2) {
  if (value === null || value === undefined) return '--';
  return value.toFixed(digits);
}

function parseMoneyValue(value?: string | number | null) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const match = value.match(/-?\$?([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

function parseMoneyRange(value?: string | null) {
  if (!value) return undefined;
  const matches = [...value.matchAll(/-?\$?([\d,]+(?:\.\d+)?)/g)].map((match) => Number(match[1].replace(/,/g, '')));
  if (matches.length < 2) return undefined;
  return { low: Math.min(matches[0], matches[1]), high: Math.max(matches[0], matches[1]) };
}

function DetailStat({ label, value, tone }: { label: string; value?: React.ReactNode; tone?: string }) {
  return (
    <div className={tone ? `detail-stat ${tone}` : 'detail-stat'}>
      <span>{label}</span>
      <b>{value || '--'}</b>
    </div>
  );
}

function ZoneList({ zones }: { zones: SRZone[] }) {
  if (!zones?.length) return <p>No support/resistance zones cached yet. Run Refresh after adding the ticker.</p>;
  return (
    <div className="zone-list">
      {zones.slice(0, 6).map((zone, index) => (
        <div className="zone-row" key={`${zone.zone_type}-${zone.price_low}-${index}`}>
          <div>
            <b>{zone.zone_type === 'support' ? 'Buyer area' : 'Review area'}</b>
            <span>{formatMoney(zone.price_low)} - {formatMoney(zone.price_high)}</span>
          </div>
          <span className="score-mini good">{Math.round(zone.confluence_score)}</span>
        </div>
      ))}
    </div>
  );
}

function PriceChart({
  prices,
  score,
  indicators
}: {
  prices: Array<{ date: string; close: number; volume?: number }>;
  score: any;
  indicators: any;
}) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const buyRange = parseMoneyRange(score?.entry_range);
  const riskLine = parseMoneyValue(score?.invalidation_level);
  const target1 = parseMoneyValue(score?.target1);
  const target2 = parseMoneyValue(score?.target2);
  const currentPrice = indicators?.price;
  const firstTarget = target1 && currentPrice && target1 > currentPrice ? target1 : undefined;
  const secondTarget = target2 && currentPrice && target2 > currentPrice && target2 !== firstTarget ? target2 : undefined;
  const chartData = useMemo(
    () => prices
      .filter((item) => item.date && typeof item.close === 'number')
      .map((item) => ({ time: item.date, value: Number(item.close) })),
    [prices]
  );

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartData.length) return;

    container.replaceChildren();
    const chart = createChart(container, {
      height: 430,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#52615b',
        fontFamily: 'Inter, system-ui, sans-serif'
      },
      grid: {
        vertLines: { color: '#f1f4f2' },
        horzLines: { color: '#e7ece9' }
      },
      rightPriceScale: {
        borderColor: '#d8e1dc',
        scaleMargins: { top: 0.12, bottom: 0.16 }
      },
      timeScale: {
        borderColor: '#d8e1dc',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 7
      },
      crosshair: {
        mode: 1,
        horzLine: { labelVisible: true },
        vertLine: { labelVisible: true }
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });

    const priceSeries = chart.addSeries(LineSeries, {
      color: '#172126',
      lineWidth: 3,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5
    });
    priceSeries.setData(chartData as any);

    if (buyRange) {
      priceSeries.createPriceLine({
        price: buyRange.high,
        color: '#167540',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `Buy high $${buyRange.high.toFixed(2)}`
      });
      priceSeries.createPriceLine({
        price: buyRange.low,
        color: '#167540',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `Buy low $${buyRange.low.toFixed(2)}`
      });
    }
    if (currentPrice) {
      priceSeries.createPriceLine({
        price: currentPrice,
        color: '#246bfe',
        lineWidth: 3,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `Current $${currentPrice.toFixed(2)}`
      });
    }
    if (riskLine) {
      priceSeries.createPriceLine({
        price: riskLine,
        color: '#a93624',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Risk $${riskLine.toFixed(2)}`
      });
    }
    if (firstTarget) {
      priceSeries.createPriceLine({
        price: firstTarget,
        color: '#915d05',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Review 1 $${firstTarget.toFixed(2)}`
      });
    }
    if (secondTarget) {
      priceSeries.createPriceLine({
        price: secondTarget,
        color: '#915d05',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: `Review 2 $${secondTarget.toFixed(2)}`
      });
    }

    chart.timeScale().fitContent();
    const tooltip = tooltipRef.current;
    chart.subscribeCrosshairMove((param) => {
      if (!tooltip || !param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
        if (tooltip) tooltip.style.display = 'none';
        return;
      }
      const data = param.seriesData.get(priceSeries) as { value?: number } | undefined;
      if (!data?.value) {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(param.point.x + 14, container.clientWidth - 170)}px`;
      tooltip.style.top = `${Math.max(param.point.y - 48, 8)}px`;
      tooltip.innerHTML = `<b>${String(param.time)}</b><span>$${data.value.toFixed(2)}</span>`;
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    (container as any).__ktradeChart = chart;
    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartData, buyRange?.high, buyRange?.low, currentPrice, riskLine, firstTarget, secondTarget]);

  const setRange = (bars: number | 'all') => {
    const chart = (chartContainerRef.current as any)?.__ktradeChart;
    if (!chart || !chartData.length) return;
    if (bars === 'all') {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, chartData.length - bars),
      to: chartData.length + 8
    });
  };

  return (
    <article className="chart-panel rich-chart">
      <div className="chart-head">
        <div>
          <h3>Interactive Price Map</h3>
          <p>Scroll to zoom, drag to pan, and read the key prices on the right axis.</p>
        </div>
        <div className="chart-controls">
          <button onClick={() => setRange(65)}>3M</button>
          <button onClick={() => setRange(130)}>6M</button>
          <button onClick={() => setRange(260)}>1Y</button>
          <button onClick={() => setRange('all')}>All</button>
        </div>
      </div>
      <div className="tv-chart-shell">
        <div className="tv-chart" ref={chartContainerRef} />
        <div className="tv-tooltip" ref={tooltipRef} />
      </div>
      <div className="chart-legend">
        <span><i className="legend-current" />Current price line</span>
        <span><i className="legend-buy" />Buy low / buy high</span>
        <span><i className="legend-risk" />Risk line</span>
        <span><i className="legend-review" />Review targets</span>
      </div>
      <div className="chart-read">
        <span><b>Decision read:</b> {decisionNudge({ ...score, price: currentPrice } as Card)}</span>
        {buyRange && <span><b>Buy area:</b> Use the green price labels on the right as the lower and upper edges of the calmer buy area.</span>}
        {riskLine && <span><b>Risk:</b> A weak move below the red price label would damage the setup.</span>}
      </div>
    </article>
  );
}

function WatchlistsView({ reload }: { reload: () => Promise<void> }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');
  const [tickerInputs, setTickerInputs] = useState<Record<number, string>>({});
  const [edits, setEdits] = useState<Record<number, { name: string; theme: string; active: boolean }>>({});

  const load = async () => {
    const lists = await getJson<Watchlist[]>('/api/watchlists');
    setWatchlists(lists);
    setEdits(Object.fromEntries(lists.map((list) => [list.id, { name: list.name, theme: list.theme, active: Boolean(list.active) }])));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await sendJson('/api/watchlists', { name, theme: theme || name, active: true });
    setName('');
    setTheme('');
    await load();
    await reload();
  };

  const addTicker = async (id: number, listTheme: string) => {
    const symbol = tickerInputs[id]?.trim();
    if (!symbol) return;
    await sendJson(`/api/watchlists/${id}/tickers`, { symbol, theme: listTheme });
    setTickerInputs({ ...tickerInputs, [id]: '' });
    await load();
  };

  const saveList = async (id: number) => {
    const edit = edits[id];
    if (!edit?.name.trim()) return;
    await sendJson(`/api/watchlists/${id}`, edit, 'PATCH');
    await load();
    await reload();
  };

  return (
    <section className="stack">
      <div className="form-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New watchlist name" />
        <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Theme" />
        <button className="primary" onClick={create}><ListPlus size={18} />Create</button>
      </div>
      <div className="watch-grid wide">
        {watchlists.map((list) => (
          <article className="panel" key={list.id}>
            <div className="row">
              <div><h3>{list.name}</h3><p>{list.theme} · {list.ticker_count} tickers</p></div>
              <button className="ghost" onClick={async () => { await sendJson(`/api/watchlists/${list.id}/duplicate`); await load(); }}>Duplicate</button>
            </div>
            <div className="form-row nested">
              <input value={edits[list.id]?.name || ''} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], name: e.target.value } })} placeholder="Name" />
              <input value={edits[list.id]?.theme || ''} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], theme: e.target.value } })} placeholder="Theme" />
              <label className="toggle">
                <input type="checkbox" checked={Boolean(edits[list.id]?.active)} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], active: e.target.checked } })} />
                Active
              </label>
              <button onClick={() => saveList(list.id)}>Save</button>
            </div>
            <div className="facts">
              <span>Top <b>{list.top_opportunities}</b></span>
              <span>Wait <b>{list.wait_on}</b></span>
              <span>Avoid <b>{list.avoid}</b></span>
              <span>Average <b>{list.average_score ?? '--'}</b></span>
            </div>
            <div className="ticker-chips">
              {(list.tickers || []).map((ticker) => (
                <span className="chip" key={ticker.symbol}>
                  {ticker.symbol}
                  <button title="Remove ticker" onClick={async () => { await fetch(`/api/watchlists/${list.id}/tickers/${ticker.symbol}`, { method: 'DELETE' }); await load(); }}>
                    <Trash2 size={13} />
                  </button>
                </span>
              ))}
            </div>
            <div className="form-row nested">
              <input value={tickerInputs[list.id] || ''} onChange={(e) => setTickerInputs({ ...tickerInputs, [list.id]: e.target.value })} placeholder="Add ticker" />
              <button onClick={() => addTicker(list.id, list.theme)}>Add</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TickerView({ symbol, setSymbol }: { symbol: string; setSymbol: (symbol: string) => void }) {
  const [query, setQuery] = useState(symbol);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');

  const load = async (target = symbol) => {
    setError('');
    try {
      setDetail(await getJson(`/api/tickers/${target}`));
    } catch {
      setError('Ticker is not in a watchlist yet. Add it first, then refresh.');
      setDetail(null);
    }
  };

  useEffect(() => { load(symbol); }, [symbol]);
  const score = detail?.scores?.[0];
  const indicators = detail?.indicators;
  const zones = (detail?.sr_zones || []) as SRZone[];
  const buyerZones = zones.filter((zone) => zone.zone_type === 'support');
  const reviewZones = zones.filter((zone) => zone.zone_type === 'resistance');

  return (
    <section className="stack">
      <div className="form-row">
        <input value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} placeholder="Ticker" />
        <button className="primary" onClick={() => { setSymbol(query); load(query); }}><Search size={18} />Open</button>
      </div>
      {error && <div className="alert"><ShieldAlert size={18} />{error}</div>}
      {detail && (
        <>
          <div className="detail-hero">
            <div>
              <p className="eyebrow">{detail.ticker.theme}</p>
              <h2>{detail.ticker.symbol} {detail.ticker.company ? `· ${detail.ticker.company}` : ''}</h2>
              <p>{decisionNudge({ ...score, price: indicators?.price } as Card)}</p>
            </div>
            <div className={`score large ${scoreClass(score?.score)}`}>{score?.score ?? '--'}</div>
          </div>
          <div className="detail-grid">
            <article className="panel compact">
              <div className="row">
                <h3>Decision Plan</h3>
                <span className="pill">{score?.decision || 'Refresh needed'}</span>
              </div>
              <div className="detail-stat-grid">
                <DetailStat label="Current price" value={formatMoney(indicators?.price)} tone="price" />
                <DetailStat label="Preferred buy area" value={score?.entry_range} />
                <DetailStat label="Review area" value={`${score?.target1 || '--'} / ${score?.target2 || '--'}`} />
                <DetailStat label="Risk line" value={score?.invalidation_level} />
                <DetailStat label="Distance to buy area" value={score?.distance_to_buy_zone !== null && score?.distance_to_buy_zone !== undefined ? `${score.distance_to_buy_zone.toFixed(1)}%` : '--'} />
                <DetailStat label="Setup quality" value={score?.buy_zone_confluence ? `${Math.round(score.buy_zone_confluence)}/100` : '--'} />
              </div>
            </article>
            <article className="panel compact">
              <h3>Signal Health</h3>
              <SignalHealthGrid card={{ ...score, risk: score?.risk } as Card} />
              <div className="detail-stat-grid">
                <DetailStat label="Trend" value={score?.trend_strength_summary || indicators?.trend_strength_summary || score?.trend_label} />
                <DetailStat label="Momentum" value={score?.momentum_label} />
                <DetailStat label="Momentum read" value={score?.momentum_summary || indicators?.momentum_summary} />
                <DetailStat label="Volume" value={score?.volume_confirmation_summary || indicators?.volume_confirmation_summary || score?.volume_label} />
                <DetailStat label="News / research" value={score?.news_label} />
                <DetailStat label="Risk" value={score?.risk} />
                <DetailStat label="Confidence" value={score?.confidence} />
              </div>
            </article>
            <article className="panel compact">
              <h3>Why This Action</h3>
              <p>{decisionNudge({ ...score, price: indicators?.price } as Card)}</p>
              <div className="factor-list positive">
                <b>Top 3 reasons</b>
                {((score?.decision_reasons || score?.setup_positive_factors || []) as string[]).slice(0, 3).map((factor) => (
                  <span key={factor}>{plainFactor(factor)}</span>
                ))}
              </div>
              {(score?.setup_concern_factors || []).length ? (
                <div className="factor-list concern">
                  <b>Concerns</b>
                  {((score?.setup_concern_factors || []) as string[]).slice(0, 2).map((factor) => (
                    <span key={factor}>{plainFactor(factor)}</span>
                  ))}
                </div>
              ) : null}
            </article>
            <article className="panel compact">
              <h3>Setup Checklist</h3>
              <div className="checklist-bars">
                {((score?.setup_factor_scores || []) as SetupFactor[]).map((factor) => (
                  <div className="checklist-row" key={factor.key}>
                    <div className="row">
                      <span>{factor.label}</span>
                      <b>{Math.round(factor.score)}/100</b>
                    </div>
                    <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }} /></div>
                  </div>
                ))}
                {!(score?.setup_factor_scores || []).length && <p>Refresh this ticker to calculate checklist factors.</p>}
              </div>
            </article>
          </div>
          <PriceChart prices={detail.prices} score={score} indicators={indicators} />
          <div className="detail-grid">
            <article className="panel compact">
              <h3>Key Price Areas</h3>
              <div className="detail-stat-grid">
                <DetailStat label="Pivot support" value={formatMoney(indicators?.support)} />
                <DetailStat label="Pivot resistance" value={formatMoney(indicators?.resistance)} />
                <DetailStat label="50-day average" value={formatMoney(indicators?.ma50)} />
                <DetailStat label="200-day average" value={formatMoney(indicators?.ma200)} />
                <DetailStat label="ATR risk buffer" value={formatMoney(indicators?.atr)} />
                <DetailStat label="Relative strength vs SPY" value={formatNumber(indicators?.relative_strength, 3)} />
              </div>
            </article>
            <article className="panel compact">
              <h3>Buyer Areas</h3>
              <ZoneList zones={buyerZones} />
            </article>
            <article className="panel compact">
              <h3>Review Areas</h3>
              <ZoneList zones={reviewZones} />
            </article>
            <article className="panel compact">
              <h3>Recent Signals</h3>
              <div className="detail-stat-grid">
                <DetailStat label="RSI" value={formatNumber(indicators?.rsi, 1)} />
                <DetailStat label="RSI read" value={indicators?.rsi_interpretation} />
                <DetailStat label="ADX trend strength" value={indicators?.adx ? `${formatNumber(indicators.adx, 1)} · ${indicators.adx_interpretation}` : '--'} />
                <DetailStat label="Daily / weekly trend" value={indicators?.trend_alignment} />
                <DetailStat label="MACD" value={formatNumber(indicators?.macd, 2)} />
                <DetailStat label="MACD signal" value={formatNumber(indicators?.macd_signal, 2)} />
                <DetailStat label="MACD histogram" value={formatNumber(indicators?.macd_histogram, 2)} />
                <DetailStat label="MACD trend" value={indicators?.macd_trend || score?.macd_trend} />
                <DetailStat label="Divergence" value={indicators?.momentum_divergence || 'None detected'} />
                <DetailStat label="Volume vs 20-day avg" value={indicators?.volume_vs_20d ? `${formatNumber(indicators.volume_vs_20d, 2)}x` : '--'} />
                <DetailStat label="OBV trend" value={indicators?.obv_trend} />
                <DetailStat label="Up-day volume" value={indicators?.rising_volume_on_up_days ? 'Rising on advances' : 'Not clearly rising'} />
                <DetailStat label="Pattern" value={indicators?.pattern_signal} />
                <DetailStat label="Data date" value={indicators?.as_of} />
              </div>
            </article>
          </div>
          <div className="info-grid">
            <Info title="Suggested action" body={score?.suggested_action} />
            <Info title="Why this rating" body={score?.why_rating} />
            <Info title="Risk / reward at buy area" body={score?.risk_reward_summary} />
            <Info title="What would improve this" body={plainFactor(score?.improve_to_buy)} />
            <Info title="What changes the view" body={score?.changes_view} />
            <Info title="Hold window" body={score?.hold_window} />
          </div>
          <div className="detail-grid">
            <article className="panel compact">
              <h3>Recommendation Memory</h3>
              <div className="mini-table">
                {(detail.recommendations || []).slice(0, 5).map((item: any) => (
                  <div className="mini-row" key={item.id}>
                    <b>{item.decision}</b>
                    <span>{formatMoney(item.price)} · score {item.score}</span>
                    <span>{item.created_at?.slice(0, 10)}</span>
                  </div>
                ))}
                {!(detail.recommendations || []).length && <p>No recommendation history yet.</p>}
              </div>
            </article>
            <article className="panel compact">
              <h3>Research Signals</h3>
              <div className="mini-table">
                {(detail.research || []).slice(0, 5).map((item: any) => (
                  <div className="mini-row" key={item.id}>
                    <b>{item.sentiment || 'Signal'} · {item.confidence || 'Confidence --'}</b>
                    <span>{item.catalyst_type || item.suggested_impact || 'Research note'}</span>
                    <span>{item.source_date || item.created_at?.slice(0, 10)}</span>
                  </div>
                ))}
                {!(detail.research || []).length && <p>No pasted research signals yet.</p>}
              </div>
            </article>
          </div>
          <div className="section-head"><h3>Matched RSS Headlines</h3><p>Free sources, local matching only</p></div>
          <NewsList items={detail.news || []} ticker={detail.ticker.symbol} onApplied={() => load(detail.ticker.symbol)} />
        </>
      )}
    </section>
  );
}

function Info({ title, body }: { title: string; body?: string }) {
  return <article className="panel compact"><h3>{title}</h3><p>{body || '--'}</p></article>;
}

function ResearchView() {
  const template = `Ticker:
Company:
Date:
Source Links:

Research Summary:

Bullish Signals:
-

Bearish Signals:
-

Catalyst Type:

Time Sensitivity:
Low / Medium / High

Sentiment:
Positive / Neutral / Negative / Mixed

Confidence:
Low / Medium / High

Suggested App Impact:
Increase / Decrease / Keep / Caution

Reason:`;
  const [text, setText] = useState(template);
  const [result, setResult] = useState<any>(null);
  const [tickerDetail, setTickerDetail] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parse = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const parsedResult = await sendJson<any>('/api/research/parse', { text, approved: false, apply_impact: false });
      setResult(parsedResult);
      setStatus(`Saved ${parsedResult.parsed.ticker} research locally. Review the parsed signal below before applying it to the score.`);
      if (parsedResult.parsed?.ticker) {
        setTickerDetail(await getJson(`/api/tickers/${parsedResult.parsed.ticker}`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse this signal. Check that it includes a Ticker field.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async (applyImpact: boolean) => {
    if (!result?.id) return;
    setBusy(true);
    setError('');
    try {
      await sendJson(`/api/research/${result.id}/approval`, { approved: true, apply_impact: applyImpact }, 'PATCH');
      if (applyImpact) {
        setStatus('Impact approved. Refreshing scores now...');
        await sendJson('/api/refresh');
        setStatus(`${result.parsed.ticker} score refreshed with this research signal included.`);
        setTickerDetail(await getJson(`/api/tickers/${result.parsed.ticker}`));
      } else {
        setStatus('Saved for reference only. This signal will not affect the score.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this signal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <div className="section-head"><h3>Paste Research Signal</h3><p>Use this after ChatGPT extracts signals from an article, video, earnings note, or transcript.</p></div>
      <div className="help-strip">
        <span><b>Step 1</b> Paste the source link into ChatGPT and ask it to fill this format.</span>
        <span><b>Step 2</b> Paste the structured signal here.</span>
        <span><b>Step 3</b> Approve impact only if you agree it should affect the score.</span>
      </div>
      {status && <div className="success"><CheckCircle2 size={18} />{status}</div>}
      {error && <div className="alert"><ShieldAlert size={18} />{error}</div>}
      <div className="research-actions">
        <button className="primary" onClick={parse} disabled={busy || !text.trim()}><CheckCircle2 size={18} />{busy ? 'Working...' : 'Parse signal'}</button>
        <button onClick={() => { setText(template); setResult(null); setStatus(''); setError(''); }}>Reset template</button>
      </div>
      <textarea className="research-input" value={text} onChange={(e) => setText(e.target.value)} />
      {result && (
        <article className="panel parsed-panel">
          <div className="row">
            <div>
              <p className="eyebrow">Parsed Signal</p>
              <h3>{result.parsed.ticker} · {result.parsed.company || 'Company not provided'}</h3>
            </div>
            <span className={`sentiment ${(result.parsed.sentiment || 'neutral').toLowerCase()}`}>{result.parsed.sentiment || 'Neutral'}</span>
          </div>
          <div className="facts">
            <span>Date <b>{result.parsed.date || '--'}</b></span>
            <span>Confidence <b>{result.parsed.confidence || '--'}</b></span>
            <span>Suggested impact <b>{result.parsed.suggested_impact || '--'}</b></span>
            <span>Time sensitivity <b>{result.parsed.time_sensitivity || '--'}</b></span>
          </div>
          <p className="summary">{result.parsed.summary || 'No research summary provided.'}</p>
          <div className="signal-columns">
            <div>
              <h4>Bullish</h4>
              <p>{result.parsed.bullish || '--'}</p>
            </div>
            <div>
              <h4>Bearish</h4>
              <p>{result.parsed.bearish || '--'}</p>
            </div>
          </div>
          <div className="review-box">
            <b>Human check</b>
            <p>Saving keeps this as a note. Approving impact lets it affect the News/Research score after refresh.</p>
          </div>
          <div className="research-actions">
            <button onClick={() => approve(false)} disabled={busy}>Save only</button>
            <button className="primary" onClick={() => approve(true)} disabled={busy}>Approve and refresh score</button>
          </div>
        </article>
      )}
      {tickerDetail?.research?.length ? (
        <article className="panel">
          <h3>{tickerDetail.ticker.symbol} stored research signals</h3>
          <div className="signal-list">
            {tickerDetail.research.slice(0, 6).map((signal: any) => (
              <div className="signal-row" key={signal.id}>
                <b>{signal.sentiment || 'Neutral'} · {signal.confidence || 'Medium'}</b>
                <span>{signal.applied ? 'Affects score' : signal.approved ? 'Stored only' : 'Needs review'}</span>
                <p>{signal.summary || signal.reason || 'No summary provided.'}</p>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}

function HistoryView() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { getJson<any[]>('/api/history').then(setRows); }, []);
  return (
    <section className="panel">
      <h3>Recommendation Memory</h3>
      <div className="table">
        {rows.map((row) => (
          <div className="table-row" key={row.id}>
            <b>{row.symbol}</b><span>{new Date(row.created_at).toLocaleString()}</span><span>{row.decision}</span><span>{row.score}</span><span>{row.price ? `$${row.price.toFixed(2)}` : '--'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LearningView() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { getJson('/api/learning').then(setData); }, []);
  if (!data) return <div className="panel">Loading learning dashboard...</div>;
  return (
    <section className="stack">
      <div className="metric-grid">
        {Object.entries(data.best_score_ranges).map(([range, count]) => <Metric key={range} label={range} value={count as number} />)}
      </div>
      <div className="info-grid">
        <Info title="Best setups" body={data.best_setups.join(', ')} />
        <Info title="Best watchlists" body={data.best_watchlists.map((x: any[]) => `${x[0]} (${x[1]})`).join(', ') || '--'} />
        <Info title="Poor signals" body={data.poor_signals.map((x: any[]) => `${x[0]} (${x[1]})`).join(', ') || '--'} />
        <Info title="Outcome patterns" body={data.outcome_patterns} />
      </div>
    </section>
  );
}

function SettingsView() {
  const [positions, setPositions] = useState<any>(null);
  const [settings, setSettings] = useState<{ show_beginner_price_help: boolean } | null>(null);
  const [form, setForm] = useState({ ticker: '', shares: '', cost: '', theme: '' });
  const load = async () => {
    setPositions(await getJson('/api/positions'));
    setSettings(await getJson('/api/settings'));
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    await sendJson('/api/positions', { ticker: form.ticker, shares: Number(form.shares), cost: Number(form.cost), theme: form.theme || 'General' });
    setForm({ ticker: '', shares: '', cost: '', theme: '' });
    await load();
  };
  return (
    <section className="stack">
      <div className="panel">
        <h3>Learning Help</h3>
        <label className="toggle setting-toggle">
          <input
            type="checkbox"
            checked={Boolean(settings?.show_beginner_price_help)}
            onChange={async (event) => {
              const next = event.target.checked;
              setSettings({ show_beginner_price_help: next });
              await sendJson('/api/settings/show_beginner_price_help', { value: String(next) }, 'PATCH');
            }}
          />
          Show information icons for price levels
        </label>
        <p>Enabled by default. Turn this off once support, resistance, buy zones, risk levels, and review targets feel familiar.</p>
      </div>
      <div className="panel">
        <h3>Portfolio Input</h3>
        <div className="form-row">
          <input placeholder="Ticker" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} />
          <input placeholder="Shares" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} />
          <input placeholder="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <input placeholder="Theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} />
          <button className="primary" onClick={save}><Briefcase size={18} />Save</button>
        </div>
      </div>
      <div className="panel">
        <h3>Warnings</h3>
        {(positions?.warnings || []).length ? positions.warnings.map((w: string) => <p key={w}>{w}</p>) : <p>No concentration warnings from local portfolio input.</p>}
      </div>
      <div className="panel compact">
        <h3>Safety Language</h3>
        <p>This app uses setup qualifies, risk elevated, wait, and avoid. It never treats a score as a guarantee.</p>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
