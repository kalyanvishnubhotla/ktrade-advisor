import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
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
      {view === 'cards' ? (
        <div className="card-grid">
          {cards.map((card) => <TickerCard key={card.symbol} card={card} showHelp={showHelp} onSelect={onSelect} />)}
        </div>
      ) : (
        <RecommendationTable cards={cards} onSelect={onSelect} />
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
              <td>{card.price ? `$${card.price.toFixed(2)}` : '--'}</td>
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
      <p className="summary">{card.summary || 'Run a refresh to calculate this setup.'}</p>
      <div className="facts">
        <span>Price <b>{card.price ? `$${card.price.toFixed(2)}` : '--'}</b></span>
        <span>Risk <b>{card.risk || '--'}</b></span>
        <span>Confidence <b>{card.confidence || '--'}</b></span>
        <span>News <b>{card.news_count || 0}</b></span>
        {card.buy_zone_confluence ? <span>Zone <b>{Math.round(card.buy_zone_confluence)}/100</b></span> : null}
      </div>
      {card.latest_news_title && (
        <a className="news-teaser" href={card.latest_news_link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          {card.latest_news_source}: {card.latest_news_title}
        </a>
      )}
      <div className="plain-list">
        {card.distance_to_buy_zone !== null && card.distance_to_buy_zone !== undefined && (
          <span>Distance to buy zone: {card.distance_to_buy_zone.toFixed(1)}%</span>
        )}
        {card.buy_zone_explanation && (
          <span>Buy zone basis: {card.buy_zone_explanation}</span>
        )}
        {card.target_zone_explanation && (
          <span>Target basis: {card.target_zone_explanation}</span>
        )}
        {card.nearest_support_zone && (
          <span>Demand zone: {card.nearest_support_zone.plain_english}</span>
        )}
        {card.nearest_resistance_zone && (
          <span>Supply zone: {card.nearest_resistance_zone.plain_english}</span>
        )}
        <PriceLine label="Pivot support" value={card.support ? `$${card.support.toFixed(2)}` : '--'} showHelp={showHelp} help="Price has shown buyers may step in around here. It is not a guaranteed floor." />
        <PriceLine label="Pivot resistance" value={card.resistance ? `$${card.resistance.toFixed(2)}` : '--'} showHelp={showHelp} help="Price has shown sellers or hesitation may appear around here." />
        <PriceLine label="Buy zone" value={card.entry_range || '--'} showHelp={showHelp} help="A price area where the setup may offer cleaner risk/reward. It is not a command to buy." />
        <PriceLine label="Risk level" value={card.invalidation_level || '--'} showHelp={showHelp} help="If price falls below this area and stays weak, the setup may be breaking down." />
        <PriceLine label="Review targets" value={`${card.target1 || '--'} / ${card.target2 || '--'}`} showHelp={showHelp} help="Price areas to reassess, not automatic sell points and not guarantees." />
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
