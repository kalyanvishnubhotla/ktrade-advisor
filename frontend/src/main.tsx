import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock,
  History,
  LineChart,
  ListPlus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Target,
  Trash2
} from 'lucide-react';
import {
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
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
  score?: number;
  decision?: string;
  confidence?: string;
  risk?: string;
  trend_label?: string;
  momentum_label?: string;
  volume_label?: string;
  news_label?: string;
  summary?: string;
  suggested_action?: string;
  entry_range?: string;
  invalidation_level?: string;
  target1?: string;
  target2?: string;
  hold_window?: string;
  why_rating?: string;
  changes_view?: string;
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
  market: { label: string; explanation: string; last_refresh?: string };
  cards: Card[];
  watchlists: Watchlist[];
  disclaimer: string;
};

type Page = 'dashboard' | 'watchlists' | 'ticker' | 'research' | 'history' | 'learning' | 'settings';

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
  const topCards = useMemo(() => cards.slice(0, 8), [cards]);

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
        {loading && <div className="panel">Loading local dashboard...</div>}

        {!loading && page === 'dashboard' && dashboard && (
          <DashboardView cards={topCards} watchlists={dashboard.watchlists} onSelect={(symbol) => { setSelectedTicker(symbol); setPage('ticker'); }} />
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

function DashboardView({ cards, watchlists, onSelect }: { cards: Card[]; watchlists: Watchlist[]; onSelect: (symbol: string) => void }) {
  const counts = {
    buy: cards.filter((c) => c.decision === 'Buy-worthy now').length,
    wait: cards.filter((c) => c.decision === 'Wait for better price').length,
    avoid: cards.filter((c) => c.decision === 'Avoid for now').length
  };
  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Buy-worthy now" value={counts.buy} />
        <Metric label="Wait for better price" value={counts.wait} />
        <Metric label="Avoid for now" value={counts.avoid} />
        <Metric label="Active watchlists" value={watchlists.filter((w) => w.active).length} />
      </div>
      <div className="section-head"><h3>Recommendation Cards</h3><p>Ranked by local score</p></div>
      <div className="card-grid">
        {cards.map((card) => <TickerCard key={card.symbol} card={card} onSelect={onSelect} />)}
      </div>
      <div className="section-head"><h3>Watchlist Snapshot</h3><p>Simple health checks</p></div>
      <div className="watch-grid">
        {watchlists.slice(0, 6).map((watchlist) => <WatchlistSummary key={watchlist.id} watchlist={watchlist} />)}
      </div>
    </section>
  );
}

function TickerCard({ card, onSelect }: { card: Card; onSelect: (symbol: string) => void }) {
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
      <p className="summary">{card.summary || 'Run a refresh to calculate this setup.'}</p>
      <div className="facts">
        <span>Price <b>{card.price ? `$${card.price.toFixed(2)}` : '--'}</b></span>
        <span>Risk <b>{card.risk || '--'}</b></span>
        <span>Confidence <b>{card.confidence || '--'}</b></span>
      </div>
      <div className="plain-list">
        <span>Entry: {card.entry_range || '--'}</span>
        <span>Risk level: {card.invalidation_level || '--'}</span>
        <span>Targets: {card.target1 || '--'} / {card.target2 || '--'}</span>
      </div>
    </article>
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

function WatchlistsView({ reload }: { reload: () => Promise<void> }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');
  const [tickerInputs, setTickerInputs] = useState<Record<number, string>>({});

  const load = async () => setWatchlists(await getJson<Watchlist[]>('/api/watchlists'));
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
              <p>{score?.summary || 'Refresh data to calculate this setup.'}</p>
            </div>
            <div className={`score large ${scoreClass(score?.score)}`}>{score?.score ?? '--'}</div>
          </div>
          <div className="chart-panel">
            <ResponsiveContainer width="100%" height={280}>
              <ReLineChart data={detail.prices}>
                <XAxis dataKey="date" minTickGap={28} />
                <YAxis domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="close" stroke="#246bfe" dot={false} strokeWidth={2} />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
          <div className="info-grid">
            <Info title="Suggested action" body={score?.suggested_action} />
            <Info title="Why this rating" body={score?.why_rating} />
            <Info title="What changes the view" body={score?.changes_view} />
            <Info title="Hold window" body={score?.hold_window} />
          </div>
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

  const parse = async () => setResult(await sendJson('/api/research/parse', { text, approved: false, apply_impact: false }));

  return (
    <section className="stack">
      <div className="section-head"><h3>Paste Research Signal</h3><p>Stored locally. You approve impact before it changes scoring.</p></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <button className="primary fit" onClick={parse}><CheckCircle2 size={18} />Parse and store</button>
      {result && (
        <article className="panel">
          <h3>{result.parsed.ticker} research saved</h3>
          <p>{result.message}</p>
          <div className="facts">
            <span>Sentiment <b>{result.parsed.sentiment || '--'}</b></span>
            <span>Confidence <b>{result.parsed.confidence || '--'}</b></span>
            <span>Impact <b>{result.parsed.suggested_impact || '--'}</b></span>
          </div>
          <button onClick={async () => { await sendJson(`/api/research/${result.id}/approval`, { approved: true, apply_impact: true }, 'PATCH'); alert('Approved. Refresh to recalculate score.'); }}>Approve impact</button>
        </article>
      )}
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
  const [form, setForm] = useState({ ticker: '', shares: '', cost: '', theme: '' });
  const load = async () => setPositions(await getJson('/api/positions'));
  useEffect(() => { load(); }, []);
  const save = async () => {
    await sendJson('/api/positions', { ticker: form.ticker, shares: Number(form.shares), cost: Number(form.cost), theme: form.theme || 'General' });
    setForm({ ticker: '', shares: '', cost: '', theme: '' });
    await load();
  };
  return (
    <section className="stack">
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

