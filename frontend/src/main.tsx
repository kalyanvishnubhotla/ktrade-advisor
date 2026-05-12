import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorType, createChart, LineSeries, LineStyle } from 'lightweight-charts';
import { PieChart, Pie, Cell, Tooltip as RCTooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  Activity,
  AlertTriangle,
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
import { getAllHoldings, getPortfolioSummary, getTransactions, refreshPortfolioSignals } from './services/portfolioService';
import type { PortfolioHolding, PortfolioSummary, PortfolioTransaction, TransactionFilters } from './services/portfolioService';
import { importPortfolioFiles, parsePDFStatement, parseEtradeCSV, parseRobinhoodCSV } from './services/portfolioImportService';
import type { ParsedTransaction, ImportResult, PDFParseResult } from './services/portfolioImportService';

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
  const [backtestingEnabled, setBacktestingEnabled] = useState(false);
  // Snapshot IDs already registered in the Backtesting module — used elsewhere to
  // gate a future "Already tracking" pill on past snapshots.
  const [accuracyTrackedIds, setAccuracyTrackedIds] = useState<Set<number>>(new Set());

  // Pull settings once so we know whether to render the "Track for accuracy" CTA
  useEffect(() => {
    getJson<{ enable_backtesting_accuracy: boolean }>('/api/settings')
      .then(s => setBacktestingEnabled(Boolean(s.enable_backtesting_accuracy)))
      .catch(() => {});
  }, []);

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

      // Sync which snapshots are already being tracked for accuracy
      if (backtestingEnabled) {
        try {
          const tracked = await listDecisions();
          setAccuracyTrackedIds(new Set(tracked.map(d => d.snapshot_id)));
        } catch { /* feature disabled or backend issue — silent */ }
      }
    } catch {
      setError('Ticker not found in any watchlist. Add it first, then refresh.');
      setDetail(null); setSnapshots([]);
    }
  };

  useEffect(() => { load(symbol); }, [symbol, backtestingEnabled]);

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
              {/*
                Single "Track this decision" button. Always saves a snapshot.
                When the Backtesting & Accuracy module is enabled, the same click
                also registers the snapshot as a tracked decision so the Accuracy
                tab follows the outcome automatically — no duplicate UI.
              */}
              <button
                className="track-btn"
                disabled={tracking || !score || !indicators?.price}
                onClick={async () => {
                  if (!detail) return;
                  setTracking(true); setStatus('');
                  try {
                    await sendJson(`/api/snapshots/${encodeURIComponent(detail.ticker.symbol)}/track-current`);
                    if (backtestingEnabled) {
                      const latest = await getJson<RecommendationSnapshot[]>(`/api/snapshots/${detail.ticker.symbol}?limit=1`);
                      if (latest.length) {
                        try {
                          const newDecision = await btTrackDecision(latest[0].id);
                          setAccuracyTrackedIds(prev => new Set(prev).add(newDecision.snapshot_id));
                          setStatus(`Tracking ${detail.ticker.symbol} — open the Accuracy tab to follow the outcome.`);
                        } catch {
                          setStatus('Snapshot saved. (Already tracked for accuracy or backend unavailable.)');
                        }
                      } else {
                        setStatus('Snapshot saved.');
                      }
                    } else {
                      setStatus('Snapshot saved. This helps the app learn over time.');
                    }
                    await load(detail.ticker.symbol);
                  } finally { setTracking(false); }
                }}
                title={backtestingEnabled
                  ? 'Save a snapshot and start tracking how the call plays out in the Accuracy tab.'
                  : 'Save a point-in-time snapshot of this recommendation. Mark the outcome later to build your learning history.'}
              >
                <Clock size={14} />{tracking ? 'Tracking…' : 'Track this decision'}
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

/**
 * Translate the engine's decision + score into calm, beginner-friendly
 * portfolio language (you already own this stock — context matters).
 */
function portfolioAction(decision: string | null | undefined, score: number | null | undefined, distToBuyZone?: number | null): string {
  if (!decision) return 'No signal yet';
  const d = decision.toLowerCase();
  const s = score ?? 0;
  const dist = distToBuyZone ?? 100;
  if (d.includes('buy') || (d.includes('wait') && dist <= 3)) {
    return s >= 70 ? 'Strong — could add more' : 'Near your entry zone';
  }
  if (d.includes('wait')) return dist <= 10 ? 'Getting close to entry' : 'Hold — wait for a pullback';
  if (d.includes('watch')) return 'Keep holding — watching';
  if (d.includes('avoid')) return 'Worth reviewing';
  if (d.includes('hold')) return 'Keep holding';
  return decision;
}

/** Plain-text note about how far the stock is from its buy zone. */
function buyZoneHint(dist: number | null | undefined): string | null {
  if (dist == null) return null;
  if (dist <= 0) return 'In buy zone now';
  if (dist <= 4) return `${dist.toFixed(1)}% above entry`;
  if (dist <= 12) return `${dist.toFixed(0)}% from entry`;
  return null;   // too far — no hint
}

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
    <div style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-8)', color: 'var(--text-tertiary)' }}>
      <Briefcase size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
      <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>No holdings yet</div>
      <div style={{ fontSize: 'var(--text-sm)' }}>Go to the <b style={{ color: 'var(--text-primary)' }}>Import</b> tab to upload your first broker CSV.</div>
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
            const hasSignal = h.score != null || h.decision != null;
            const hint = buyZoneHint(h.distance_to_buy_zone);
            return (
              <tr key={h.symbol}
                onClick={() => hasTicker && onSelectTicker(h.symbol)}
                title={hasTicker ? `View ${h.symbol} in Ticker Detail` : undefined}
                style={{ cursor: hasTicker ? 'pointer' : 'default' }}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{h.symbol}</b>
                    {h.theme && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-surface-4)', padding: '1px 5px', borderRadius: 4 }}>{h.theme}</span>}
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
                {/* KTrade View — score badge + action + buy zone hint */}
                <td>
                  {hasSignal ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {h.score != null && (
                          <span className={`score-chip ${scoreClass(h.score)}`} style={{ fontSize: 11 }}>{h.score}</span>
                        )}
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {portfolioAction(h.decision, h.score, h.distance_to_buy_zone)}
                        </span>
                      </div>
                      {hint && (
                        <span style={{ fontSize: 10, color: h.distance_to_buy_zone != null && h.distance_to_buy_zone <= 0 ? 'var(--green-text)' : 'var(--gold-text)' }}>
                          {hint}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Run Refresh Signals</span>
                  )}
                </td>
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
  file: File;
  broker: string;
  count: number;
  symbols: string[];
  dateRange: string;
  parsed: ParsedTransaction[];
  // PDF-specific extras
  isPDF?: boolean;
  statementPeriod?: string;
  accountNumber?: string;
  totalValue?: number | null;
  currentHoldings?: PDFParseResult['holdings'];
  pdfWarnings?: string[];
  parsing?: boolean;   // true while backend is processing
  parseError?: string;
}

function PortfolioImportPanel({ onImportComplete }: { onImportComplete: (result: ImportResult) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [showExportHelp, setShowExportHelp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    setResult(null); setError('');
    const ps: FilePreview[] = [];

    for (const f of files) {
      const isPDF = f.name.toLowerCase().endsWith('.pdf');

      if (isPDF) {
        // Show a "parsing…" placeholder immediately, then fill in the result
        const placeholder: FilePreview = {
          file: f, broker: 'E*TRADE', count: 0, symbols: [], dateRange: '—',
          parsed: [], isPDF: true, parsing: true,
        };
        ps.push(placeholder);
        setPreviews([...ps]);  // show loading state right away

        try {
          const pdfResult = await parsePDFStatement(f);
          const txns = pdfResult.transactions;
          const syms = [...new Set(txns.map(t => t.symbol))].filter(s => s !== 'CASH').sort();
          const dates = txns.map(t => t.transaction_date).filter(Boolean).sort();
          Object.assign(placeholder, {
            count: txns.length,
            symbols: syms,
            dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—',
            parsed: txns,
            parsing: false,
            statementPeriod: pdfResult.metadata.statement_period,
            accountNumber: pdfResult.metadata.account_number,
            totalValue: pdfResult.metadata.total_value,
            currentHoldings: pdfResult.holdings,
            pdfWarnings: pdfResult.warnings,
          });
        } catch (e) {
          Object.assign(placeholder, {
            parsing: false,
            parseError: e instanceof Error ? e.message : 'PDF parse failed',
          });
        }
        setPreviews([...ps]);
      } else {
        // CSV: client-side parsing
        const text = await f.text();
        const et = parseEtradeCSV(text, f.name);
        const rh = parseRobinhoodCSV(text, f.name);
        const parsed = et.length >= rh.length ? et : rh;
        const broker = et.length >= rh.length ? 'E*TRADE' : 'Robinhood';
        const finalBroker = parsed.length ? broker : 'Unknown — check format';
        const syms = [...new Set(parsed.map(t => t.symbol))].filter(Boolean).sort();
        const dates = parsed.map(t => t.transaction_date).filter(Boolean).sort();
        const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—';
        ps.push({ file: f, broker: finalBroker, count: parsed.length, symbols: syms, dateRange, parsed });
        setPreviews([...ps]);
      }
    }
  };

  const doImport = async () => {
    setImporting(true); setError('');
    try {
      const res = await importPortfolioFiles(previews.map(p => p.file));
      setResult(res);
      onImportComplete(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally { setImporting(false); }
  };

  const clear = () => { setPreviews([]); setResult(null); setError(''); };
  const totalTxns = previews.reduce((s, p) => s + p.count, 0);
  const unknownFiles = previews.filter(p => p.broker.startsWith('Unknown'));

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {/* Broker info + export help */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h3>Supported Brokers</h3>
            <div className="broker-chips" style={{ marginTop: 'var(--space-2)' }}>
              {['Robinhood CSV', 'E*TRADE PDF', 'E*TRADE CSV'].map(b => <span key={b} className="broker-chip">{b}</span>)}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowExportHelp(h => !h)}
          >
            {showExportHelp ? 'Hide' : 'How to export →'}
          </button>
        </div>

        {showExportHelp && (
          <div style={{ marginTop: 'var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
            {[
              {
                broker: 'Robinhood',
                steps: [
                  'Go to robinhood.com → Account (top right)',
                  'Click History → Brokerage → set "All time"',
                  'Click Download CSV (buys, sells, dividends)',
                  'Repeat for each account, then drop below',
                ],
              },
              {
                broker: 'E*TRADE (PDF)',
                steps: [
                  'Log in at etrade.com',
                  'Go to Accounts → Documents → Statements',
                  'Open any monthly statement PDF',
                  'Download and drop the PDF directly below',
                ],
              },
            ].map(({ broker, steps }) => (
              <div key={broker} style={{ background: 'var(--bg-surface-3)', borderRadius: 10, padding: 'var(--space-4)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>{broker}</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                  {steps.map(s => <li key={s}>{s}</li>)}
                </ol>
              </div>
            ))}
          </div>
        )}

        <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          PDFs are parsed on your local backend — nothing leaves your Mac.
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
            const files = Array.from(e.dataTransfer.files).filter(f =>
              f.name.endsWith('.csv') || f.name.toLowerCase().endsWith('.pdf')
            );
            if (files.length) processFiles(files);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={40} style={{ color: dragOver ? 'var(--green-text)' : 'var(--text-tertiary)' }} />
          <div className="upload-title">Drop CSV or PDF files here</div>
          <div className="upload-sub">Robinhood CSV · E*TRADE PDF or CSV · multiple files OK</div>
          <input ref={fileRef} type="file" accept=".csv,.pdf" multiple style={{ display: 'none' }}
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
                    <td>
                      <span className="broker-chip">{p.broker}</span>
                      {p.isPDF && p.statementPeriod && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 6 }}>{p.statementPeriod}</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {p.parsing ? <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Parsing…</span> : p.count}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{p.dateRange}</td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.parseError
                        ? <span style={{ color: 'var(--red-text)' }}>⚠ {p.parseError}</span>
                        : p.symbols.length > 0
                          ? `${p.symbols.slice(0, 8).join(', ')}${p.symbols.length > 8 ? ` +${p.symbols.length - 8} more` : ''}`
                          : '—'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PDF-specific: current holdings snapshot */}
          {previews.some(p => p.isPDF && (p.currentHoldings?.length ?? 0) > 0) && (
            <div className="panel" style={{ background: 'var(--bg-surface-2)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                📋 Current holdings in this statement
              </div>
              <div className="table-panel">
                <table>
                  <thead><tr><th>Symbol</th><th>Company</th><th>Qty</th><th>Price</th><th>Cost Basis</th><th>Mkt Value</th><th>Unrealized G/L</th></tr></thead>
                  <tbody>
                    {previews.flatMap(p => p.currentHoldings ?? []).map((h, i) => (
                      <tr key={i}>
                        <td><b>{h.symbol}</b></td>
                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{h.company}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.quantity.toLocaleString()}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.share_price ? formatMoney(h.share_price) : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.total_cost ? formatMoney(h.total_cost) : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.market_value ? formatMoney(h.market_value) : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (h.unrealized_gl ?? 0) >= 0 ? 'var(--green-text)' : 'var(--red-text)', fontWeight: 600 }}>
                          {h.unrealized_gl != null ? `${h.unrealized_gl >= 0 ? '+' : ''}${formatMoney(h.unrealized_gl)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PDF parse warnings */}
          {previews.some(p => (p.pdfWarnings?.length ?? 0) > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {previews.flatMap(p => p.pdfWarnings ?? []).map((w, i) => (
                <div key={i} className="alert" style={{ background: 'var(--gold-muted)', borderColor: 'var(--gold-dim)', color: 'var(--gold-text)' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />{w}
                </div>
              ))}
            </div>
          )}

          {/* Sample rows from first file */}
          {previews[0]?.parsed.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Sample — first 10 transactions
              </div>
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

          {unknownFiles.length > 0 && (
            <div className="alert" style={{ background: 'var(--gold-muted)', borderColor: 'var(--gold-dim)', color: 'var(--gold-text)' }}>
              <ShieldAlert size={16} />
              {unknownFiles.length === 1 ? `"${unknownFiles[0].file.name}"` : `${unknownFiles.length} files`} couldn't be recognised. Make sure you exported a <b>Transaction History</b> CSV (not a positions or balance CSV).
            </div>
          )}
          {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', alignItems: 'center' }}>
            {importing && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Saving transactions and recalculating holdings…</span>}
            <button className="btn btn-ghost" onClick={clear} disabled={importing}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importing || totalTxns === 0}>
              {importing ? <RefreshCw size={16} className="spinning" /> : <Upload size={16} />}
              {importing ? 'Importing…' : `Import ${totalTxns} transaction${totalTxns !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {/* Success result — stays visible so user can confirm, then import more */}
      {result && !result.hasBuys && (
        // No purchase transactions — show actionable warning
        <div className="panel" style={{ borderColor: 'var(--gold-dim)', background: 'var(--gold-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertTriangle size={20} style={{ color: 'var(--gold-text)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, color: 'var(--gold-text)', marginBottom: 4 }}>No purchase transactions found</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                We saved <b>{result.success}</b> record{result.success !== 1 ? 's' : ''} (dividends/interest), but found no buy or sell transactions.
                Without purchases, we can't calculate your cost basis or P&L.
              </div>
              {result.divSymbols.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>Positions detected from dividends: </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {result.divSymbols.join(', ')}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 'var(--space-4)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 'var(--space-3)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 6 }}>How to get your full trade history from Robinhood:</div>
                <ol style={{ margin: 0, paddingLeft: 16, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 2 }}>
                  <li>Open <b>robinhood.com</b> → Account (top right)</li>
                  <li>Go to <b>History</b> → <b>Brokerage</b></li>
                  <li>Set date range to <b>"All time"</b></li>
                  <li>Click <b>Download CSV</b> — this includes your buy &amp; sell orders</li>
                  <li>Upload that file here</li>
                </ol>
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={clear}>Upload trade history</button>
        </div>
      )}
      {result && result.hasBuys && (
        <div className="panel" style={{ borderColor: 'var(--green-dim)', background: 'var(--green-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={20} style={{ color: 'var(--green-text)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, color: 'var(--green-text)', marginBottom: 4 }}>Import complete</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                {result.success} transaction{result.success !== 1 ? 's' : ''} saved
                {result.skipped > 0 && ` · ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''} skipped`}
              </div>
              {result.newHoldings.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--green-text)', marginTop: 6, fontWeight: 600 }}>
                  {result.newHoldings.length} new position{result.newHoldings.length !== 1 ? 's' : ''} added: {result.newHoldings.slice(0, 8).join(', ')}{result.newHoldings.length > 8 ? ` + ${result.newHoldings.length - 8} more` : ''}
                </div>
              )}
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 8 }}>
                Your Holdings tab is up to date. Click <b>Refresh Signals</b> to get live prices and KTrade scores.
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={clear}>Import more files</button>
        </div>
      )}
    </div>
  );
}

// ── Portfolio Empty State ─────────────────────────────────────────────────────
function PortfolioEmptyState({ onGoToImport }: { onGoToImport: () => void }) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', padding: 'var(--space-10) var(--space-8)', maxWidth: 600, margin: '0 auto' }}>
      {/* Icon */}
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Briefcase size={32} style={{ color: 'var(--blue-text)' }} />
      </div>

      {/* Headline */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 8 }}>Your portfolio, organized</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 440 }}>
          Import your transaction history from E*TRADE or Robinhood and get a clear picture of your positions, cost basis, and P&L — all stored locally on your Mac.
        </p>
      </div>

      {/* Value props */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { icon: '📊', label: 'Cost basis tracking', desc: 'Weighted-average across all buys and sells' },
          { icon: '💰', label: 'Unrealized P&L', desc: 'Live gain/loss once you refresh prices' },
          { icon: '🔍', label: 'KTrade analysis', desc: 'Engine scores for every holding you own' },
        ].map(({ icon, label, desc }) => (
          <div key={label} style={{ flex: '1 1 140px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 'var(--space-4)', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button className="btn btn-primary" onClick={onGoToImport} style={{ fontSize: 'var(--text-md)', padding: '12px 28px' }}>
        <Upload size={18} />Upload your first CSV
      </button>

      {/* How to export help */}
      <div style={{ width: '100%', maxWidth: 460 }}>
        <button
          onClick={() => setShowHelp(h => !h)}
          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{showHelp ? '▲' : '▼'}</span>
          How do I export my transaction history?
        </button>
        {showHelp && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[
              {
                broker: 'Robinhood',
                steps: [
                  'Go to robinhood.com → Account (top right)',
                  'Click History → Brokerage',
                  'Set date range to "All time"',
                  'Click Download CSV (includes buys, sells, dividends)',
                  'Repeat for each account (individual + joint)',
                ],
              },
              {
                broker: 'E*TRADE',
                steps: [
                  'Log in at etrade.com',
                  'Go to Accounts → Documents',
                  'Choose "Brokerage Download" or "Transaction History"',
                  'Set "All" for transaction types and full date range',
                  'Export as CSV and drag it here',
                ],
              },
            ].map(({ broker, steps }) => (
              <div key={broker} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 'var(--space-4)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>{broker}</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  {steps.map(s => <li key={s}>{s}</li>)}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-2)' }}>
        Nothing leaves your Mac. All data is stored locally in SQLite.
      </p>
    </div>
  );
}

// ── Portfolio Insights ────────────────────────────────────────────────────────
function PortfolioInsights({ holdings }: { holdings: PortfolioHolding[] }) {
  const active = holdings.filter(h => h.symbol !== 'CASH' && h.quantity > 0);
  if (active.length === 0) return null;

  // ── Signal grouping ──────────────────────────────────────────────────────
  const withSignal = active.filter(h => h.score != null || h.decision != null);
  const noSignal   = active.filter(h => h.score == null && h.decision == null);

  // "Strong setups" — high score, actionable
  const strong = withSignal.filter(h => (h.score ?? 0) >= 65 && (h.decision ?? '').toLowerCase().match(/buy|wait/));
  // "Near buy zone" — within 8% of entry
  const nearZone = withSignal.filter(h => h.distance_to_buy_zone != null && h.distance_to_buy_zone <= 8 && (h.score ?? 0) >= 50 && !strong.includes(h));
  // "Worth watching" — decent score, not yet actionable
  const watching = withSignal.filter(h => !strong.includes(h) && !nearZone.includes(h) && (h.score ?? 0) >= 50);
  // "Needs review" — weak signal or Avoid
  const review = withSignal.filter(h => !strong.includes(h) && !nearZone.includes(h) && !watching.includes(h));

  // ── Theme concentration ───────────────────────────────────────────────────
  const themeTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const h of active) {
    const theme = h.theme || 'Other';
    const val = h.quantity * (h.current_price ?? h.avg_cost_basis ?? 0);
    themeTotals[theme] = (themeTotals[theme] ?? 0) + val;
    grandTotal += val;
  }
  const themeRows = Object.entries(themeTotals)
    .map(([theme, val]) => ({ theme, val, pct: grandTotal > 0 ? val / grandTotal * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);

  const THEME_COLORS = ['#00C805', '#3B82F6', '#F5A623', '#8B5CF6', '#06b6d4', '#ec4899', '#84cc16', '#f97316'];

  // ── Signal row helper ─────────────────────────────────────────────────────
  const SignalGroup = ({ label, items, tone, desc }: { label: string; items: PortfolioHolding[]; tone: string; desc: string }) => {
    if (items.length === 0) return null;
    const names = items.map(h => h.symbol).join(', ');
    return (
      <div style={{ padding: 'var(--space-3)', borderRadius: 8, background: 'var(--bg-surface-3)', border: `1px solid var(--border-subtle)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: tone }}>
            {label} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({items.length})</span>
          </div>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>
          {names}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{desc}</div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
      {/* KTrade signals panel */}
      <div className="panel" style={{ flex: '2 1 300px' }}>
        <h3 style={{ marginBottom: 'var(--space-4)' }}>KTrade Signals on Your Holdings</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <SignalGroup
            label="Strong setups"
            items={strong}
            tone="var(--green-text)"
            desc="The engine likes these right now. Check the entry range before adding more."
          />
          <SignalGroup
            label="Getting close to a good entry"
            items={nearZone}
            tone="var(--gold-text)"
            desc="Within striking distance of the buy zone. Worth keeping an eye on."
          />
          <SignalGroup
            label="Keep watching"
            items={watching}
            tone="var(--blue-text)"
            desc="Decent fundamentals but not quite in the zone yet. Hold steady."
          />
          <SignalGroup
            label="Worth reviewing"
            items={review}
            tone="var(--red-text)"
            desc="The engine is cautious here. Consider your original thesis."
          />
          {noSignal.length > 0 && (
            <div style={{ padding: 'var(--space-3)', borderRadius: 8, background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                No signal yet ({noSignal.length}) — {noSignal.map(h => h.symbol).join(', ')}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4, fontStyle: 'italic' }}>
                Click "Refresh Signals" to run the engine on these holdings.
              </div>
            </div>
          )}
          {withSignal.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', fontStyle: 'italic' }}>
              No signals yet — use "Refresh Signals" above to analyse your holdings.
            </div>
          )}
        </div>
      </div>

      {/* Theme concentration */}
      {themeRows.length > 0 && (
        <div className="panel" style={{ flex: '1 1 220px' }}>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Concentration by Theme</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {themeRows.map(({ theme, val, pct }, i) => (
              <div key={theme}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>{theme}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {formatMoney(val)} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-surface-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: THEME_COLORS[i % THEME_COLORS.length], borderRadius: 4, transition: 'width 0.4s ease' }} />
                </div>
                {pct > 35 && (
                  <div style={{ fontSize: 10, color: 'var(--gold-text)', marginTop: 3 }}>⚠ Over 35% concentration</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Portfolio overview tab ────────────────────────────────────────────────────
function PortfolioOverviewTab({
  holdings, summary, onGoToImport, onGoToRefresh,
}: {
  holdings: PortfolioHolding[];
  summary: PortfolioSummary | null;
  onGoToImport: () => void;
  onGoToRefresh: () => void;
}) {
  // ── Empty state ───────────────────────────────────────────────────────────
  if (!summary || summary.totalCost === 0) {
    return <PortfolioEmptyState onGoToImport={onGoToImport} />;
  }

  const ranked = holdings.filter(h => h.symbol !== 'CASH' && h.quantity > 0);
  const unpriced = ranked.filter(h => h.current_price == null);
  const plUp = summary.unrealizedPL >= 0;

  // Quick-insight data
  const priced = ranked.filter(h => h.unrealized_pnl_pct != null);
  const topGainer = [...priced].sort((a, b) => (b.unrealized_pnl_pct ?? -999) - (a.unrealized_pnl_pct ?? -999))[0];
  const topLoser  = [...priced].sort((a, b) => (a.unrealized_pnl_pct ?? 999) - (b.unrealized_pnl_pct ?? 999))[0];
  const topPick   = [...ranked].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).find(h => h.score != null);
  const buyReady  = ranked.filter(h => (h.decision ?? '').toLowerCase().includes('buy')).length;
  const atRisk    = priced.filter(h => (h.unrealized_pnl_pct ?? 0) < -15).length;

  // When current_price is missing, fall back to cost basis so value is never $0
  const effectiveValue = summary.totalValue > 0 ? summary.totalValue : summary.totalCost;
  const hasPrices = unpriced.length < ranked.length;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>

      {/* "Needs refresh" nudge — only when no live prices yet */}
      {unpriced.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 'var(--space-3) var(--space-4)', background: 'var(--gold-muted)', border: '1px solid var(--gold-dim)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RefreshCw size={14} style={{ color: 'var(--gold-text)', flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gold-text)' }}>
              <b>{unpriced.length} of {ranked.length}</b> holding{unpriced.length !== 1 ? 's' : ''} {unpriced.length === ranked.length ? "haven't been analysed yet" : 'still need analysis'}. Live prices and P&L will appear after you run Refresh Signals.
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onGoToRefresh} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            Refresh Signals
          </button>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <PortfolioKPI
          label={hasPrices ? 'Market Value' : 'Cost Basis (Total)'}
          value={formatMoney(effectiveValue)}
          sub={hasPrices ? `Cost basis ${formatMoney(summary.totalCost)}` : `${ranked.length} position${ranked.length !== 1 ? 's' : ''} tracked`}
          accent="blue"
        />
        {hasPrices ? (
          <PortfolioKPI
            label="Unrealized P&L"
            value={formatMoney(summary.unrealizedPL)}
            sub={`${plUp ? '+' : ''}${summary.unrealizedPLPercent.toFixed(1)}% overall`}
            up={plUp}
            accent={plUp ? 'green' : 'red'}
          />
        ) : (
          <PortfolioKPI
            label="Unrealized P&L"
            value="Run Refresh"
            sub="Live prices needed"
            accent="gold"
          />
        )}
        <PortfolioKPI label="Cash / Other"  value={formatMoney(summary.cashBalance)}  accent="gold" />
        <PortfolioKPI label="Holdings"      value={String(ranked.length)}
          sub={buyReady > 0 ? `${buyReady} in Buy range` : 'Run Refresh Signals for analysis'}
          accent="blue"
        />
      </div>

      {/* Chart + Quick Insights */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className="panel" style={{ flex: '2 1 300px' }}>
          <h3 style={{ marginBottom: 'var(--space-3)' }}>Allocation</h3>
          <AllocationPie holdings={holdings} totalValue={effectiveValue} />
        </div>
        <div className="panel" style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3>Quick Look</h3>

          {/* Always-available rows — largest position by cost */}
          {ranked.length > 0 && (() => {
            const largest = [...ranked].sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0))[0];
            const pct = summary.totalCost > 0 ? ((largest.total_cost ?? 0) / summary.totalCost * 100) : 0;
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Largest position</div><div style={{ fontWeight: 700 }}>{largest.symbol}</div></div>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{pct.toFixed(1)}% of cost</span>
              </div>
            );
          })()}

          {/* Price-dependent rows */}
          {topGainer && topGainer.symbol !== topLoser?.symbol && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Top gainer</div><div style={{ fontWeight: 700 }}>{topGainer.symbol}</div></div>
              <span style={{ color: 'var(--green-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>+{topGainer.unrealized_pnl_pct!.toFixed(1)}%</span>
            </div>
          )}
          {topLoser && topLoser.symbol !== topGainer?.symbol && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Biggest drag</div><div style={{ fontWeight: 700 }}>{topLoser.symbol}</div></div>
              <span style={{ color: 'var(--red-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{topLoser.unrealized_pnl_pct!.toFixed(1)}%</span>
            </div>
          )}

          {/* Engine-dependent rows */}
          {topPick && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div><div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Best KTrade score</div><div style={{ fontWeight: 700 }}>{topPick.symbol}</div></div>
              <span className={`score-chip ${scoreClass(topPick.score ?? undefined)}`}>{topPick.score}</span>
            </div>
          )}
          {atRisk > 0 && (
            <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--red-muted)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <ShieldAlert size={14} style={{ color: 'var(--red-text)', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--red-text)' }}>{atRisk} position{atRisk > 1 ? 's' : ''} down more than 15%</span>
            </div>
          )}

          {/* Offline-safe fallback */}
          {!topGainer && !topPick && !unpriced.length && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
              All looking steady. Run Refresh Signals for live scores.
            </div>
          )}
        </div>
      </div>

      {/* KTrade signal insights */}
      <PortfolioInsights holdings={holdings} />

      {/* Performance placeholder */}
      <div className="panel" style={{ background: 'var(--bg-surface-3)', padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            <b style={{ color: 'var(--text-secondary)' }}>Performance chart</b> — historical portfolio value over time is coming in a future update.
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
  const [refreshingSignals, setRefreshingSignals] = useState(false);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);

  const showToast = (msg: string, ok = true) => {
    setToast(msg); setToastOk(ok);
    window.setTimeout(() => setToast(''), 6000);
  };

  const reload = async () => {
    setLoadingData(true);
    try {
      const [h, s] = await Promise.all([getAllHoldings(), getPortfolioSummary()]);
      setHoldings(h); setSummary(s);
    } finally { setLoadingData(false); }
  };

  const doRefreshSignals = async () => {
    setRefreshingSignals(true);
    try {
      const res = await refreshPortfolioSignals();
      await reload();
      const msg = `Live prices and scores updated for ${res.refreshed_count} holding${res.refreshed_count !== 1 ? 's' : ''}` +
        (res.failed_count > 0 ? ` · ${res.failed_count} couldn't be fetched` : '');
      showToast(msg, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Refresh failed', false);
    } finally { setRefreshingSignals(false); }
  };

  const handleImportComplete = async (result: ImportResult) => {
    await reload();

    if (!result.hasBuys) {
      // Dividends/interest imported but no purchase transactions found
      // Stay on import tab so the user sees the "no buys" warning
      setTab('import');
      const divCount = result.typeCounts['Dividend'] ?? 0;
      const intCount = result.typeCounts['Interest'] ?? 0;
      const divInfo  = [divCount && `${divCount} dividend`, intCount && `${intCount} interest`].filter(Boolean).join(', ');
      showToast(
        `Saved ${result.success} records (${divInfo || 'income only'}) — no purchase transactions found. ` +
        `Upload your full trade history to see positions and P&L.`,
        false,
      );
    } else {
      // Has buy transactions — navigate to appropriate tab
      setTab(result.newHoldings.length > 0 && holdings.length === 0 ? 'overview' : 'holdings');
      let msg = `${result.success} transaction${result.success !== 1 ? 's' : ''} saved`;
      if (result.skipped > 0) msg += ` · ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''} skipped`;
      if (result.newHoldings.length > 0) {
        msg += ` · ${result.newHoldings.length} new position${result.newHoldings.length !== 1 ? 's' : ''}: ${result.newHoldings.slice(0, 5).join(', ')}${result.newHoldings.length > 5 ? '…' : ''}`;
      }
      showToast(msg, true);
    }
  };

  useEffect(() => { reload(); }, []);

  const TABS: Array<{ t: PortfolioTab; label: string }> = [
    { t: 'overview', label: 'Overview' },
    { t: 'holdings', label: `Holdings${holdings.filter(h => h.symbol !== 'CASH' && h.quantity > 0).length ? ` (${holdings.filter(h => h.symbol !== 'CASH' && h.quantity > 0).length})` : ''}` },
    { t: 'transactions', label: 'Transactions' },
    { t: 'import', label: 'Import' },
  ];

  // Only show Refresh Signals when there are actual holdings to refresh
  const hasActiveHoldings = holdings.some(h => h.symbol !== 'CASH' && h.quantity > 0);

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h3>Portfolio</h3>
          <p>Your positions, cost basis, and KTrade view — all on your Mac, all offline</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {toast && (
            <span style={{ fontSize: 'var(--text-xs)', color: toastOk ? 'var(--green-text)' : 'var(--red-text)', maxWidth: 300 }}>
              {toastOk ? '✓ ' : '✗ '}{toast}
            </span>
          )}
          {hasActiveHoldings && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={doRefreshSignals}
              disabled={refreshingSignals || loadingData}
              title="Fetch live prices and run the KTrade engine on your holdings (30–90 sec)"
            >
              <RefreshCw size={14} className={refreshingSignals ? 'spinning' : ''} />
              {refreshingSignals ? 'Analysing holdings…' : 'Refresh Signals'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loadingData}>
            <RefreshCw size={14} className={loadingData && !refreshingSignals ? 'spinning' : ''} />
            Reload
          </button>
        </div>
      </div>

      {/* Tab navigation */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)', padding: 48 }}>
          <RefreshCw size={18} className="spinning" />Loading…
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <PortfolioOverviewTab
              holdings={holdings}
              summary={summary}
              onGoToImport={() => setTab('import')}
              onGoToRefresh={doRefreshSignals}
            />
          )}
          {tab === 'holdings' && (
            <HoldingsTable
              holdings={holdings}
              totalValue={summary?.totalValue ?? summary?.totalCost ?? 0}
              onSelectTicker={onSelectTicker}
            />
          )}
          {tab === 'transactions' && <PortfolioTransactions />}
          {tab === 'import' && <PortfolioImportPanel onImportComplete={handleImportComplete} />}
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Backtesting & Accuracy module — fully self-contained
// Renders only when settings.enable_backtesting_accuracy === true
// ─────────────────────────────────────────────────────────────────────────────
import type {
  TrackedDecision,
  DashboardMetrics as BTDashboardMetrics,
  CalibrationCurve as BTCalibrationCurve,
  EquityCurve as BTEquityCurve,
  DecisionDetail as BTDecisionDetail,
  ReliabilityBucket,
  CloseReason,
} from './services/backtestingService';
import {
  listDecisions,
  getDecisionDetail,
  closeDecision,
  untrackDecision,
  evaluateAllDecisions,
  getDashboardMetrics as btGetDashboard,
  getCalibrationCurve as btGetCalibration,
  getEquityCurve as btGetEquityCurve,
  reliabilityColors,
  explainCloseReason,
  formatReturnPct,
  trackDecision as btTrackDecision,
} from './services/backtestingService';
import {
  LineChart as RCLineChart,
  Line as RCLine,
  BarChart as RCBarChart,
  Bar as RCBar,
  XAxis as RCXAxis,
  YAxis as RCYAxis,
  CartesianGrid as RCGrid,
  ReferenceLine as RCRefLine,
  ReferenceArea as RCRefArea,
  Area as RCArea,
  AreaChart as RCAreaChart,
  ComposedChart as RCComposedChart,
} from 'recharts';

type BacktestTab = 'dashboard' | 'decisions' | 'detail';

// ── Reliability badge ─────────────────────────────────────────────────────────
function ReliabilityBadge({ bucket, label }: { bucket: ReliabilityBucket; label?: string }) {
  const c = reliabilityColors(bucket);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 'var(--text-xs)', fontWeight: 600,
      padding: '3px 10px', borderRadius: 999,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>
      <span>{c.emoji}</span>{label ?? c.label}
    </span>
  );
}

// ── Hero metric card ──────────────────────────────────────────────────────────
function HeroMetric({
  label, value, suffix, bucket, hint, sub,
}: {
  label: string; value: string; suffix?: string;
  bucket?: ReliabilityBucket; hint?: string; sub?: string;
}) {
  const c = bucket ? reliabilityColors(bucket) : null;
  return (
    <div style={{
      flex: '1 1 220px', minWidth: 200,
      background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)',
      borderRadius: 14, padding: 'var(--space-4) var(--space-5)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: c?.text ?? 'var(--text-primary)' }}>
          {value}
        </span>
        {suffix && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{suffix}</span>}
      </div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{sub}</div>}
      {bucket && <ReliabilityBadge bucket={bucket} />}
      {hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── Equity curve chart ────────────────────────────────────────────────────────
function EquityCurveChart({ curve }: { curve: BTEquityCurve }) {
  if (!curve.points || curve.points.length < 2) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
        Equity curve needs at least one closed decision to render. Close or track more decisions to see the line build.
      </div>
    );
  }
  const positive = curve.totalReturnPct >= 0;
  const lineColor = positive ? 'var(--green-text)' : 'var(--red-text)';
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <RCAreaChart data={curve.points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <RCGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
          <RCXAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
          <RCYAxis
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            tickFormatter={(v) => `$${(v as number).toFixed(0)}`}
            domain={['auto', 'auto']}
          />
          <RCTooltip
            contentStyle={{ background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }}
            formatter={(value: any, name: string) =>
              name === 'equity' ? [`$${Number(value).toFixed(2)}`, 'Equity'] : value
            }
          />
          <RCRefLine y={curve.startingCapital} stroke="var(--text-tertiary)" strokeDasharray="4 4" />
          <RCArea type="monotone" dataKey="equity" stroke={lineColor} fill="url(#equityFill)" strokeWidth={2} />
        </RCAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Calibration curve chart ───────────────────────────────────────────────────
function CalibrationChart({ curve }: { curve: BTCalibrationCurve }) {
  const data = curve.buckets.map((b) => ({
    name: b.bucket,
    predicted: b.predictedRate,
    actual: b.actualRate ?? 0,
    sampleSize: b.sampleSize,
  }));
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <RCComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <RCGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
          <RCXAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
          <RCYAxis
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <RCTooltip
            contentStyle={{ background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }}
            formatter={(value: any, name: any) =>
              [`${Number(value).toFixed(1)}%`, name === 'predicted' ? 'Predicted (midpoint)' : 'Actual win rate']
            }
          />
          <RCBar dataKey="predicted" fill="var(--bg-surface-3)" radius={[4, 4, 0, 0]} />
          <RCLine type="monotone" dataKey="actual" stroke="var(--green-text)" strokeWidth={3} dot={{ r: 4 }} />
        </RCComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Per-decision price-path chart ─────────────────────────────────────────────
function DecisionPriceChart({ detail }: { detail: BTDecisionDetail }) {
  const d = detail.decision;
  const data = detail.price_path.map((p) => ({
    date: p.date,
    close: p.close,
    high: p.high,
    low: p.low,
  }));
  if (data.length === 0) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
        No price data yet for this ticker since the decision was tracked.
      </div>
    );
  }

  // Y-axis range that contains all interesting levels
  const allPrices = [
    ...data.flatMap((p) => [p.close, p.high, p.low].filter((v): v is number => v != null)),
    d.entry_price,
    d.buy_zone_low ?? d.entry_price,
    d.buy_zone_high ?? d.entry_price,
    d.risk_line ?? d.entry_price,
    d.review_target1 ?? d.entry_price,
    d.review_target2 ?? d.entry_price,
  ];
  const minY = Math.min(...allPrices) * 0.98;
  const maxY = Math.max(...allPrices) * 1.02;

  return (
    <div style={{ width: '100%', height: 360 }}>
      <ResponsiveContainer>
        <RCComposedChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <RCGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
          <RCXAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
          <RCYAxis
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            domain={[minY, maxY]}
            tickFormatter={(v) => `$${(v as number).toFixed(2)}`}
            width={70}
          />
          <RCTooltip
            contentStyle={{ background: 'var(--bg-surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }}
            formatter={(value: any) => `$${Number(value).toFixed(2)}`}
          />

          {/* Buy zone overlay */}
          {d.buy_zone_low != null && d.buy_zone_high != null && (
            <RCRefArea y1={d.buy_zone_low} y2={d.buy_zone_high} fill="var(--green-text)" fillOpacity={0.08} />
          )}

          {/* Reference lines: entry, target1, target2, risk */}
          <RCRefLine y={d.entry_price} stroke="var(--text-secondary)" strokeDasharray="4 4" label={{ value: 'Entry', fill: 'var(--text-secondary)', fontSize: 10, position: 'right' }} />
          {d.review_target1 != null && (
            <RCRefLine y={d.review_target1} stroke="var(--green-text)" strokeDasharray="3 3" label={{ value: 'Target 1', fill: 'var(--green-text)', fontSize: 10, position: 'right' }} />
          )}
          {d.review_target2 != null && (
            <RCRefLine y={d.review_target2} stroke="var(--green-text)" strokeDasharray="3 3" label={{ value: 'Target 2', fill: 'var(--green-text)', fontSize: 10, position: 'right' }} />
          )}
          {d.risk_line != null && (
            <RCRefLine y={d.risk_line} stroke="var(--red-text)" strokeDasharray="3 3" label={{ value: 'Risk line', fill: 'var(--red-text)', fontSize: 10, position: 'right' }} />
          )}

          <RCLine type="monotone" dataKey="close" stroke="var(--blue-text)" strokeWidth={2} dot={false} />
        </RCComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Decisions list card ───────────────────────────────────────────────────────
function DecisionListCard({
  decision, onOpen,
}: {
  decision: TrackedDecision; onOpen: () => void;
}) {
  const isActive = decision.status === 'active';
  const realized = decision.realized_return_pct;
  const current  = decision.current_return_pct;
  const ret = isActive ? current : realized;
  const retFmt = formatReturnPct(ret);

  // Determine state color
  let stateColor = 'var(--text-tertiary)';
  let stateLabel = 'Active';
  let stateBg = 'var(--bg-surface-3)';
  if (decision.status === 'closed') {
    if (decision.close_reason === 'target1_hit' || decision.close_reason === 'target2_hit') {
      stateColor = 'var(--green-text)'; stateLabel = 'Target hit'; stateBg = 'var(--green-muted)';
    } else if (decision.close_reason === 'risk_breached') {
      stateColor = 'var(--red-text)';   stateLabel = 'Risk hit';   stateBg = 'var(--red-muted)';
    } else {
      stateColor = 'var(--text-secondary)'; stateLabel = 'Closed'; stateBg = 'var(--bg-surface-3)';
    }
  } else {
    if (decision.buy_zone_hit_date) {
      stateColor = 'var(--blue-text)'; stateLabel = 'In zone'; stateBg = 'var(--bg-surface-3)';
    }
  }

  return (
    <button
      onClick={onOpen}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: 'var(--space-4)', cursor: 'pointer',
        transition: 'transform 0.1s, border-color 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{decision.ticker}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Score {decision.setup_quality}/100
            </span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            Tracked {decision.tracked_at.slice(0, 10)} · {decision.days_since_tracked}d ago
          </div>
        </div>
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 600,
          padding: '3px 10px', borderRadius: 999,
          background: stateBg, color: stateColor, border: `1px solid ${stateColor}40`,
        }}>{stateLabel}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: retFmt.positive ? 'var(--green-text)' : (ret != null && ret < 0 ? 'var(--red-text)' : 'var(--text-secondary)') }}>
          {retFmt.text}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Entry ${decision.entry_price.toFixed(2)}
          {decision.latest_close != null && ` → $${decision.latest_close.toFixed(2)}`}
        </div>
      </div>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.5 }}>
        {explainCloseReason(decision.close_reason)}
      </div>
    </button>
  );
}

// ── Decision detail view ──────────────────────────────────────────────────────
function BacktestDecisionDetail({
  decisionId, onBack, onChange,
}: {
  decisionId: number; onBack: () => void; onChange: () => void;
}) {
  const [detail, setDetail] = useState<BTDecisionDetail | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closePriceStr, setClosePriceStr] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    try {
      setDetail(await getDecisionDetail(decisionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load decision');
    }
  };
  useEffect(() => { load(); }, [decisionId]);

  if (error) return <div className="alert"><ShieldAlert size={16} />{error}</div>;
  if (!detail) {
    return <div style={{ padding: 'var(--space-6)', color: 'var(--text-tertiary)' }}><RefreshCw className="spinning" size={16} /> Loading…</div>;
  }

  const d = detail.decision;
  const sig = (detail.snapshot_context?.signal_summary ?? {}) as Record<string, any>;

  const doClose = async () => {
    const price = parseFloat(closePriceStr);
    if (Number.isNaN(price)) return;
    setWorking(true);
    try {
      await closeDecision(decisionId, price, notes || undefined);
      await load();
      setShowCloseForm(false);
      onChange();
    } finally { setWorking(false); }
  };

  const doUntrack = async () => {
    if (!confirm(`Stop tracking ${d.ticker}? This won't affect your snapshot history.`)) return;
    setWorking(true);
    try {
      await untrackDecision(decisionId);
      onChange();
      onBack();
    } finally { setWorking(false); }
  };

  const retFmt = formatReturnPct(d.status === 'active' ? d.current_return_pct : d.realized_return_pct);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to all decisions</button>
        {d.status === 'active' && (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCloseForm(s => !s)}>Close manually</button>
          </>
        )}
        <button className="btn btn-ghost btn-sm" onClick={doUntrack} style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>
          <Trash2 size={14} /> Stop tracking
        </button>
      </div>

      {/* Hero */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{d.ticker}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
              {d.recommended_action} · Setup quality <b>{d.setup_quality}/100</b>
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 8 }}>
              Tracked {d.tracked_at.slice(0, 10)} ({d.days_since_tracked} days ago)
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-mono)',
                          color: retFmt.positive ? 'var(--green-text)' : (retFmt.text !== '—' ? 'var(--red-text)' : 'var(--text-secondary)') }}>
              {retFmt.text}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Entry ${d.entry_price.toFixed(2)}
              {d.latest_close != null && ` → $${d.latest_close.toFixed(2)}`}
            </div>
            <div style={{ marginTop: 8, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {explainCloseReason(d.close_reason)}
            </div>
          </div>
        </div>

        {showCloseForm && (
          <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--bg-surface-3)', borderRadius: 10 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Close at price</div>
            <div className="form-row">
              <input
                placeholder="e.g. 145.30"
                value={closePriceStr}
                onChange={(e) => setClosePriceStr(e.target.value)}
                style={{ maxWidth: 140 }}
              />
              <input
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button className="btn btn-primary btn-sm" onClick={doClose} disabled={working || !closePriceStr}>
                {working ? 'Saving…' : 'Close decision'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Price path chart */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Price path since you tracked it</h3>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
          Buy zone is shaded green. Targets and risk line shown as dashed reference lines.
        </p>
        <DecisionPriceChart detail={detail} />
      </div>

      {/* Event timeline */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>What's happened so far</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.9 }}>
          <li>Tracked at <b>${d.entry_price.toFixed(2)}</b> on {d.tracked_at.slice(0, 10)}</li>
          {d.buy_zone_hit_date && <li>✓ Reached the buy zone on <b>{d.buy_zone_hit_date}</b></li>}
          {!d.buy_zone_hit_date && d.buy_zone_low != null && <li>Buy zone (${d.buy_zone_low.toFixed(2)}–${d.buy_zone_high?.toFixed(2)}) not reached yet</li>}
          {d.target1_hit_date && <li style={{ color: 'var(--green-text)' }}>✓ Hit Target 1 (${d.review_target1?.toFixed(2)}) on <b>{d.target1_hit_date}</b></li>}
          {d.target2_hit_date && <li style={{ color: 'var(--green-text)' }}>✓ Hit Target 2 (${d.review_target2?.toFixed(2)}) on <b>{d.target2_hit_date}</b></li>}
          {d.risk_breached_date && <li style={{ color: 'var(--red-text)' }}>⚠ Crossed below risk line (${d.risk_line?.toFixed(2)}) on <b>{d.risk_breached_date}</b></li>}
          {d.max_high_to_date != null && <li>Highest since tracking: ${d.max_high_to_date.toFixed(2)}</li>}
          {d.min_low_to_date != null && <li>Lowest since tracking: ${d.min_low_to_date.toFixed(2)}</li>}
        </ul>
      </div>

      {/* Signal context */}
      {Object.keys(sig).length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Why we recommended this</h3>
          <div className="detail-stat-grid">
            {sig.trend       && <DetailStat label="Trend"      value={String(sig.trend)} />}
            {sig.momentum    && <DetailStat label="Momentum"   value={String(sig.momentum)} />}
            {sig.volume      && <DetailStat label="Volume"     value={String(sig.volume)} />}
            {sig.risk        && <DetailStat label="Risk level" value={String(sig.risk)} />}
            {sig.rsi != null && <DetailStat label="RSI"        value={String(sig.rsi)} />}
            {sig.adx != null && <DetailStat label="ADX"        value={String(sig.adx)} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Backtesting Dashboard view ────────────────────────────────────────────────
function BacktestingDashboardView({
  metrics, calibration, equity, onGotoDecisions,
}: {
  metrics: BTDashboardMetrics; calibration: BTCalibrationCurve; equity: BTEquityCurve;
  onGotoDecisions: () => void;
}) {
  if (metrics.totalTracked === 0) {
    return (
      <div style={{ padding: 'var(--space-10) var(--space-6)', textAlign: 'center', maxWidth: 540, margin: '0 auto' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto var(--space-4)', borderRadius: '50%', background: 'var(--bg-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Target size={32} style={{ color: 'var(--blue-text)' }} />
        </div>
        <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 8 }}>Start building your accuracy history</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          When you find a recommendation you want to follow, click <b>"Track this decision"</b> on its ticker card
          or detail page. Because you've enabled the Accuracy module, that single click both saves a snapshot and
          starts following the outcome here — buy zone hit, target reached, risk line breached, or still active.
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-5)', lineHeight: 1.7 }}>
          After about 5 closed decisions you'll unlock reliability scores and a calibration curve. Until then,
          we'll show your progress with calm "early data" markers — no judgment, just learning.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      {/* Hero metrics */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <HeroMetric
          label="How often we were right"
          value={metrics.hitRate != null ? `${metrics.hitRate.toFixed(0)}` : '—'}
          suffix={metrics.hitRate != null ? '%' : ''}
          bucket={metrics.hitRateReliability}
          sub={`Targets hit ${metrics.targetHits} · Risk-stops ${metrics.riskBreaches}`}
          hint="When a target or risk fired, how often the target won."
        />
        <HeroMetric
          label="Buy zones reached"
          value={metrics.buyZoneHitRate != null ? `${metrics.buyZoneHitRate.toFixed(0)}` : '—'}
          suffix={metrics.buyZoneHitRate != null ? '%' : ''}
          bucket={metrics.buyZoneReliability}
          sub={`Across ${metrics.totalTracked} tracked decision${metrics.totalTracked !== 1 ? 's' : ''}`}
          hint="How often the engine's preferred entry got tested."
        />
        <HeroMetric
          label="Win rate"
          value={metrics.winRate != null ? `${metrics.winRate.toFixed(0)}` : '—'}
          suffix={metrics.winRate != null ? '%' : ''}
          bucket={metrics.winRateReliability}
          sub={`${metrics.closed} closed · avg ${formatReturnPct(metrics.avgReturn).text}`}
          hint="Closed decisions that ended in positive return."
        />
        <HeroMetric
          label="Reward-to-risk"
          value={metrics.realizedRR != null ? `${metrics.realizedRR.toFixed(2)}×` : '—'}
          sub={`Avg win ${formatReturnPct(metrics.avgWin).text} · avg loss ${formatReturnPct(metrics.avgLoss).text}`}
          hint="Each $1 of loss earned this much in winners."
        />
        <HeroMetric
          label="Expectancy per decision"
          value={metrics.expectancy != null ? `${metrics.expectancy >= 0 ? '+' : ''}${metrics.expectancy.toFixed(2)}` : '—'}
          suffix={metrics.expectancy != null ? '%' : ''}
          sub="Expected return if you took every signal"
          hint="Win rate × avg win − loss rate × avg loss."
        />
      </div>

      {/* Coach insights */}
      {metrics.coachInsights.length > 0 && (
        <div className="panel" style={{ background: 'var(--bg-surface-2)' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} style={{ color: 'var(--blue-text)' }} /> What this means for you
          </h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            {metrics.coachInsights.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--space-4)' }}>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Simulated equity curve</h3>
            <ReliabilityBadge bucket={equity.tradeCount && equity.tradeCount >= 5 ? (equity.totalReturnPct > 0 ? 'green' : 'orange') : 'blue'} />
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
            What ${equity.startingCapital.toFixed(0)} would look like if you took every tracked decision equally.
            Currently ${equity.finalEquity.toFixed(2)} ({formatReturnPct(equity.totalReturnPct).text}).
          </p>
          <EquityCurveChart curve={equity} />
        </div>

        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Calibration — do scores predict reality?</h3>
            {calibration.calibrationScore != null && (
              <ReliabilityBadge bucket={calibration.reliability} label={`Trust score ${calibration.calibrationScore.toFixed(0)}`} />
            )}
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
            Each bar shows the predicted (midpoint of bucket) and the actual realized win rate. Closer = better calibrated.
          </p>
          <CalibrationChart curve={calibration} />
        </div>
      </div>

      {/* Per-ticker leaderboard */}
      {metrics.perTicker.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Per-ticker accuracy</h3>
          <div className="table-panel">
            <table>
              <thead><tr><th>Ticker</th><th>Closed</th><th>Win rate</th><th>Avg return</th><th>Reliability</th></tr></thead>
              <tbody>
                {metrics.perTicker.map((row) => (
                  <tr key={row.ticker}>
                    <td><b>{row.ticker}</b></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{row.closed}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{row.winRate.toFixed(0)}%</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: row.avgReturn >= 0 ? 'var(--green-text)' : 'var(--red-text)' }}>
                      {formatReturnPct(row.avgReturn).text}
                    </td>
                    <td><ReliabilityBadge bucket={row.reliability} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={onGotoDecisions}>
          <Target size={14} /> Browse all {metrics.totalTracked} decision{metrics.totalTracked !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}

// ── Decisions list view ───────────────────────────────────────────────────────
function BacktestDecisionsList({
  decisions, onOpen, onRefresh,
}: {
  decisions: TrackedDecision[]; onOpen: (id: number) => void; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');
  const filtered = filter === 'all' ? decisions : decisions.filter(d => d.status === filter);

  const counts = {
    all:    decisions.length,
    active: decisions.filter(d => d.status === 'active').length,
    closed: decisions.filter(d => d.status === 'closed').length,
  };

  if (decisions.length === 0) {
    return (
      <div style={{ padding: 'var(--space-10) var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        No tracked decisions yet. Track one from any ticker detail page to see it here.
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {(['all', 'active', 'closed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
          <RefreshCw size={14} /> Re-evaluate
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
        {filtered.map(d => (
          <DecisionListCard key={d.id} decision={d} onOpen={() => onOpen(d.id)} />
        ))}
      </div>
    </div>
  );
}

// ── Backtesting tab root ──────────────────────────────────────────────────────
function BacktestingView() {
  const [tab, setTab] = useState<BacktestTab>('dashboard');
  const [decisions, setDecisions] = useState<TrackedDecision[]>([]);
  const [metrics, setMetrics] = useState<BTDashboardMetrics | null>(null);
  const [calibration, setCalibration] = useState<BTCalibrationCurve | null>(null);
  const [equity, setEquity] = useState<BTEquityCurve | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [decs, m, c, e] = await Promise.all([
        listDecisions(),
        btGetDashboard(),
        btGetCalibration(),
        btGetEquityCurve(),
      ]);
      setDecisions(decs); setMetrics(m); setCalibration(c); setEquity(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backtesting data');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const doReevaluate = async () => {
    setLoading(true);
    try { await evaluateAllDecisions(); await load(); } finally { setLoading(false); }
  };

  const TABS: Array<{ t: BacktestTab; label: string }> = [
    { t: 'dashboard', label: 'Accuracy Dashboard' },
    { t: 'decisions', label: `All decisions${decisions.length ? ` (${decisions.length})` : ''}` },
  ];

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h3>Backtesting &amp; Accuracy</h3>
          <p>Track decisions over time. Learn what works. Build trust in the engine — or correct it.</p>
        </div>
      </div>

      {/* Sub-tabs (hidden when on decision detail) */}
      {tab !== 'detail' && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--border-subtle)' }}>
          {TABS.map(({ t, label }) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--text-sm)', fontWeight: tab === t ? 600 : 500,
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: tab === t ? '2px solid var(--blue-text)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >{label}</button>
          ))}
        </div>
      )}

      {error && <div className="alert"><ShieldAlert size={16} />{error}</div>}
      {loading && <div style={{ padding: 'var(--space-6)', color: 'var(--text-tertiary)' }}><RefreshCw size={14} className="spinning" /> Loading…</div>}

      {!loading && tab === 'dashboard' && metrics && calibration && equity && (
        <BacktestingDashboardView
          metrics={metrics}
          calibration={calibration}
          equity={equity}
          onGotoDecisions={() => setTab('decisions')}
        />
      )}
      {!loading && tab === 'decisions' && (
        <BacktestDecisionsList
          decisions={decisions}
          onOpen={(id) => { setSelectedId(id); setTab('detail'); }}
          onRefresh={doReevaluate}
        />
      )}
      {!loading && tab === 'detail' && selectedId != null && (
        <BacktestDecisionDetail
          decisionId={selectedId}
          onBack={() => setTab('decisions')}
          onChange={load}
        />
      )}
    </section>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────
function SettingsView() {
  const [positions, setPositions] = useState<any>(null);
  const [settings, setSettings] = useState<{ show_beginner_price_help: boolean; enable_portfolio_os: boolean; enable_backtesting_accuracy: boolean } | null>(null);
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
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
                window.location.reload();
              }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 4 }}>Enable Backtesting &amp; Accuracy Module</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Unlock a separate tab where you can mark any recommendation as "Track this Decision" and watch how the
              call plays out. Includes hit-rate, calibration curve, simulated equity curve, and per-decision charts.
              100% read-only — your existing ticker cards and history are unaffected. Off by default.
            </div>
          </div>
          <label className="toggle setting-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings?.enable_backtesting_accuracy)}
              onChange={async (e) => {
                const next = e.target.checked;
                setSettings(s => s ? { ...s, enable_backtesting_accuracy: next } : s);
                await sendJson('/api/settings/enableBacktestingAccuracy', { value: String(next) }, 'PATCH');
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

  /**
   * Single source of truth for tracking a decision from anywhere in the app.
   *   1. Always save a snapshot (existing behaviour — feeds Learning Insights)
   *   2. If the Backtesting & Accuracy module is enabled, ALSO register the
   *      latest snapshot as a tracked_decision so the Accuracy tab can follow
   *      it day by day. One click, two outcomes — no duplicate UI required.
   */
  const onTrack = async (symbol: string) => {
    await sendJson(`/api/snapshots/${encodeURIComponent(symbol)}/track-current`);

    const accuracyOn = (dashboard?.settings as any)?.enable_backtesting_accuracy ?? false;
    if (accuracyOn) {
      try {
        const [latest] = await getJson<RecommendationSnapshot[]>(`/api/snapshots/${encodeURIComponent(symbol)}?limit=1`);
        if (latest) {
          await btTrackDecision(latest.id);
          setToast(`Tracking ${symbol} — open the Accuracy tab to follow the outcome.`);
        } else {
          setToast(`Snapshot saved for ${symbol}.`);
        }
      } catch {
        // Backtesting registration failed (likely already tracked) — fall back to snapshot-only msg
        setToast(`Snapshot saved for ${symbol}.`);
      }
    } else {
      setToast(`Snapshot saved for ${symbol}.`);
    }
    window.setTimeout(() => setToast(''), 3500);
  };

  const goToTicker = (symbol: string) => {
    setSelectedTicker(symbol);
    setPage('ticker');
  };

  const cards = dashboard?.cards ?? [];
  const showHelp = dashboard?.settings?.show_beginner_price_help ?? true;
  const portfolioOSEnabled = dashboard?.settings?.enable_portfolio_os ?? false;
  const backtestingEnabled = (dashboard?.settings as any)?.enable_backtesting_accuracy ?? false;

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
            <NavButton page="portfolio" current={page} setPage={setPage} icon={<Briefcase size={16} />} label="Portfolio" />
          )}
          {backtestingEnabled && (
            <NavButton page="backtesting" current={page} setPage={setPage} icon={<Target size={16} />} label="Accuracy" />
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
          {page === 'backtesting' && backtestingEnabled && <BacktestingView />}
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
