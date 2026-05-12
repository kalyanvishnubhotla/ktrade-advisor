import type { Card, SRZone } from '../types';

export const API = '';

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(`${API}${url}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function sendJson<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function scoreClass(score?: number) {
  if (!score) return 'muted';
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 50) return 'mixed';
  return 'weak';
}

export function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'string') return value.startsWith('$') ? value : value;
  return `$${value.toFixed(2)}`;
}

export function formatNumber(value?: number | null, digits = 2) {
  if (value === null || value === undefined) return '--';
  return value.toFixed(digits);
}

export function parseMoneyValue(value?: string | number | null) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const match = value.match(/-?\$?([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

export function parseMoneyRange(value?: string | null) {
  if (!value) return undefined;
  const matches = [...value.matchAll(/-?\$?([\d,]+(?:\.\d+)?)/g)].map((m) =>
    Number(m[1].replace(/,/g, ''))
  );
  if (matches.length < 2) return undefined;
  return { low: Math.min(matches[0], matches[1]), high: Math.max(matches[0], matches[1]) };
}

export function pctText(value?: number) {
  return `${(value ?? 0).toFixed(1)}%`;
}

export function signalTone(label?: string) {
  const value = (label || '').toLowerCase();
  if (['strong', 'good', 'supportive', 'constructive', 'low'].some((w) => value.includes(w)))
    return 'green';
  if (['mixed', 'neutral', 'medium', 'developing'].some((w) => value.includes(w))) return 'yellow';
  if (['weak', 'high', 'falling', 'quiet'].some((w) => value.includes(w))) return 'red';
  return 'yellow';
}

export function decisionNudge(card: Card) {
  const distance = card.distance_to_buy_zone;
  if (distance === null || distance === undefined)
    return card.summary || 'Run a refresh to calculate this setup.';
  if (distance > 8)
    return `Price is ${distance.toFixed(1)}% above the preferred buy area — patience may reduce risk.`;
  if (distance > 3)
    return `Price is ${distance.toFixed(1)}% above the preferred buy area. Close enough to watch, not yet urgent.`;
  if (distance >= -2)
    return 'Price is near the preferred buy area. Review the score, risk, and portfolio fit before acting.';
  return 'Price is below the preferred buy area. That can mean a discount — also check whether the setup is weakening.';
}

export function plainFactor(text?: string) {
  if (!text) return '';
  return text
    .replace(/RSI Bearish Divergence/gi, 'Momentum is slowing while price is still rising')
    .replace(/MACD Bearish divergence/gi, 'Momentum is slowing while price is still rising')
    .replace(/Bearish divergence/gi, 'Momentum is slowing while price is still rising')
    .replace(
      /Shooting Star|Evening Star|Dark Cloud Cover|Bearish Engulfing/gi,
      'Recent candle shows sellers stepping in'
    )
    .replace(/Fib(?:onacci)?\s*[\d.]+%?\s*Extension/gi, 'next possible target if momentum continues')
    .replace(/Fib(?:onacci)? extension/gi, 'next possible target if momentum continues')
    .replace(
      /This stock has been rising very fast lately \(Overbought\)/gi,
      'Price has climbed quickly — it may pause or pull back a bit to rest'
    )
    .replace(/Overbought/gi, 'fast move')
    .replace(/Momentum is supportive: RSI [\d.]+, Bullish/gi, 'Momentum is supportive')
    .replace(/RSI [\d.]+ is bullish; MACD is supportive\./gi, 'Buying pressure is positive.')
    .replace(/RSI cools below \d+/gi, 'momentum cools')
    .replace(/Trend is acceptable: Daily & weekly aligned/gi, 'Short-term and longer-term trends agree')
    .replace(/Daily & weekly aligned/gi, 'short-term and longer-term trends agree')
    .replace(/Weak trend \([\d.]+ ADX\)/gi, 'Trend is not forceful yet')
    .replace(/Strong trend \([\d.]+ ADX\)/gi, 'Trend has strong follow-through')
    .replace(/Very strong trend \([\d.]+ ADX\)/gi, 'Trend has very strong follow-through')
    .replace(/Bollinger range is wide at [\d.]+%/gi, 'Price is moving in a wide range')
    .replace(
      /Quiet \([\d.]+x 20-day average, not clearly rising on up days\)\./gi,
      'Volume is quiet, so buying interest is not loud yet.'
    )
    .replace(
      /Constructive \([\d.]+x 20-day average, rising on up days\)\./gi,
      'Volume is constructive.'
    )
    .replace(
      /Supportive \([\d.]+x 20-day average, rising on up days\)\./gi,
      'Volume supports the move.'
    );
}

export function targetLabel(card: Card | Record<string, unknown> | null | undefined) {
  return Boolean((card as Card)?.fresh_high_targets) ? 'Next possible targets' : 'Review area';
}

export function targetHelp(card: Card | Record<string, unknown> | null | undefined) {
  if (Boolean((card as Card)?.fresh_high_targets)) {
    return 'Because this stock is at fresh highs, the app uses guidepost targets based on how strong the move has been. These are not guarantees.';
  }
  return 'A price area to reassess. It is not an automatic sell point and not a guarantee.';
}

export function educationalHelp(text?: string) {
  const lower = (text || '').toLowerCase();
  if (
    lower.includes('strength behind') ||
    lower.includes('climb') ||
    lower.includes('pause') ||
    lower.includes('pull back')
  )
    return 'This means the stock may still be healthy, but the move is getting fast. Waiting can give new buyers a calmer entry.';
  if (lower.includes('earnings'))
    return 'Earnings can move a stock quickly in either direction. It is often calmer to wait until the first reaction settles.';
  if (lower.includes('wide range') || lower.includes('price swings'))
    return 'A wider range means the stock is moving around more than usual. Smaller position sizes and clearer entry points can help.';
  if (lower.includes('volume'))
    return 'Volume shows how much participation is behind a move. Quiet volume means the signal is less convincing.';
  return 'This is a plain-English explanation of the signal. It is a guidepost, not a guarantee.';
}

export function accuracyHelp() {
  return 'This looks at your own tracked history: when this ticker had a setup quality score of 70 or higher and you marked that you bought, how often the recorded outcome was positive.';
}

export function simpleDivergenceText(value?: string | null) {
  if (!value) return 'None detected';
  if (/bearish/i.test(value)) return 'Momentum is slowing while price is still rising';
  if (/bullish/i.test(value)) return 'Selling pressure may be easing';
  return 'Momentum is changing';
}

export function hasGentleWarning(card: Card) {
  const joined = [
    ...(card.setup_concern_factors || []),
    card.summary || '',
    card.momentum_summary || '',
  ]
    .join(' ')
    .toLowerCase();
  return (
    joined.includes('momentum is slowing') ||
    joined.includes('sellers stepping in') ||
    joined.includes('pause or pull back') ||
    joined.includes('take a breather') ||
    joined.includes('earnings coming') ||
    joined.includes('june can be') ||
    joined.includes('september can be') ||
    joined.includes('climbed quickly')
  );
}

export function gentleWarningLabel(card: Card) {
  const joined = [
    ...(card.setup_concern_factors || []),
    card.summary || '',
    card.momentum_summary || '',
  ]
    .join(' ')
    .toLowerCase();
  if (joined.includes('earnings coming')) return 'Watch closely around earnings';
  if (joined.includes('after big earnings') || joined.includes('take a short break'))
    return 'Time for a breather?';
  if (joined.includes('climbed quickly') || joined.includes('pause or pull back'))
    return 'Healthy but fast move';
  if (joined.includes('june can be') || joined.includes('september can be'))
    return 'Market season can be uneven';
  return 'Time for a breather?';
}

export function technicalSourceToPlain(label: string) {
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

export function plainZoneReason(card: Card) {
  const supportSources = card.nearest_support_zone?.sources ?? [];
  const labels = supportSources.map((s) => technicalSourceToPlain(s.label)).filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels)).slice(0, 3);
  if (uniqueLabels.length) return `This area is based on ${uniqueLabels.join(' + ')}.`;
  if (card.buy_zone_explanation) return technicalSourceToPlain(card.buy_zone_explanation);
  return 'This area is based on recent price behavior and longer-term averages.';
}

export function decisionColors(decision?: string): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  const d = (decision || '').toLowerCase();
  if (d.includes('buy'))
    return {
      bg: 'var(--decision-buy-bg)',
      text: 'var(--decision-buy-text)',
      border: 'var(--decision-buy-border)',
      dot: 'var(--green)',
    };
  if (d.includes('wait'))
    return {
      bg: 'var(--decision-wait-bg)',
      text: 'var(--decision-wait-text)',
      border: 'var(--decision-wait-border)',
      dot: 'var(--gold)',
    };
  if (d.includes('watch'))
    return {
      bg: 'var(--decision-watch-bg)',
      text: 'var(--decision-watch-text)',
      border: 'var(--decision-watch-border)',
      dot: 'var(--blue)',
    };
  if (d.includes('avoid'))
    return {
      bg: 'var(--decision-avoid-bg)',
      text: 'var(--decision-avoid-text)',
      border: 'var(--decision-avoid-border)',
      dot: 'var(--red)',
    };
  return {
    bg: 'var(--decision-hold-bg)',
    text: 'var(--decision-hold-text)',
    border: 'var(--decision-hold-border)',
    dot: '#666',
  };
}

export function scoreColorVar(score?: number) {
  if (!score) return 'var(--text-tertiary)';
  if (score >= 80) return 'var(--green)';
  if (score >= 65) return 'var(--score-good)';
  if (score >= 50) return 'var(--gold)';
  return 'var(--red)';
}
