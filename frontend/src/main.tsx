import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorType, createChart, LineSeries, LineStyle } from 'lightweight-charts';
import { PieChart, Pie, Cell, Tooltip as RCTooltip, ResponsiveContainer, Legend } from 'recharts';
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
  Trash2,
  Upload,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import './styles.css';
import type {
  Card,
  Dashboard,
  DashboardFilter,
  DashboardSort,
  LearningInsights,
  NewsItem,
  Page,
  RecommendationSnapshot,
  SetupFactor,
  SRZone,
  Watchlist,
} from './types';
import {
  getJson,
  sendJson,
  scoreClass,
  formatMoney,
  formatNumber,
  parseMoneyValue,
  parseMoneyRange,
  pctText,
  signalTone,
  decisionNudge,
  plainFactor,
  targetLabel,
  targetHelp,
  educationalHelp,
  accuracyHelp,
  simpleDivergenceText,
  hasGentleWarning,
  gentleWarningLabel,
  technicalSourceToPlain,
} from './utils';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { getAllHoldings, getPortfolioSummary, getTransactions } from './services/portfolioService';
import type { PortfolioHolding, PortfolioSummary, PortfolioTransaction, TransactionFilters } from './services/portfolioService';
import { importPortfolioFiles, parseEtradeCSV, parseRobinhoodCSV } from './services/portfolioImportService';
import type { ParsedTransaction, ImportResult } from './services/portfolioImportService';

// ── HelpIcon ──────────────────────────────────────────────────────────────────
function HelpIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="help-wrap">
      <button className="help-btn" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>?</button>
      {show && <span className="help-tip">{text}</span>}
    </span>
  );
}

// ── ScoreBadge ────────────────────────────────────────────────────────────────
function ScoreBadge({ score, size = 'md' }: { score?: number; size?: 'md' | 'lg' }) {
  const cls = scoreClass(score);
  const label = !score ? '—' : score >= 80 ? 'Strong' : score >= 65 ? 'Good' : score >= 50 ? 'Fair' : 'Weak';
  if (size === 'lg') {
    return (
      <div className={`score-large ${cls}`}>
        <span className="snum">{score ?? '--'}</span>
        <span className="slbl">{label}</span>
      </div>
    );
  }
  return (
    <div className={`score-badge ${cls}`}>
      <span className="snum">{score ?? '--'}</span>
      <span className="slbl">{label}</span>
    </div>
  );
}

// ── DecisionPill ──────────────────────────────────────────────────────────────
function DecisionPill({ decision }: { decision?: string }) {
  const d = (decision || '').toLowerCase();
  let cls = 'pill-hold';
  if (d.includes('buy')) cls = 'pill-buy';
  else if (d.includes('wait')) cls = 'pill-wait';
  else if (d.includes('watch')) cls = 'pill-watch';
  else if (d.includes('avoid')) cls = 'pill-avoid';
  return (
    <span className={`decision-pill ${cls}`}>
      <span className="pdot" />
      {decision || 'Refresh needed'}
    </span>
  );
}

// ── SignalHealthGrid ───────────────────────────────────────────────────────────
function SignalHealthGrid({ card }: { card: Card }) {
  const signals = [
    { label: 'Trend', value: card.trend_label || '--' },
    { label: 'Momentum', value: card.momentum_label || '--' },
    { label: 'Volume', value: card.volume_label || '--' },
    { label: 'Risk', value: card.risk || '--' },
  ];
  const warning = hasGentleWarning(card);
  return (
    <div className="signal-grid">
      {signals.map((s) => (
        <span className={`signal-pill ${signalTone(s.value)}`} key={s.label}>
          <i aria-hidden="true" />
          <b>{s.label}</b>{s.value}
        </span>
      ))}
      {warning && (
        <span className="signal-pill yellow signal-wide">
          <i aria-hidden="true" />
          <b>Heads up</b>{gentleWarningLabel(card)}
          <HelpIcon text={educationalHelp((card.setup_concern_factors || [])[0] || card.summary)} />
        </span>
      )}
    </div>
  );
}

// ── SignalIntelBadges — shows the 5 new signal badges ────────────────────────
function signalModifierTone(mod?: number): string {
  if (mod === undefined || mod === null) return 'yellow';
  if (mod >= 5) return 'green';
  if (mod >= 1) return 'green';
  if (mod === 0) return 'yellow';
  if (mod >= -4) return 'yellow';
  return 'red';
}

function SignalIntelBadges({ card }: { card: Card }) {
  const badges: Array<{ label: string; value: string; mod?: number; help: string }> = [];

  if (card.earnings_label && card.earnings_label !== 'No earnings signal') {
    badges.push({
      label: 'Earnings',
      value: card.earnings_label,
      mod: card.earnings_score_modifier,
      help: card.earnings_summary || 'No detail available.',
    });
  }
  if (card.regime_label && card.regime_label !== 'Unknown') {
    badges.push({
      label: 'Market',
      value: card.regime_label,
      mod: card.regime_score_modifier,
      help: card.regime_summary || 'No detail available.',
    });
  }
  if (card.sector_rs_label && card.sector_rs_label !== 'No sector data') {
    badges.push({
      label: 'Sector RS',
      value: card.sector_rs_label,
      mod: card.sector_rs_score_modifier,
      help: card.sector_rs_summary || 'No detail available.',
    });
  }
  if (card.insider_label && card.insider_label !== 'No recent activity') {
    badges.push({
      label: 'Insiders',
      value: card.insider_label,
      mod: card.insider_score_modifier,
      help: card.insider_summary || 'No detail available.',
    });
  }
  if (card.fundamentals_label && card.fundamentals_label !== 'No data' && card.fundamentals_label !== 'N/A') {
    badges.push({
      label: 'Fundamentals',
      value: card.fundamentals_label,
      mod: card.fundamentals_score_modifier,
      help: card.fundamentals_summary || 'No detail available.',
    });
  }

  if (badges.length === 0) return null;

  return (
    <div className="signal-grid" style={{ marginTop: 6 }}>
      {badges.map((b) => (
        <span className={`signal-pill ${signalModifierTone(b.mod)}`} key={b.label}>
          <i aria-hidden="true" />
          <b>{b.label}</b>{b.value}
          <HelpIcon text={b.help} />
        </span>
      ))}
    </div>
  );
}

// ── TickerCard ────────────────────────────────────────────────────────────────
function TickerCard({ card, showHelp, onSelect, onTrack }: {
  card: Card; showHelp: boolean;
  onSelect: (symbol: string) => void;
  onTrack: (symbol: string) => Promise<void>;
}) {
  const [tracking, setTracking] = useState(false);
  return (
    <article className="ticker-card" onClick={() => onSelect(card.symbol)}>
      {/* Header */}
      <div className="ticker-top">
        <div>
          <div className="ticker-symbol">{card.symbol}</div>
          <div className="ticker-company">{card.company || card.theme}</div>
        </div>
        <ScoreBadge score={card.score} />
      </div>

      {/* Decision + price */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <DecisionPill decision={card.decision} />
        {card.price && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-bold)' }}>
            ${card.price.toFixed(2)}
          </span>
        )}
      </div>

      {/* Nudge */}
      <p className="nudge-text">{decisionNudge(card)}</p>

      {/* Facts */}
      <div className="card-facts">
        <span className="card-fact">Confidence <b>{card.confidence || '--'}</b></span>
        <span className="card-fact">News <b>{card.news_count || 0}</b></span>
        {card.buy_zone_confluence ? (
          <span className="card-fact">
            Setup <b>{Math.round(card.buy_zone_confluence)}/100</b>
            {showHelp && <HelpIcon text="Weighted checklist: price zones 30%, trend 25%, momentum 20%, volume 15%, volatility 10%." />}
          </span>
        ) : null}
      </div>

      {/* News teaser */}
      {card.latest_news_title && (
        <a className="news-teaser" href={card.latest_news_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {card.latest_news_source}: {card.latest_news_title}
        </a>
      )}

      {/* Signal health */}
      <SignalHealthGrid card={card} />

      {/* Intelligence signals (earnings, regime, sector RS, insider, fundamentals) */}
      <SignalIntelBadges card={card} />

      {/* Zone plan */}
      <div className="zone-plan">
        <div className="zone-plan-row">
          <span className="zp-label">
            Preferred buy area
            {showHelp && <HelpIcon text="A calmer price area to consider a new buy. Not a command." />}
          </span>
          <span className="zp-value buy">{card.entry_range || '--'}</span>
        </div>
        <div className="zone-plan-row">
          <span className="zp-label">
            {targetLabel(card)}
            {showHelp && <HelpIcon text={targetHelp(card)} />}
          </span>
          <span className="zp-value target">{card.target1 || '--'} / {card.target2 || '--'}</span>
        </div>
        <div className="zone-plan-row">
          <span className="zp-label">
            Risk line
            {showHelp && <HelpIcon text="If price falls below this area and stays weak, the setup may be breaking down." />}
          </span>
          <span className="zp-value risk">{card.invalidation_level || '--'}</span>
        </div>
      </div>

      {/* Scan details */}
      <div className="card-scan">
        {Boolean(card.fresh_high_targets) && (
          <span><b>Fresh highs:</b> Special targets based on momentum strength — not guarantees.</span>
        )}
        <span>
          <b>Best point:</b>{' '}
          {plainFactor((card.decision_reasons || card.setup_positive_factors || [])[0]) || 'Setup has enough evidence to review.'}
        </span>
        {(card.setup_concern_factors || [])[0] && (
          <span>
            <b>Watch:</b>{' '}
            {plainFactor(card.setup_concern_factors?.[0])}
            {showHelp && <HelpIcon text={educationalHelp(card.setup_concern_factors?.[0])} />}
          </span>
        )}
        <span>
          <b>Memory:</b>{' '}
          {card.similar_setup_memory || 'No similar recorded outcome yet.'}
        </span>
        <span>
          <b>Track record:</b>{' '}
          {card.historical_accuracy_70_plus != null
            ? `${card.historical_accuracy_70_plus.toFixed(1)}% worked after you marked Bought`
            : 'Not enough marked outcomes yet.'}
          {showHelp && <HelpIcon text={accuracyHelp()} />}
        </span>
        <span className="open-detail">Click card for full checklist &amp; learning details</span>
      </div>

      {/* Track button */}
      <button
        className="track-btn"
        disabled={tracking || !card.price || !card.score}
        onClick={async (e) => {
          e.stopPropagation();
          setTracking(true);
          try { await onTrack(card.symbol); } finally { setTracking(false); }
        }}
      >
        <Clock size={14} />{tracking ? 'Tracking...' : 'Track this decision'}
      </button>
    </article>
  );
}

// ── RecommendationTable ───────────────────────────────────────────────────────
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
            <th>Buy Area</th>
            <th>Target 1</th>
            <th>Target 2</th>
            <th>News</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.symbol} onClick={() => onSelect(card.symbol)}>
              <td>
                <span className="table-ticker">{card.symbol}</span>
                {card.company && <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{card.company}</span>}
              </td>
              <td><DecisionPill decision={card.decision} /></td>
              <td><span className={`score-chip ${scoreClass(card.score)}`}>{card.score ?? '--'}</span></td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{card.price ? `$${card.price.toFixed(2)}` : '--'}</td>
              <td><span style={{ fontSize: 'var(--text-xs)', color: card.risk === 'High' ? 'var(--red-text)' : card.risk === 'Low' ? 'var(--green-text)' : 'var(--gold-text)' }}>{card.risk || '--'}</span></td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--green-text)' }}>{card.entry_range || '--'}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--gold-text)' }}>{card.target1 || '--'}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--gold-text)' }}>{card.target2 || '--'}</td>
              <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{card.news_count || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── NewsList ──────────────────────────────────────────────────────────────────
function NewsList({ items, compact = false, ticker, onApplied }: {
  items: NewsItem[]; compact?: boolean; ticker?: string; onApplied?: () => void;
}) {
  if (!items.length) {
    return <div className="panel" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>No RSS headlines stored yet. Run Refresh to pull free news feeds.</div>;
  }
  return (
    <div className={compact ? 'news-grid' : 'news-grid'}>
      {items.map((item) => (
        <article className="news-item" key={item.id}>
          <div className="news-meta">
            <span className={`sentiment ${item.sentiment.toLowerCase()}`}>{item.sentiment}</span>
            <span className="news-source">{item.source}</span>
          </div>
          <h4 className="news-title">{item.title}</h4>
          {item.tickers && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Matched: {item.tickers}</p>}
          <div className="news-actions">
            <a href={item.link} target="_blank" rel="noreferrer">Open source</a>
            {ticker && (
              <button onClick={async () => {
                await sendJson(`/api/news/${item.id}/apply`, { ticker, confidence: 'Medium' });
                alert('Applied as a research signal. Press Refresh to recalculate the score.');
                onApplied?.();
              }}>Use in score</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ── WatchlistSummary ──────────────────────────────────────────────────────────
function WatchlistSummary({ watchlist }: { watchlist: Watchlist }) {
  return (
    <article className="panel panel-sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row">
        <strong style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{watchlist.name}</strong>
        <span className={watchlist.active ? 'pill active-pill' : 'pill'}>{watchlist.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="card-facts">
        <span className="card-fact">Tickers <b>{watchlist.ticker_count}</b></span>
        <span className="card-fact">Avg <b>{watchlist.average_score ?? '--'}</b></span>
        <span className="card-fact">Top <b>{watchlist.top_opportunities}</b></span>
      </div>
    </article>
  );
}

// ── DetailStat ────────────────────────────────────────────────────────────────
function DetailStat({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="detail-stat">
      <span>{label}</span>
      <b>{value || '--'}</b>
    </div>
  );
}

// ── ZoneList ──────────────────────────────────────────────────────────────────
function ZoneList({ zones }: { zones: SRZone[] }) {
  if (!zones?.length) return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>No zones cached yet. Run Refresh after adding the ticker.</p>;
  return (
    <div className="zone-list">
      {zones.slice(0, 6).map((zone, i) => (
        <div className="zone-row" key={`${zone.zone_type}-${zone.price_low}-${i}`}>
          <div>
            <b>{zone.zone_type === 'support' ? 'Buyer area' : 'Review area'}</b>
            <span>{formatMoney(zone.price_low)} – {formatMoney(zone.price_high)}</span>
          </div>
          <span className="zone-score">{Math.round(zone.confluence_score)}</span>
        </div>
      ))}
    </div>
  );
}

// ── PriceChart ────────────────────────────────────────────────────────────────
function PriceChart({ prices, score, indicators }: {
  prices: Array<{ date: string; close: number; volume?: number }>;
  score: any; indicators: any;
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
      .filter((p) => p.date && typeof p.close === 'number')
      .map((p) => ({ time: p.date, value: Number(p.close) })),
    [prices]
  );

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartData.length) return;
    container.replaceChildren();

    const chart = createChart(container, {
      height: 420,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111111' },
        textColor: '#a0a0a0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: '#1e1e1e' },
        horzLines: { color: '#1e1e1e' },
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
        scaleMargins: { top: 0.12, bottom: 0.16 },
      },
      timeScale: {
        borderColor: '#2a2a2a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 7,
      },
      crosshair: {
        mode: 1,
        horzLine: { labelVisible: true },
        vertLine: { labelVisible: true },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const priceSeries = chart.addSeries(LineSeries, {
      color: '#ffffff',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
    });
    priceSeries.setData(chartData as any);

    if (buyRange) {
      priceSeries.createPriceLine({ price: buyRange.high, color: '#00C805', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `Buy high $${buyRange.high.toFixed(2)}` });
      priceSeries.createPriceLine({ price: buyRange.low, color: '#00C805', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `Buy low $${buyRange.low.toFixed(2)}` });
    }
    if (currentPrice) {
      priceSeries.createPriceLine({ price: currentPrice, color: '#3B82F6', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `Now $${currentPrice.toFixed(2)}` });
    }
    if (riskLine) {
      priceSeries.createPriceLine({ price: riskLine, color: '#FF5000', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Risk $${riskLine.toFixed(2)}` });
    }
    if (firstTarget) {
      priceSeries.createPriceLine({ price: firstTarget, color: '#F5A623', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `T1 $${firstTarget.toFixed(2)}` });
    }
    if (secondTarget) {
      priceSeries.createPriceLine({ price: secondTarget, color: '#F5A623', lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: `T2 $${secondTarget.toFixed(2)}` });
    }

    chart.timeScale().fitContent();

    const tooltip = tooltipRef.current;
    chart.subscribeCrosshairMove((param) => {
      if (!tooltip || !param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
        if (tooltip) tooltip.style.display = 'none';
        return;
      }
      const data = param.seriesData.get(priceSeries) as { value?: number } | undefined;
      if (!data?.value) { tooltip.style.display = 'none'; return; }
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(param.point.x + 14, container.clientWidth - 170)}px`;
      tooltip.style.top = `${Math.max(param.point.y - 48, 8)}px`;
      tooltip.innerHTML = `<b>${String(param.time)}</b><span>$${data.value.toFixed(2)}</span>`;
    });

    const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    ro.observe(container);
    (container as any).__ktradeChart = chart;
    return () => { ro.disconnect(); chart.remove(); };
  }, [chartData, buyRange?.high, buyRange?.low, currentPrice, riskLine, firstTarget, secondTarget]);

  const setRange = (bars: number | 'all') => {
    const chart = (chartContainerRef.current as any)?.__ktradeChart;
    if (!chart || !chartData.length) return;
    if (bars === 'all') { chart.timeScale().fitContent(); return; }
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, chartData.length - bars), to: chartData.length + 8 });
  };

  return (
    <article className="chart-panel">
      <div className="chart-head">
        <div>
          <h3>Price Chart</h3>
          <p>Scroll to zoom · drag to pan · key levels on right axis</p>
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
        <span><i className="legend-current" />Current</span>
        <span><i className="legend-buy" />Buy zone</span>
        <span><i className="legend-risk" />Risk line</span>
        <span><i className="legend-review" />Targets</span>
      </div>
      <div className="chart-read">
        <span><b>Read:</b> {decisionNudge({ ...score, price: currentPrice } as Card)}</span>
        {buyRange && <span><b>Buy zone:</b> Green lines = lower and upper edge of the preferred entry area.</span>}
        {riskLine && <span><b>Risk:</b> A sustained move below the orange dashed line would damage the setup.</span>}
        {Boolean(score?.fresh_high_targets) && <span><b>Fresh highs:</b> {score.target1} is the next guidepost if momentum continues. Not a guarantee.</span>}
      </div>
    </article>
  );
}

// ── DashboardView ─────────────────────────────────────────────────────────────
function DashboardView({ cards, watchlists, news, showHelp, onSelect, onTrack }: {
  cards: Card[]; watchlists: Watchlist[]; news: NewsItem[];
  showHelp: boolean;
  onSelect: (symbol: string) => void;
  onTrack: (symbol: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [sort, setSort] = useState<DashboardSort>('score');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const buyCount = cards.filter((c) => (c.decision || '').toLowerCase().includes('buy')).length;
  const waitCount = cards.filter((c) => (c.decision || '').toLowerCase().includes('wait')).length;
  const avoidCount = cards.filter((c) => (c.decision || '').toLowerCase().includes('avoid')).length;
  const watchlistCount = watchlists.filter((w) => w.active).length;

  const filtered = useMemo(() => {
    let result = [...cards];
    if (filter === 'buy') result = result.filter((c) => (c.decision || '').toLowerCase().includes('buy'));
    else if (filter === 'wait') result = result.filter((c) => (c.decision || '').toLowerCase().includes('wait'));
    else if (filter === 'hold') result = result.filter((c) => (c.decision || '').toLowerCase().includes('hold'));
    else if (filter === 'avoid') result = result.filter((c) => (c.decision || '').toLowerCase().includes('avoid'));
    else if (filter === 'watch') result = result.filter((c) => (c.decision || '').toLowerCase().includes('watch'));
    else if (filter === 'close') result = result.filter((c) => (c.distance_to_buy_zone ?? 99) <= 3);
    else if (filter === 'quality') result = result.filter((c) => (c.buy_zone_confluence ?? 0) >= 70);
    else if (filter === 'lower-risk') result = result.filter((c) => c.risk === 'Low');
    else if (filter === 'news') result = result.filter((c) => (c.news_count ?? 0) > 0);

    result.sort((a, b) => {
      if (sort === 'score') return (b.score ?? 0) - (a.score ?? 0);
      if (sort === 'close') return (a.distance_to_buy_zone ?? 99) - (b.distance_to_buy_zone ?? 99);
      if (sort === 'quality') return (b.buy_zone_confluence ?? 0) - (a.buy_zone_confluence ?? 0);
      if (sort === 'risk') {
        const order: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
        return (order[a.risk ?? 'Medium'] ?? 1) - (order[b.risk ?? 'Medium'] ?? 1);
      }
      if (sort === 'ticker') return a.symbol.localeCompare(b.symbol);
      return 0;
    });
    return result;
  }, [cards, filter, sort]);

  const FILTERS: { key: DashboardFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'buy', label: 'Buy-worthy' },
    { key: 'wait', label: 'Wait' },
    { key: 'watch', label: 'Watch' },
    { key: 'hold', label: 'Hold' },
    { key: 'avoid', label: 'Avoid' },
    { key: 'close', label: 'Near buy zone' },
    { key: 'quality', label: 'High quality' },
    { key: 'lower-risk', label: 'Low risk' },
    { key: 'news', label: 'Has news' },
  ];

  return (
    <div className="stack">
      {/* KPI row */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-label">Buy-worthy now</div>
          <div className="kpi-value kv-green">{buyCount}</div>
          <div className="kpi-sub">Ready to consider</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Wait for better price</div>
          <div className="kpi-value kv-gold">{waitCount}</div>
          <div className="kpi-sub">Patience recommended</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avoid for now</div>
          <div className="kpi-value kv-red">{avoidCount}</div>
          <div className="kpi-sub">Setup not ready</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Active watchlists</div>
          <div className="kpi-value kv-blue">{watchlistCount}</div>
          <div className="kpi-sub">{cards.length} tickers tracked</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="filter-chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-divider" style={{ width: 1, height: 20, background: 'var(--border-default)', flexShrink: 0 }} />
        <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as DashboardSort)}>
          <option value="score">Sort: Score</option>
          <option value="close">Sort: Closest to buy</option>
          <option value="quality">Sort: Setup quality</option>
          <option value="risk">Sort: Risk (low first)</option>
          <option value="ticker">Sort: Ticker A–Z</option>
        </select>
        <div className="view-toggle">
          <button className={`btn-icon ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setViewMode('cards')} title="Card view">
            ⊞
          </button>
          <button className={`btn-icon ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table view">
            ☰
          </button>
        </div>
        <span className="result-count">{filtered.length} of {cards.length} tickers</span>
      </div>

      {/* Cards or table */}
      {viewMode === 'cards' ? (
        <div className="card-grid">
          {filtered.map((card) => (
            <TickerCard key={card.symbol} card={card} showHelp={showHelp} onSelect={onSelect} onTrack={onTrack} />
          ))}
          {!filtered.length && (
            <div className="panel" style={{ gridColumn: '1/-1', color: 'var(--text-tertiary)', textAlign: 'center' }}>
              No tickers match this filter. Add tickers to a watchlist and run Refresh.
            </div>
          )}
        </div>
      ) : (
        <RecommendationTable cards={filtered} onSelect={onSelect} />
      )}

      {/* Watchlist summaries */}
      {watchlists.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--space-4)' }}>
            <div><h3>Watchlist Summary</h3><p>Active watchlists and their current state</p></div>
          </div>
          <div className="watch-grid">
            {watchlists.slice(0, 6).map((wl) => <WatchlistSummary key={wl.id} watchlist={wl} />)}
          </div>
        </>
      )}

      {/* News */}
      {news.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--space-4)' }}>
            <div><h3>Latest Headlines</h3><p>Free RSS feeds — local matching only</p></div>
          </div>
          <NewsList items={news.slice(0, 9)} compact />
        </>
      )}
    </div>
  );
}

// ── NavButton ─────────────────────────────────────────────────────────────────
function NavButton({ page, current, setPage, icon, label }: {
  page: Page; current: Page; setPage: (p: Page) => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button className={`nav-btn ${current === page ? 'active' : ''}`} onClick={() => setPage(page)}>
      {icon}{label}
    </button>
  );
}

// ── FirstRunGuide ─────────────────────────────────────────────────────────────
function FirstRunGuide({ onClose }: { onClose: () => void }) {
  const steps = [
    { title: 'Create a watchlist', body: 'Go to Watchlists → create a list → add ticker symbols like AAPL or NVDA.' },
    { title: 'Run Refresh', body: 'Hit Refresh in the top bar. The engine fetches price data and calculates scores for all tickers.' },
    { title: 'Read the dashboard', body: 'Each card shows a score (0–100), a decision, and a preferred buy area. Higher score = cleaner setup.' },
    { title: 'Click any card for details', body: 'See the full checklist, price chart with key zones, signal breakdown, and news matched to that ticker.' },
    { title: 'Track your decisions', body: 'Hit "Track this decision" to snapshot the recommendation. Later mark what you did — this builds your learning history.' },
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="row">
          <div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 4 }}>Getting started</p>
            <h3>Welcome to KTrade Advisor</h3>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Skip</button>
        </div>
        <div className="guide-steps">
          {steps.map((step, i) => (
            <div className="guide-step" key={i}>
              <div className="guide-num">{i + 1}</div>
              <div className="guide-text">
                <h4>{step.title}</h4>
                <p>{step.body}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => {
          window.localStorage.setItem('ktrade_onboarding_seen', 'true');
          onClose();
        }}>Got it, let's go</button>
      </div>
    </div>
  );
}

// ── WatchlistsView ────────────────────────────────────────────────────────────
function WatchlistsView({ reload }: { reload: () => Promise<void> }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');
  const [tickerInputs, setTickerInputs] = useState<Record<number, string>>({});
  const [edits, setEdits] = useState<Record<number, { name: string; theme: string; active: boolean }>>({});

  const load = async () => {
    const lists = await getJson<Watchlist[]>('/api/watchlists');
    setWatchlists(lists);
    setEdits(Object.fromEntries(lists.map((l) => [l.id, { name: l.name, theme: l.theme, active: Boolean(l.active) }])));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await sendJson('/api/watchlists', { name, theme: theme || name, active: true });
    setName(''); setTheme('');
    await load(); await reload();
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
    await load(); await reload();
  };

  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Watchlists</h3><p>Organize tickers into themed groups</p></div>
      </div>
      <div className="form-row" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New watchlist name" style={{ flex: 1, minWidth: 160 }} />
        <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Theme (e.g. AI, Tech, Energy)" style={{ flex: 1, minWidth: 160 }} />
        <button className="btn btn-primary" onClick={create}><ListPlus size={16} />Create Watchlist</button>
      </div>
      <div className="watch-grid wide">
        {watchlists.map((list) => (
          <article className="panel" key={list.id}>
            <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
              <div>
                <h3 style={{ marginBottom: 2 }}>{list.name}</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{list.theme} · {list.ticker_count} tickers</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={async () => { await sendJson(`/api/watchlists/${list.id}/duplicate`); await load(); }}>Duplicate</button>
            </div>
            <div className="form-row nested">
              <input value={edits[list.id]?.name || ''} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], name: e.target.value } })} placeholder="Name" />
              <input value={edits[list.id]?.theme || ''} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], theme: e.target.value } })} placeholder="Theme" />
              <label className="toggle">
                <input type="checkbox" checked={Boolean(edits[list.id]?.active)} onChange={(e) => setEdits({ ...edits, [list.id]: { ...edits[list.id], active: e.target.checked } })} />
                Active
              </label>
              <button className="btn btn-secondary btn-sm" onClick={() => saveList(list.id)}>Save</button>
            </div>
            <div className="card-facts" style={{ marginTop: 'var(--space-3)' }}>
              <span className="card-fact">Top <b>{list.top_opportunities}</b></span>
              <span className="card-fact">Wait <b>{list.wait_on}</b></span>
              <span className="card-fact">Avoid <b>{list.avoid}</b></span>
              <span className="card-fact">Avg Score <b>{list.average_score ?? '--'}</b></span>
            </div>
            <div className="ticker-chips">
              {(list.tickers || []).map((ticker) => (
                <span className="chip" key={ticker.symbol}>
                  {ticker.symbol}
                  <button title="Remove" onClick={async () => { await fetch(`/api/watchlists/${list.id}/tickers/${ticker.symbol}`, { method: 'DELETE' }); await load(); }}>
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="form-row nested">
              <input value={tickerInputs[list.id] || ''} onChange={(e) => setTickerInputs({ ...tickerInputs, [list.id]: e.target.value.toUpperCase() })} placeholder="Add ticker (e.g. AAPL)" onKeyDown={(e) => { if (e.key === 'Enter') addTicker(list.id, list.theme); }} />
              <button className="btn btn-secondary btn-sm" onClick={() => addTicker(list.id, list.theme)}>Add</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ── SnapshotModal ─────────────────────────────────────────────────────────────
function SnapshotModal({ snapshot, onClose, onSaved }: {
  snapshot: RecommendationSnapshot; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [action, setAction] = useState<'Bought' | 'Ignored' | 'Watched'>((snapshot.user_action as any) || 'Watched');
  const [boughtPrice, setBoughtPrice] = useState('');
  const [outcome, setOutcome] = useState(snapshot.actual_outcome_pct != null ? String(snapshot.actual_outcome_pct) : '');
  const [notes, setNotes] = useState(snapshot.notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const priceNote = boughtPrice.trim() ? `Bought at $${Number(boughtPrice).toFixed(2)}. ` : '';
    await sendJson(`/api/snapshots/${snapshot.id}/action`, { action, notes: `${priceNote}${notes}`.trim() }, 'PATCH');
    if (outcome.trim()) await sendJson(`/api/snapshots/${snapshot.id}/outcome`, { actualOutcomePct: Number(outcome) }, 'PATCH');
    setSaving(false);
    await onSaved();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="row">
          <div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 4 }}>{snapshot.ticker}</p>
            <h3>Mark What I Did</h3>
          </div>
          <button className="btn-ghost btn-sm btn" onClick={onClose}>Close</button>
        </div>
        <label>Action
          <select value={action} onChange={(e) => setAction(e.target.value as any)}>
            <option value="Bought">Bought</option>
            <option value="Ignored">Ignored</option>
            <option value="Watched">Watched</option>
          </select>
        </label>
        <label>I bought at price
          <input inputMode="decimal" value={boughtPrice} onChange={(e) => setBoughtPrice(e.target.value)} placeholder="Optional, e.g. 142.50" />
        </label>
        <label>Outcome %
          <input inputMode="decimal" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. 14.2 for a 14.2% gain" />
        </label>
        <label>Notes
          <textarea className="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you notice? Why did you act or wait?" />
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Record outcome'}</button>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── SnapshotTimeline ──────────────────────────────────────────────────────────
function SnapshotTimeline({ snapshots, onUpdated }: { snapshots: RecommendationSnapshot[]; onUpdated: () => Promise<void> }) {
  const [editing, setEditing] = useState<RecommendationSnapshot | null>(null);
  return (
    <article className="panel">
      <div className="section-head">
        <div><h3>Recommendation History</h3><p>Point-in-time snapshots saved after each refresh.</p></div>
      </div>
      {!snapshots.length ? (
        <p>No saved snapshots yet. Run Refresh to start building recommendation memory.</p>
      ) : (
        <div className="snapshot-timeline">
          {snapshots.map((snap) => {
            const outcomePositive = (snap.actual_outcome_pct ?? 0) > 0;
            const outcomeNegative = (snap.actual_outcome_pct ?? 0) < 0;
            return (
              <div className="snapshot-row" key={snap.id}>
                <div className="snapshot-date">
                  <b>{snap.snapshot_date ? snap.snapshot_date.slice(0, 10) : '--'}</b>
                  <span>{formatMoney(snap.current_price)}</span>
                </div>
                <span className={`score-mini ${scoreClass(snap.setup_quality)}`}>{snap.setup_quality}</span>
                <div className="snapshot-main">
                  <b>{snap.recommended_action}</b>
                  <span>Buy {formatMoney(snap.buy_zone_low)} – {formatMoney(snap.buy_zone_high)} · Risk {formatMoney(snap.risk_line)}</span>
                </div>
                <div className="snapshot-outcome">
                  <span>{snap.user_action || 'Not marked'}</span>
                  <b style={{ color: snap.actual_outcome_pct != null ? (outcomePositive ? 'var(--green-text)' : outcomeNegative ? 'var(--red-text)' : undefined) : undefined }}>
                    {snap.actual_outcome_pct != null ? `${snap.actual_outcome_pct > 0 ? '+' : ''}${snap.actual_outcome_pct.toFixed(1)}%` : '--'}
                  </b>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(snap)}>Mark</button>
              </div>
            );
          })}
        </div>
      )}
      {editing && <SnapshotModal snapshot={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onUpdated(); }} />}
    </article>
  );
}

// ── Info box ──────────────────────────────────────────────────────────────────
function Info({ title, body }: { title: string; body?: string }) {
  return (
    <article className="panel panel-sm">
      <h3 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>{title}</h3>
      <p>{body || '--'}</p>
    </article>
  );
}

// ── TickerView ────────────────────────────────────────────────────────────────
function TickerView({ symbol, setSymbol }: { symbol: string; setSymbol: (s: string) => void }) {
  const [query, setQuery] = useState(symbol);
  const [detail, setDetail] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<RecommendationSnapshot[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [tracking, setTracking] = useState(false);

  const load = async (target = symbol) => {
    setError('');
    try {
      const normalized = target.toUpperCase().replace(/\s+/g, '');
      const [tickerDetail, snapshotRows] = await Promise.all([
        getJson(`/api/tickers/${normalized}`),
        getJson<RecommendationSnapshot[]>(`/api/snapshots/${normalized}?limit=40`).catch(() => []),
      ]);
      setDetail(tickerDetail);
      setSnapshots(snapshotRows);
    } catch {
      setError('Ticker not found in any watchlist. Add it first, then refresh.');
      setDetail(null); setSnapshots([]);
    }
  };

  useEffect(() => { load(symbol); }, [symbol]);

  const score = detail?.scores?.[0];
  const indicators = detail?.indicators;
  const zones = (detail?.sr_zones || []) as SRZone[];
  const buyerZones = zones.filter((z) => z.zone_type === 'support');
  const reviewZones = zones.filter((z) => z.zone_type === 'resistance');

  return (
    <section className="stack">
      <div className="form-row">
        <input value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} placeholder="Enter ticker symbol" style={{ maxWidth: 200 }} onKeyDown={(e) => { if (e.key === 'Enter') { setSymbol(query); load(query); } }} />
        <button className="btn btn-primary" onClick={() => { setSymbol(query); load(query); }}><Search size={16} />Open</button>
      </div>
      {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}
      {status && <div className="success"><CheckCircle2 size={16} />{status}</div>}

      {detail && (
        <>
          <div className="detail-hero">
            <div>
              <p className="eyebrow">{detail.ticker.theme}</p>
              <h2>{detail.ticker.symbol}{detail.ticker.company ? ` · ${detail.ticker.company}` : ''}</h2>
              <p className="hero-nudge">{decisionNudge({ ...score, price: indicators?.price } as Card)}</p>
            </div>
            <div className="hero-right">
              <ScoreBadge score={score?.score} size="lg" />
              <DecisionPill decision={score?.decision} />
              <button className="track-btn" disabled={tracking || !score || !indicators?.price} onClick={async () => {
                setTracking(true); setStatus('');
                try {
                  await sendJson(`/api/snapshots/${encodeURIComponent(detail.ticker.symbol)}/track-current`);
                  setStatus('Snapshot saved. This helps the app learn over time.');
                  await load(detail.ticker.symbol);
                } finally { setTracking(false); }
              }}>
                <Clock size={14} />{tracking ? 'Tracking...' : 'Track this decision'}
              </button>
            </div>
          </div>

          <div className="detail-grid">
            {/* Decision plan */}
            <article className="panel panel-sm">
              <h3>Decision Plan</h3>
              <div className="detail-stat-grid">
                <DetailStat label="Current price" value={formatMoney(indicators?.price)} />
                <DetailStat label="Preferred buy area" value={score?.entry_range} />
                <DetailStat label={targetLabel(score)} value={`${score?.target1 || '--'} / ${score?.target2 || '--'}`} />
                <DetailStat label="Risk line" value={score?.invalidation_level} />
                <DetailStat label="Distance to buy area" value={score?.distance_to_buy_zone != null ? `${score.distance_to_buy_zone.toFixed(1)}%` : '--'} />
                <DetailStat label="Setup quality" value={score?.buy_zone_confluence ? `${Math.round(score.buy_zone_confluence)}/100` : '--'} />
              </div>
            </article>

            {/* Signal health */}
            <article className="panel panel-sm">
              <h3>Signal Health</h3>
              <SignalHealthGrid card={{ ...score, risk: score?.risk } as Card} />
              <div className="learning-note" style={{ marginTop: 'var(--space-3)' }}>
                <b>Track record at 70+ score on this ticker:</b>{' '}
                {detail.historical_accuracy_70_plus != null ? `${detail.historical_accuracy_70_plus.toFixed(1)}%` : 'Not enough marked outcomes yet'}
                <HelpIcon text={accuracyHelp()} />
              </div>
              <div className="detail-stat-grid" style={{ marginTop: 'var(--space-3)' }}>
                <DetailStat label="Trend" value={score?.trend_strength_summary || score?.trend_label} />
                <DetailStat label="Momentum" value={score?.momentum_label} />
                <DetailStat label="Volume" value={score?.volume_label} />
                <DetailStat label="Risk level" value={score?.risk} />
                <DetailStat label="Confidence" value={score?.confidence} />
              </div>
            </article>

            {/* Intelligence Signals */}
            {(indicators?.earnings_label || indicators?.regime_label || indicators?.sector_rs_label || indicators?.insider_label || indicators?.fundamentals_label) && (
              <article className="panel panel-sm">
                <h3>Intelligence Signals</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
                  Five additional signals that adjust the score beyond price technicals.
                </p>
                <SignalIntelBadges card={{ ...score, ...indicators } as Card} />
                <div className="detail-stat-grid" style={{ marginTop: 'var(--space-3)' }}>
                  {indicators?.earnings_label && <DetailStat label="Earnings" value={indicators.earnings_label} />}
                  {indicators?.days_to_earnings != null && (
                    <DetailStat label="Days to earnings" value={String(indicators.days_to_earnings)} />
                  )}
                  {indicators?.regime_label && <DetailStat label="Market regime" value={indicators.regime_label} />}
                  {indicators?.regime_vix != null && <DetailStat label="VIX" value={String(indicators.regime_vix)} />}
                  {indicators?.sector_rs_label && <DetailStat label="Sector RS" value={indicators.sector_rs_label} />}
                  {indicators?.sector_etf && <DetailStat label="Sector ETF" value={indicators.sector_etf} />}
                  {indicators?.sector_rs_13w != null && <DetailStat label="RS 13-week" value={`${indicators.sector_rs_13w > 0 ? '+' : ''}${indicators.sector_rs_13w.toFixed(1)}%`} />}
                  {indicators?.insider_label && <DetailStat label="Insiders" value={indicators.insider_label} />}
                  {indicators?.insider_buy_count != null && <DetailStat label="Insider buys" value={String(indicators.insider_buy_count)} />}
                  {indicators?.fundamentals_label && <DetailStat label="Fundamentals" value={indicators.fundamentals_label} />}
                  {indicators?.fundamentals_pe != null && <DetailStat label="P/E ratio" value={String(indicators.fundamentals_pe)} />}
                  {indicators?.fundamentals_revenue_growth != null && <DetailStat label="Revenue growth" value={`${indicators.fundamentals_revenue_growth > 0 ? '+' : ''}${indicators.fundamentals_revenue_growth.toFixed(1)}%`} />}
                  {indicators?.fundamentals_profit_margin != null && <DetailStat label="Profit margin" value={`${indicators.fundamentals_profit_margin.toFixed(1)}%`} />}
                </div>
                {indicators?.fundamentals_summary && (
                  <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{indicators.fundamentals_summary}</p>
                )}
                {indicators?.earnings_summary && (
                  <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{indicators.earnings_summary}</p>
                )}
              </article>
            )}

            {/* Why this action */}
            <article className="panel panel-sm">
              <h3>Why This Action</h3>
              <div className="factor-list positive" style={{ marginBottom: 'var(--space-3)' }}>
                <b>Top reasons</b>
                {((score?.decision_reasons || score?.setup_positive_factors || []) as string[]).slice(0, 3).map((f) => (
                  <span key={f}>{plainFactor(f)}<HelpIcon text={educationalHelp(f)} /></span>
                ))}
                {!((score?.decision_reasons || score?.setup_positive_factors || []).length) && <span>Run refresh to generate reasons.</span>}
              </div>
              {(score?.setup_concern_factors || []).length > 0 && (
                <div className="factor-list concern">
                  <b>Concerns</b>
                  {((score?.setup_concern_factors || []) as string[]).slice(0, 2).map((f) => (
                    <span key={f}>{plainFactor(f)}<HelpIcon text={educationalHelp(f)} /></span>
                  ))}
                </div>
              )}
            </article>

            {/* Setup checklist */}
            <article className="panel panel-sm">
              <h3>Setup Checklist</h3>
              <p className="subtle-line" style={{ marginBottom: 'var(--space-3)' }}>
                High-score track record:{' '}
                <b>{detail.historical_accuracy_70_plus != null ? `${detail.historical_accuracy_70_plus.toFixed(1)}%` : 'not enough data yet'}</b>
                <HelpIcon text={accuracyHelp()} />
              </p>
              <div>
                {((score?.setup_factor_scores || []) as SetupFactor[]).map((factor) => (
                  <div className="checklist-row" key={factor.key}>
                    <div className="cl-label-row">
                      <span>{factor.label}<HelpIcon text={factor.concern ? educationalHelp(factor.concern) : 'One part of the setup quality score.'} /></span>
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
            <article className="panel panel-sm">
              <h3>Key Price Levels</h3>
              <div className="detail-stat-grid">
                <DetailStat label="Pivot support" value={formatMoney(indicators?.support)} />
                <DetailStat label="Pivot resistance" value={formatMoney(indicators?.resistance)} />
                <DetailStat label="50-day average" value={formatMoney(indicators?.ma50)} />
                <DetailStat label="200-day average" value={formatMoney(indicators?.ma200)} />
                <DetailStat label="ATR risk buffer" value={formatMoney(indicators?.atr)} />
                <DetailStat label="Relative strength vs SPY" value={formatNumber(indicators?.relative_strength, 3)} />
              </div>
            </article>
            <article className="panel panel-sm">
              <h3>Buyer Areas</h3>
              <ZoneList zones={buyerZones} />
            </article>
            <article className="panel panel-sm">
              <h3>Review Areas</h3>
              <ZoneList zones={reviewZones} />
            </article>
            <article className="panel panel-sm">
              <h3>Technical Signals</h3>
              <div className="detail-stat-grid">
                <DetailStat label="RSI" value={formatNumber(indicators?.rsi, 1)} />
                <DetailStat label="RSI read" value={indicators?.rsi_interpretation} />
                <DetailStat label="ADX" value={indicators?.adx ? `${formatNumber(indicators.adx, 1)} · ${indicators.adx_interpretation}` : '--'} />
                <DetailStat label="Trend alignment" value={indicators?.trend_alignment} />
                <DetailStat label="MACD" value={formatNumber(indicators?.macd, 2)} />
                <DetailStat label="MACD trend" value={indicators?.macd_trend || score?.macd_trend} />
                <DetailStat label="Momentum change" value={simpleDivergenceText(indicators?.momentum_divergence)} />
                <DetailStat label="Volume vs 20-day avg" value={indicators?.volume_vs_20d ? `${formatNumber(indicators.volume_vs_20d, 2)}x` : '--'} />
                <DetailStat label="OBV trend" value={indicators?.obv_trend} />
                <DetailStat label="Up-day volume" value={indicators?.rising_volume_on_up_days ? 'Rising on advances' : 'Not clearly rising'} />
                <DetailStat label="Pattern" value={indicators?.pattern_signal} />
              </div>
            </article>
          </div>

          <div className="info-grid">
            <Info title="Suggested action" body={score?.suggested_action} />
            <Info title="Why this rating" body={score?.why_rating} />
            <Info title="Risk / reward at buy area" body={score?.risk_reward_summary} />
            {Boolean(score?.fresh_high_targets) && <Info title="Fresh-high targets" body={score?.fresh_high_target_note} />}
            <Info title="What would improve this" body={plainFactor(score?.improve_to_buy)} />
            <Info title="What changes the view" body={score?.changes_view} />
            <Info title="Hold window" body={score?.hold_window} />
          </div>

          <div className="detail-grid">
            <article className="panel panel-sm">
              <h3>Recommendation Memory</h3>
              <div className="mini-table">
                {snapshots.slice(0, 8).map((snap) => (
                  <div className="mini-row" key={snap.id}>
                    <b>{snap.recommended_action}</b>
                    <span>{formatMoney(snap.current_price)} · {snap.setup_quality}</span>
                    <span>{snap.actual_outcome_pct != null ? `${snap.actual_outcome_pct > 0 ? '+' : ''}${snap.actual_outcome_pct.toFixed(1)}%` : snap.user_action || 'Not marked'}</span>
                    <span>{snap.snapshot_date?.slice(0, 10)}</span>
                  </div>
                ))}
                {!snapshots.length && <p>No tracked snapshots yet. Use "Track this decision" or Refresh to start building memory.</p>}
              </div>
            </article>
            <article className="panel panel-sm">
              <h3>Research Signals</h3>
              <div className="signal-list">
                {(detail.research || []).slice(0, 5).map((item: any) => (
                  <div className="signal-row" key={item.id}>
                    <b>{item.sentiment || 'Signal'} · {item.confidence || '--'}</b>
                    <span>{item.catalyst_type || item.suggested_impact || 'Research note'}</span>
                    <p>{item.source_date || item.created_at?.slice(0, 10)}</p>
                  </div>
                ))}
                {!(detail.research || []).length && <p>No pasted research signals yet.</p>}
              </div>
            </article>
          </div>

          <SnapshotTimeline snapshots={snapshots} onUpdated={() => load(detail.ticker.symbol)} />

          <div className="section-head">
            <div><h3>Matched RSS Headlines</h3><p>Free sources, local keyword matching only</p></div>
          </div>
          <NewsList items={detail.news || []} ticker={detail.ticker.symbol} onApplied={() => load(detail.ticker.symbol)} />
        </>
      )}
    </section>
  );
}

// ── ResearchView ──────────────────────────────────────────────────────────────
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
    setBusy(true); setError(''); setStatus('');
    try {
      const r = await sendJson<any>('/api/research/parse', { text, approved: false, apply_impact: false });
      setResult(r);
      setStatus(`Saved ${r.parsed.ticker} research locally. Review the parsed signal below before applying it to the score.`);
      if (r.parsed?.ticker) setTickerDetail(await getJson(`/api/tickers/${r.parsed.ticker}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse. Check that the Ticker field is filled in.');
    } finally { setBusy(false); }
  };

  const approve = async (applyImpact: boolean) => {
    if (!result?.id) return;
    setBusy(true); setError('');
    try {
      await sendJson(`/api/research/${result.id}/approval`, { approved: true, apply_impact: applyImpact }, 'PATCH');
      if (applyImpact) {
        setStatus('Approved. Refreshing scores...');
        await sendJson('/api/refresh');
        setStatus(`${result.parsed.ticker} score refreshed with this research signal included.`);
        setTickerDetail(await getJson(`/api/tickers/${result.parsed.ticker}`));
      } else {
        setStatus('Saved for reference only. This signal will not affect the score.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this signal.');
    } finally { setBusy(false); }
  };

  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Research Signal</h3><p>Paste structured research to add external signal context to your scores.</p></div>
      </div>

      <div className="help-strip">
        <span><b>Step 1</b> Copy the source link and paste into ChatGPT. Ask it to fill in this template format.</span>
        <span><b>Step 2</b> Copy that output and paste it here.</span>
        <span><b>Step 3</b> Approve impact only if you agree the signal should affect the score.</span>
      </div>

      {status && <div className="success"><CheckCircle2 size={16} />{status}</div>}
      {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}

      <div className="research-actions">
        <button className="btn btn-primary" onClick={parse} disabled={busy || !text.trim()}><CheckCircle2 size={16} />{busy ? 'Working...' : 'Parse signal'}</button>
        <button className="btn btn-secondary" onClick={() => { setText(template); setResult(null); setStatus(''); setError(''); }}>Reset template</button>
      </div>

      <textarea className="research-input" value={text} onChange={(e) => setText(e.target.value)} />

      {result && (
        <article className="panel parsed-panel">
          <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
            <div>
              <p className="eyebrow">Parsed Signal</p>
              <h3>{result.parsed.ticker} · {result.parsed.company || 'Company not provided'}</h3>
            </div>
            <span className={`sentiment ${(result.parsed.sentiment || 'neutral').toLowerCase()}`}>{result.parsed.sentiment || 'Neutral'}</span>
          </div>
          <div className="card-facts" style={{ marginBottom: 'var(--space-3)' }}>
            <span className="card-fact">Date <b>{result.parsed.date || '--'}</b></span>
            <span className="card-fact">Confidence <b>{result.parsed.confidence || '--'}</b></span>
            <span className="card-fact">Impact <b>{result.parsed.suggested_impact || '--'}</b></span>
            <span className="card-fact">Sensitivity <b>{result.parsed.time_sensitivity || '--'}</b></span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>{result.parsed.summary || 'No research summary provided.'}</p>
          <div className="signal-columns">
            <div>
              <h4 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--green-text)', marginBottom: 8 }}>Bullish</h4>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{result.parsed.bullish || '--'}</p>
            </div>
            <div>
              <h4 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--red-text)', marginBottom: 8 }}>Bearish</h4>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{result.parsed.bearish || '--'}</p>
            </div>
          </div>
          <div className="review-box">
            <b>Human check required</b>
            <p>Saving keeps this as a reference note. Approving lets it affect the News/Research score after the next refresh.</p>
          </div>
          <div className="research-actions">
            <button className="btn btn-secondary" onClick={() => approve(false)} disabled={busy}>Save reference only</button>
            <button className="btn btn-primary" onClick={() => approve(true)} disabled={busy}>Approve &amp; refresh score</button>
          </div>
        </article>
      )}

      {tickerDetail?.research?.length > 0 && (
        <article className="panel">
          <h3>{tickerDetail.ticker.symbol} stored research signals</h3>
          <div className="signal-list" style={{ marginTop: 'var(--space-3)' }}>
            {tickerDetail.research.slice(0, 6).map((signal: any) => (
              <div className="signal-row" key={signal.id}>
                <b>{signal.sentiment || 'Neutral'} · {signal.confidence || 'Medium'}</b>
                <span>{signal.applied ? 'Affects score' : signal.approved ? 'Stored only' : 'Needs review'}</span>
                <p>{signal.summary || signal.reason || 'No summary provided.'}</p>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

// ── HistoryView ───────────────────────────────────────────────────────────────
function HistoryView() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { getJson<any[]>('/api/history').then(setRows); }, []);
  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Recommendation History</h3><p>Full log of every recommendation snapshot saved.</p></div>
      </div>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Date</th>
              <th>Decision</th>
              <th>Score</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><b>{row.symbol}</b></td>
                <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{new Date(row.created_at).toLocaleString()}</td>
                <td><DecisionPill decision={row.decision} /></td>
                <td><span className={`score-chip ${scoreClass(row.score)}`}>{row.score}</span></td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{row.price ? `$${row.price.toFixed(2)}` : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No history yet. Add tickers to watchlists and run Refresh.</div>}
      </div>
    </section>
  );
}

// ── LearningInsightsView ──────────────────────────────────────────────────────
function LearningInsightsView() {
  const [data, setData] = useState<LearningInsights | null>(null);
  const [daysBack, setDaysBack] = useState(90);
  const [ticker, setTicker] = useState('');
  const [error, setError] = useState('');

  const loadInsights = async () => {
    setError('');
    const params = new URLSearchParams({ daysBack: String(daysBack) });
    if (ticker.trim()) params.set('ticker', ticker.trim().toUpperCase());
    try { setData(await getJson<LearningInsights>(`/api/snapshots/insights/learning?${params.toString()}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load learning insights'); }
  };
  useEffect(() => { loadInsights(); }, []);

  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Learning Insights</h3><p>How saved recommendations performed after you marked what you did.</p></div>
      </div>
      <div className="filter-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Ticker
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="All" style={{ width: 100 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Days
          <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={30}>30</option>
            <option value={90}>90</option>
            <option value={180}>180</option>
            <option value={365}>365</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={loadInsights}>Update</button>
      </div>
      {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}
      {!data ? (
        <div className="panel" style={{ color: 'var(--text-tertiary)' }}>Loading learning insights...</div>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric"><p>Overall accuracy</p><strong>{Math.round(data.overallWinRate)}%</strong></div>
            <div className="metric"><p>Avg return</p><strong>{data.avgReturn > 0 ? '+' : ''}{data.avgReturn.toFixed(1)}%</strong></div>
            <div className="metric"><p>High-quality win rate</p><strong>{Math.round(data.highQualityWinRate)}%</strong></div>
            <div className="metric"><p>Recent snapshots</p><strong>{data.recentSnapshots.length}</strong></div>
          </div>
          <div className="detail-grid">
            <article className="panel panel-sm">
              <h3>Score Calibration</h3>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>When the app scored a setup in each range, how often your recorded buys worked.</p>
              <div className="calibration-chart">
                {data.calibration.length ? data.calibration.map((bucket) => (
                  <div className="checklist-row" key={bucket.predictedRange}>
                    <div className="cl-label-row">
                      <span>Score {bucket.predictedRange}</span>
                      <b>{pctText(bucket.actualSuccessRate)}</b>
                    </div>
                    <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, bucket.actualSuccessRate))}%` }} /></div>
                  </div>
                )) : <p>Mark actions and outcomes to build calibration history.</p>}
              </div>
            </article>
            <article className="panel panel-sm">
              <h3>What the App Is Learning About You</h3>
              <div className="plain-list" style={{ marginTop: 'var(--space-3)' }}>
                {data.commonPatterns.length ? data.commonPatterns.map((p) => <span key={p}>{p}</span>) : <span>No patterns yet. Mark outcomes to build history.</span>}
              </div>
            </article>
          </div>
          <article className="panel panel-sm">
            <h3>Per-Ticker Performance</h3>
            <div className="table-panel flat" style={{ marginTop: 'var(--space-3)' }}>
              <table>
                <thead><tr><th>Ticker</th><th>Snapshots</th><th>Bought</th><th>Win rate</th><th>Avg return</th><th>High-quality</th></tr></thead>
                <tbody>
                  {(data.perTickerPerformance || []).map((row) => (
                    <tr key={row.ticker}>
                      <td><b>{row.ticker}</b></td>
                      <td>{row.snapshots}</td>
                      <td>{row.bought}</td>
                      <td>{pctText(row.winRate)}</td>
                      <td style={{ color: row.avgReturn >= 0 ? 'var(--green-text)' : 'var(--red-text)' }}>{row.avgReturn > 0 ? '+' : ''}{row.avgReturn.toFixed(1)}%</td>
                      <td>{pctText(row.highQualityWinRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!(data.perTickerPerformance || []).length && <div style={{ padding: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No snapshots in this period yet.</div>}
            </div>
          </article>
          <article className="panel panel-sm">
            <h3>Recent Recommendation Snapshots</h3>
            <div className="snapshot-timeline" style={{ marginTop: 'var(--space-3)' }}>
              {data.recentSnapshots.slice(0, 10).map((snap) => (
                <div className="snapshot-row" key={snap.id}>
                  <div className="snapshot-date">
                    <b>{snap.ticker}</b>
                    <span>{snap.snapshot_date?.slice(0, 10) || '--'}</span>
                  </div>
                  <span className={`score-mini ${scoreClass(snap.setup_quality)}`}>{snap.setup_quality}</span>
                  <div className="snapshot-main">
                    <b>{snap.recommended_action}</b>
                    <span>{formatMoney(snap.current_price)} · Buy {formatMoney(snap.buy_zone_low)} – {formatMoney(snap.buy_zone_high)}</span>
                  </div>
                  <div className="snapshot-outcome">
                    <span>{snap.user_action || 'Not marked'}</span>
                    <b>{snap.actual_outcome_pct != null ? `${snap.actual_outcome_pct > 0 ? '+' : ''}${snap.actual_outcome_pct.toFixed(1)}%` : '--'}</b>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </>
      )}
    </section>
  );
}

// ── Portfolio OS ──────────────────────────────────────────────────────────────

type PortfolioTab = 'overview' | 'holdings' | 'transactions' | 'import';

const PIE_PALETTE = [
  '#00C805', '#3B82F6', '#F5A623', '#8B5CF6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#a3a3a3',
];

// ── KPI summary card ──────────────────────────────────────────────────────────
function PortfolioKPI({ label, value, sub, up, accent }: {
  label: string; value: string; sub?: string;
  up?: boolean | null; accent?: 'green' | 'red' | 'blue' | 'gold';
}) {
  const color = accent === 'green' ? 'var(--green-text)'
    : accent === 'red'  ? 'var(--red-text)'
    : accent === 'gold' ? 'var(--gold-text)'
    : accent === 'blue' ? 'var(--blue-text)'
    : 'var(--text-primary)';
  return (
    <div className="panel" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 'var(--text-xs)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: up === true ? 'var(--green-text)' : up === false ? 'var(--red-text)' : 'var(--text-tertiary)' }}>
          {up === true && <TrendingUp size={12} />}{up === false && <TrendingDown size={12} />}{sub}
        </div>
      )}
    </div>
  );
}

// ── Allocation donut (recharts) ────────────────────────────────────────────────
function AllocationPie({ holdings, totalValue }: { holdings: PortfolioHolding[]; totalValue: number }) {
  if (!holdings.length || !totalValue) return (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>No holdings data yet</div>
  );
  const priced = holdings
    .filter(h => h.symbol !== 'CASH' && h.quantity > 0)
    .map(h => ({ symbol: h.symbol, value: h.quantity * (h.current_price ?? h.avg_cost_basis ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const top8 = priced.slice(0, 8);
  const otherVal = priced.slice(8).reduce((s, x) => s + x.value, 0);
  const data = [...top8, ...(otherVal > 0 ? [{ symbol: 'Other', value: otherVal }] : [])]
    .map(d => ({ ...d, pct: totalValue > 0 ? (d.value / totalValue * 100) : 0 }));
  const customTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const { symbol, value, pct } = payload[0].payload;
    return (
      <div style={{ background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--text-xs)' }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{symbol}</div>
        <div style={{ color: 'var(--text-secondary)' }}>{formatMoney(value)} · {pct.toFixed(1)}%</div>
      </div>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={2} dataKey="value">
          {data.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} stroke="transparent" />)}
        </Pie>
        <RCTooltip content={customTip} />
        <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{v}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Sortable holdings table ───────────────────────────────────────────────────
function HoldingsTable({ holdings, totalValue, onSelectTicker }: {
  holdings: PortfolioHolding[]; totalValue: number; onSelectTicker: (s: string) => void;
}) {
  type SK = 'symbol' | 'qty' | 'cost' | 'price' | 'pnl' | 'portpct' | 'score';
  const [sk, setSk] = useState<SK>('pnl');
  const [dir, setDir] = useState<1 | -1>(-1);
  const setSort = (k: SK) => { if (k === sk) setDir(d => (d === 1 ? -1 : 1)); else { setSk(k); setDir(-1); } };
  const sorted = [...holdings].sort((a, b) => {
    if (sk === 'symbol') return dir * a.symbol.localeCompare(b.symbol);
    const aVal = (h: PortfolioHolding) => h.quantity * (h.current_price ?? h.avg_cost_basis ?? 0);
    const pairs: Record<Exclude<SK, 'symbol'>, [number, number]> = {
      qty:     [a.quantity ?? 0,               b.quantity ?? 0],
      cost:    [a.avg_cost_basis ?? 0,          b.avg_cost_basis ?? 0],
      price:   [a.current_price ?? 0,           b.current_price ?? 0],
      pnl:     [a.unrealized_pnl_pct ?? -999,   b.unrealized_pnl_pct ?? -999],
      portpct: [totalValue > 0 ? aVal(a) / totalValue : 0, totalValue > 0 ? aVal(b) / totalValue : 0],
      score:   [a.score ?? -1,                  b.score ?? -1],
    };
    const [av, bv] = pairs[sk as Exclude<SK, 'symbol'>];
    return dir * (av - bv);
  });
  const SH = ({ k, label }: { k: SK; label: string }) => (
    <th onClick={() => setSort(k)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}{sk === k ? (dir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  );
  if (!holdings.length) return (
    <div className="panel" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
      No holdings yet. Go to the <b>Import</b> tab to upload your broker CSV.
    </div>
  );
  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <SH k="symbol"  label="Symbol" />
            <SH k="qty"     label="Qty" />
            <SH k="cost"    label="Avg Cost" />
            <SH k="price"   label="Current" />
            <SH k="pnl"     label="Unrealized P&L" />
            <SH k="portpct" label="% Portfolio" />
            <SH k="score"   label="KTrade View" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(h => {
            const mv = h.quantity * (h.current_price ?? h.avg_cost_basis ?? 0);
            const pp = totalValue > 0 ? (mv / totalValue * 100) : 0;
            const pnl = h.unrealized_pnl_pct;
            const pnlUp = pnl != null && pnl >= 0;
            const hasTicker = h.current_price != null;
            return (
              <tr key={h.symbol}
                onClick={() => hasTicker && onSelectTicker(h.symbol)}
                title={hasTicker ? `View ${h.symbol} in Ticker Detail` : undefined}
                style={{ cursor: hasTicker ? 'pointer' : 'default' }}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{h.symbol}</b>
                    {hasTicker && <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>›</span>}
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{h.quantity?.toFixed(h.quantity % 1 ? 4 : 0)}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{h.avg_cost_basis ? formatMoney(h.avg_cost_basis) : '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{h.current_price ? formatMoney(h.current_price) : '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', color: pnl == null ? 'var(--text-tertiary)' : pnlUp ? 'var(--green-text)' : 'var(--red-text)' }}>
                  {pnl != null ? `${pnlUp ? '+' : ''}${pnl.toFixed(1)}%` : '—'}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{pp > 0 ? `${pp.toFixed(1)}%` : '—'}</td>
                <td>{h.decision ? <DecisionPill decision={h.decision} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Transaction history with filters ─────────────────────────────────────────
function PortfolioTransactions() {
  const [txns, setTxns] = useState<PortfolioTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [sym, setSym] = useState('');
  const [txType, setTxType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const load = async (filters: TransactionFilters = {}) => {
    setLoading(true);
    try { setTxns(await getTransactions(filters)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const apply = () => load({ symbol: sym || undefined, type: txType as any || undefined, dateFrom: fromDate || undefined });
  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <div className="panel">
        <h3 style={{ marginBottom: 'var(--space-3)' }}>Filter Transactions</h3>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Symbol</label>
            <input placeholder="e.g. AAPL" value={sym} onChange={e => setSym(e.target.value.toUpperCase())} style={{ width: 100 }} onKeyDown={e => e.key === 'Enter' && apply()} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Type</label>
            <select value={txType} onChange={e => setTxType(e.target.value)} style={{ background: 'var(--bg-surface-3)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '6px 8px', fontSize: 'var(--text-sm)' }}>
              <option value="">All types</option>
              {['Buy', 'Sell', 'Dividend', 'Interest', 'Transfer', 'Other'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>From date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ background: 'var(--bg-surface-3)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '6px 8px', fontSize: 'var(--text-sm)' }} />
          </div>
          <button className="btn btn-primary" onClick={apply}><Search size={14} />Apply</button>
        </div>
      </div>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)', padding: 40 }}>
          <RefreshCw size={18} className="spinning" />Loading transactions…
        </div>
      ) : txns.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>No transactions found. Import a broker CSV to get started.</div>
      ) : (
        <div className="table-panel">
          <div style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>{txns.length} transactions</div>
          <table>
            <thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>Amount</th><th>Broker</th></tr></thead>
            <tbody>
              {txns.map(t => {
                const tColor = t.type === 'Buy' ? 'var(--green-text)' : t.type === 'Sell' ? 'var(--red-text)' : t.type === 'Dividend' ? 'var(--blue-text)' : 'var(--text-secondary)';
                return (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{t.transaction_date ?? '—'}</td>
                    <td><b>{t.symbol ?? '—'}</b></td>
                    <td><span style={{ color: tColor, fontWeight: 600, fontSize: 'var(--text-xs)' }}>{t.type ?? '—'}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{t.quantity != null ? (t.quantity % 1 ? t.quantity.toFixed(4) : t.quantity.toFixed(0)) : '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{t.price ? formatMoney(t.price) : '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: t.amount != null ? (t.amount >= 0 ? 'var(--green-text)' : 'var(--red-text)') : undefined }}>
                      {t.amount != null ? formatMoney(Math.abs(t.amount)) : '—'}
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.broker}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Multi-file import panel ───────────────────────────────────────────────────
interface FilePreview {
  file: File; broker: string; count: number;
  symbols: string[]; dateRange: string; parsed: ParsedTransaction[];
}

function PortfolioImportPanel({ onImportComplete }: { onImportComplete: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    setResult(null); setError('');
    const ps: FilePreview[] = [];
    for (const f of files) {
      const text = await f.text();
      const et = parseEtradeCSV(text, f.name);
      const rh = parseRobinhoodCSV(text, f.name);
      const parsed = et.length >= rh.length ? et : rh;
      const broker = et.length >= rh.length ? 'E*TRADE' : 'Robinhood';
      const syms = [...new Set(parsed.map(t => t.symbol))].filter(Boolean).sort();
      const dates = parsed.map(t => t.transaction_date).filter(Boolean).sort();
      const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—';
      ps.push({ file: f, broker: parsed.length ? broker : 'Unknown', count: parsed.length, symbols: syms, dateRange, parsed });
    }
    setPreviews(ps);
  };

  const doImport = async () => {
    setImporting(true); setError('');
    try {
      const res = await importPortfolioFiles(previews.map(p => p.file));
      setResult(res);
      onImportComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally { setImporting(false); }
  };

  const clear = () => { setPreviews([]); setResult(null); setError(''); };
  const totalTxns = previews.reduce((s, p) => s + p.count, 0);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <div className="panel">
        <h3>Supported Brokers</h3>
        <div className="broker-chips">
          {['Robinhood CSV', 'E*TRADE CSV'].map(b => <span key={b} className="broker-chip">{b}</span>)}
        </div>
        <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          All data stays on your machine. Files are parsed locally; only the parsed transactions reach the local backend.
        </p>
      </div>

      {/* Drop zone */}
      {!previews.length && !result && (
        <div
          className={`upload-zone${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
            if (files.length) processFiles(files);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={40} style={{ color: dragOver ? 'var(--green-text)' : 'var(--text-tertiary)' }} />
          <div className="upload-title">Drop one or more CSV files here</div>
          <div className="upload-sub">Supports multiple files · or click to browse</div>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
            onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) processFiles(files); e.target.value = ''; }} />
        </div>
      )}

      {/* Preview */}
      {previews.length > 0 && !result && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Preview — {previews.length} file{previews.length > 1 ? 's' : ''}</h3>
            <button className="btn btn-ghost btn-sm" onClick={clear}>✕ Clear</button>
          </div>
          <div className="table-panel">
            <table>
              <thead><tr><th>File</th><th>Broker</th><th>Transactions</th><th>Date Range</th><th>Symbols detected</th></tr></thead>
              <tbody>
                {previews.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file.name}</td>
                    <td><span className="broker-chip">{p.broker}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{p.count}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{p.dateRange}</td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.symbols.slice(0, 8).join(', ')}{p.symbols.length > 8 ? ` +${p.symbols.length - 8} more` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sample rows from first file */}
          {previews[0]?.parsed.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 600 }}>Sample — first 10 transactions</div>
              <div className="table-panel">
                <table>
                  <thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>Broker</th></tr></thead>
                  <tbody>
                    {previews[0].parsed.slice(0, 10).map((t, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{t.transaction_date}</td>
                        <td><b>{t.symbol}</b></td>
                        <td style={{ color: t.type === 'Buy' ? 'var(--green-text)' : t.type === 'Sell' ? 'var(--red-text)' : 'var(--text-secondary)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>{t.type}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{t.quantity % 1 ? t.quantity.toFixed(4) : t.quantity.toFixed(0)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{t.price ? formatMoney(t.price) : '—'}</td>
                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.broker}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={clear}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importing || totalTxns === 0}>
              {importing ? <RefreshCw size={16} className="spinning" /> : <Upload size={16} />}
              {importing ? 'Importing…' : `Import ${totalTxns} transactions`}
            </button>
          </div>
        </>
      )}

      {/* Success result */}
      {result && (
        <div className="panel" style={{ borderColor: 'var(--green-dim)', background: 'var(--green-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={20} style={{ color: 'var(--green-text)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, color: 'var(--green-text)' }}>Import complete</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
                {result.success} transactions saved · {result.failed} skipped
                {result.newHoldings.length > 0 && ` · New positions: ${result.newHoldings.join(', ')}`}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={clear}>Import more files</button>
        </div>
      )}
    </div>
  );
}

// ── Portfolio overview tab ────────────────────────────────────────────────────
function PortfolioOverviewTab({ holdings, summary }: { holdings: PortfolioHolding[]; summary: PortfolioSummary | null }) {
  if (!summary || summary.totalCost === 0) return (
    <div className="panel" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-8)' }}>
      No holdings yet. Go to the <b>Import</b> tab to upload your broker CSV.
    </div>
  );
  const plUp = summary.unrealizedPL >= 0;
  const ranked = holdings.filter(h => h.symbol !== 'CASH' && h.quantity > 0);
  const topGainer = [...ranked].sort((a, b) => (b.unrealized_pnl_pct ?? -999) - (a.unrealized_pnl_pct ?? -999))[0];
  const topLoser  = [...ranked].sort((a, b) => (a.unrealized_pnl_pct ?? 999) - (b.unrealized_pnl_pct ?? 999))[0];
  const topPick   = [...ranked].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).find(h => h.score != null);
  const buyReady  = ranked.filter(h => (h.decision ?? '').toLowerCase().includes('buy')).length;
  const atRisk    = ranked.filter(h => h.unrealized_pnl_pct != null && h.unrealized_pnl_pct < -15).length;
  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <PortfolioKPI label="Total Value"    value={formatMoney(summary.totalValue)}   sub={`Cost basis ${formatMoney(summary.totalCost)}`} accent="blue" />
        <PortfolioKPI label="Unrealized P&L" value={formatMoney(summary.unrealizedPL)} sub={`${plUp ? '+' : ''}${summary.unrealizedPLPercent.toFixed(1)}% overall`} up={plUp} accent={plUp ? 'green' : 'red'} />
        <PortfolioKPI label="Cash / Other"   value={formatMoney(summary.cashBalance)}  accent="gold" />
        <PortfolioKPI label="Holdings"       value={String(ranked.length)}             sub={`${buyReady} in Buy range`} accent="blue" />
      </div>

      {/* Chart + insights row */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className="panel" style={{ flex: '2 1 300px' }}>
          <h3 style={{ marginBottom: 'var(--space-3)' }}>Allocation</h3>
          <AllocationPie holdings={holdings} totalValue={summary.totalValue} />
        </div>
        <div className="panel" style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3>Quick Insights</h3>
          {topGainer && topGainer.unrealized_pnl_pct != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Top Gainer</div><div style={{ fontWeight: 700 }}>{topGainer.symbol}</div></div>
              <span style={{ color: 'var(--green-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>+{topGainer.unrealized_pnl_pct.toFixed(1)}%</span>
            </div>
          )}
          {topLoser && topLoser.symbol !== topGainer?.symbol && topLoser.unrealized_pnl_pct != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Biggest Drag</div><div style={{ fontWeight: 700 }}>{topLoser.symbol}</div></div>
              <span style={{ color: 'var(--red-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{topLoser.unrealized_pnl_pct.toFixed(1)}%</span>
            </div>
          )}
          {topPick && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Top KTrade Score</div><div style={{ fontWeight: 700 }}>{topPick.symbol}</div></div>
              <span className={`score-chip ${scoreClass(topPick.score ?? undefined)}`}>{topPick.score}</span>
            </div>
          )}
          {atRisk > 0 && (
            <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--red-muted)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <ShieldAlert size={14} style={{ color: 'var(--red-text)', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--red-text)' }}>{atRisk} position{atRisk > 1 ? 's' : ''} down more than 15%</span>
            </div>
          )}
          {!topGainer && !topPick && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Run Refresh to get engine scores for your holdings.</div>
          )}
        </div>
      </div>

      {/* Performance placeholder */}
      <div className="panel" style={{ background: 'var(--bg-surface-3)', padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            <b style={{ color: 'var(--text-secondary)' }}>Performance chart</b> — historical portfolio value tracking coming in a future update.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Root Portfolio OS container ───────────────────────────────────────────────
function PortfolioOS({ onSelectTicker }: { onSelectTicker: (symbol: string) => void }) {
  const [tab, setTab] = useState<PortfolioTab>('overview');
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const reload = async () => {
    setLoadingData(true);
    try {
      const [h, s] = await Promise.all([getAllHoldings(), getPortfolioSummary()]);
      setHoldings(h); setSummary(s);
    } finally { setLoadingData(false); }
  };

  useEffect(() => { reload(); }, []);

  const TABS: Array<{ t: PortfolioTab; label: string }> = [
    { t: 'overview', label: 'Overview' }, { t: 'holdings', label: 'Holdings' },
    { t: 'transactions', label: 'Transactions' }, { t: 'import', label: 'Import' },
  ];

  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Portfolio OS</h3><p>Track holdings, P&L, and get KTrade recommendations for every position</p></div>
        <button className="btn btn-ghost btn-sm" onClick={reload}>
          <RefreshCw size={14} className={loadingData ? 'spinning' : ''} />Reload
        </button>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-surface-2)', borderRadius: 10, width: 'fit-content', border: '1px solid var(--border-subtle)' }}>
        {TABS.map(({ t, label }) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            background: tab === t ? 'var(--bg-surface-4)' : 'transparent',
            color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: tab === t ? 600 : 400, cursor: 'pointer',
            fontSize: 'var(--text-sm)', transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      {loadingData && (tab === 'overview' || tab === 'holdings') ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)', padding: 40 }}>
          <RefreshCw size={18} className="spinning" /> Loading portfolio…
        </div>
      ) : (
        <>
          {tab === 'overview'     && <PortfolioOverviewTab holdings={holdings} summary={summary} />}
          {tab === 'holdings'     && <HoldingsTable holdings={holdings} totalValue={summary?.totalValue ?? 0} onSelectTicker={onSelectTicker} />}
          {tab === 'transactions' && <PortfolioTransactions />}
          {tab === 'import'       && <PortfolioImportPanel onImportComplete={() => { reload(); setTab('holdings'); }} />}
        </>
      )}
    </section>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────
function SettingsView() {
  const [positions, setPositions] = useState<any>(null);
  const [settings, setSettings] = useState<{ show_beginner_price_help: boolean; enable_portfolio_os: boolean } | null>(null);
  const [form, setForm] = useState({ ticker: '', shares: '', cost: '', theme: '' });

  const load = async () => {
    setPositions(await getJson('/api/positions'));
    setSettings(await getJson('/api/settings'));
  };
  useEffect(() => { load(); }, []);

  const savePosition = async () => {
    await sendJson('/api/positions', { ticker: form.ticker, shares: Number(form.shares), cost: Number(form.cost), theme: form.theme || 'General' });
    setForm({ ticker: '', shares: '', cost: '', theme: '' });
    await load();
  };

  return (
    <section className="stack">
      <div className="section-head">
        <div><h3>Settings</h3><p>App preferences and manual portfolio input</p></div>
      </div>

      <div className="panel">
        <h3>Display Options</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 4 }}>Show educational help icons</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Hover tooltips on price levels, zones, and signals. Turn off once you know the terms.</div>
          </div>
          <label className="toggle setting-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings?.show_beginner_price_help)}
              onChange={async (e) => {
                const next = e.target.checked;
                setSettings(s => s ? { ...s, show_beginner_price_help: next } : s);
                await sendJson('/api/settings/show_beginner_price_help', { value: String(next) }, 'PATCH');
              }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 4 }}>Enable Portfolio Operating System</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Unlock the Portfolio OS tab to import broker CSV exports (Robinhood, E*Trade), track your holdings,
              and get hold/sell recommendations based on current engine scores. Off by default.
            </div>
          </div>
          <label className="toggle setting-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings?.enable_portfolio_os)}
              onChange={async (e) => {
                const next = e.target.checked;
                setSettings(s => s ? { ...s, enable_portfolio_os: next } : s);
                await sendJson('/api/settings/enablePortfolioOS', { value: String(next) }, 'PATCH');
                // Reload the page so the nav tab appears/disappears immediately
                window.location.reload();
              }}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>Manual Portfolio Input</h3>
        <p style={{ marginBottom: 'var(--space-4)' }}>Add positions manually for concentration warnings. For full analysis, use the Portfolio Upload tab.</p>
        <div className="form-row">
          <input placeholder="Ticker" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} style={{ maxWidth: 100 }} />
          <input placeholder="Shares" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} style={{ maxWidth: 100 }} />
          <input placeholder="Cost basis" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} style={{ maxWidth: 120 }} />
          <input placeholder="Theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} style={{ maxWidth: 140 }} />
          <button className="btn btn-primary" onClick={savePosition}><Briefcase size={16} />Save</button>
        </div>
      </div>

      {(positions?.warnings || []).length > 0 && (
        <div className="panel">
          <h3>Concentration Warnings</h3>
          {positions.warnings.map((w: string) => (
            <div key={w} className="alert" style={{ marginTop: 'var(--space-2)' }}><ShieldAlert size={16} />{w}</div>
          ))}
        </div>
      )}

      <div className="panel">
        <h3>About This App</h3>
        <p>KTrade Advisor is a local, offline-first decision support tool. All data stays on your machine. No account, no cloud sync, no subscription.</p>
        <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Scores use setup quality, risk level, distance to buy zone, and multi-factor technical signals. They are decision aids — not financial advice, not guarantees.
        </p>
      </div>
    </section>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [page, setPage] = useState<Page>(
    window.location.pathname === '/learning-insights' ? 'learningInsights' : 'dashboard'
  );
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const load = async () => {
    setError('');
    setLoading(true);
    try { setDashboard(await getJson<Dashboard>('/api/dashboard')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load app data'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    if (window.localStorage.getItem('ktrade_onboarding_seen') !== 'true') setShowGuide(true);
  }, []);

  const refresh = async () => {
    setRefreshing(true); setError(''); setToast('');
    try {
      const result = await sendJson<{ snapshots_saved?: number }>('/api/refresh');
      if (result.snapshots_saved) {
        setToast(`Snapshot saved for ${result.snapshots_saved} ticker${result.snapshots_saved === 1 ? '' : 's'}.`);
        window.setTimeout(() => setToast(''), 4200);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally { setRefreshing(false); }
  };

  const { marketOpen, formatCountdown } = useAutoRefresh(refresh);

  const onTrack = async (symbol: string) => {
    await sendJson(`/api/snapshots/${encodeURIComponent(symbol)}/track-current`);
    setToast(`Snapshot saved for ${symbol}.`);
    window.setTimeout(() => setToast(''), 3000);
  };

  const goToTicker = (symbol: string) => {
    setSelectedTicker(symbol);
    setPage('ticker');
  };

  const cards = dashboard?.cards ?? [];
  const showHelp = dashboard?.settings?.show_beginner_price_help ?? true;
  const portfolioOSEnabled = dashboard?.settings?.enable_portfolio_os ?? false;

  // Market label → regime class
  const marketLabel = (dashboard?.market.label || '').toLowerCase();
  const regimeClass = marketLabel.includes('bull') || marketLabel.includes('health') ? 'healthy'
    : marketLabel.includes('bear') || marketLabel.includes('weak') || marketLabel.includes('risk') ? 'risk-off'
    : 'caution';

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><LineChart size={20} /></div>
          <div>
            <h1>KTrade Advisor</h1>
            <p>Local decision support</p>
          </div>
        </div>
        <nav>
          <NavButton page="dashboard" current={page} setPage={setPage} icon={<Activity size={16} />} label="Dashboard" />
          <NavButton page="watchlists" current={page} setPage={setPage} icon={<ListPlus size={16} />} label="Watchlists" />
          <NavButton page="ticker" current={page} setPage={setPage} icon={<Search size={16} />} label="Ticker Detail" />
          <NavButton page="research" current={page} setPage={setPage} icon={<BookOpen size={16} />} label="Research Signal" />
          {portfolioOSEnabled && (
            <NavButton page="portfolio" current={page} setPage={setPage} icon={<Upload size={16} />} label="Portfolio OS" />
          )}
          <NavButton page="history" current={page} setPage={setPage} icon={<History size={16} />} label="History" />
          <NavButton page="learningInsights" current={page} setPage={setPage} icon={<Target size={16} />} label="Learning" />
          <NavButton page="settings" current={page} setPage={setPage} icon={<Settings size={16} />} label="Settings" />
        </nav>
        <p className="disclaimer">Decision support only. Not financial advice.</p>
      </aside>

      {/* Main */}
      <main>
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <span className={`market-regime ${regimeClass}`}>
              <span className="regime-dot" />
              {dashboard?.market.label ?? (loading ? 'Loading…' : 'Market')}
            </span>
          </div>
          <div className="topbar-right">
            {/* Auto-refresh badge */}
            <span className={`auto-refresh-badge ${marketOpen ? 'market-open' : ''}`}>
              <span className="refresh-pulse" />
              {marketOpen ? `Auto-refresh in ${formatCountdown()}` : 'Market closed · manual only'}
            </span>
            {/* Manual refresh */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={refresh}
              disabled={refreshing}
              title="Refresh all data now"
            >
              <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowGuide(true)}>Guide</button>
          </div>
        </header>

        {/* Page content */}
        <div className="content">
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-tertiary)', gap: 12 }}>
              <RefreshCw size={20} className="spinning" /> Loading...
            </div>
          )}
          {error && !loading && <div className="alert" style={{ marginBottom: 'var(--space-5)' }}><ShieldAlert size={16} />{error}</div>}

          {!loading && page === 'dashboard' && (
            <DashboardView cards={cards} watchlists={dashboard?.watchlists ?? []} news={dashboard?.news.latest ?? []} showHelp={showHelp} onSelect={goToTicker} onTrack={onTrack} />
          )}
          {page === 'watchlists' && <WatchlistsView reload={load} />}
          {page === 'ticker' && <TickerView symbol={selectedTicker} setSymbol={setSelectedTicker} />}
          {page === 'research' && <ResearchView />}
          {page === 'portfolio' && portfolioOSEnabled && <PortfolioOS onSelectTicker={goToTicker} />}
          {page === 'history' && <HistoryView />}
          {page === 'learningInsights' && <LearningInsightsView />}
          {page === 'settings' && <SettingsView />}
        </div>
      </main>

      {showGuide && <FirstRunGuide onClose={() => setShowGuide(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
