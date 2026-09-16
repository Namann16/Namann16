import type { MetricUnit, Num, Units } from '../types.js';
import { UNIT_LABELS, currencySymbol, isNum } from './number.js';

export const NOT_AVAILABLE = 'n/a';

export interface FormatContext {
  currency?: string;
  units?: Units;
  decimals?: number;
}

function group(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a number in the metric's own unit. Missing values always render as "n/a", never as 0. */
export function formatMetric(value: Num, unit: MetricUnit, ctx: FormatContext = {}): string {
  if (!isNum(value)) return NOT_AVAILABLE;
  switch (unit) {
    case 'percent':
      return `${group(value, ctx.decimals ?? 1)}%`;
    case 'times':
      return `${group(value, ctx.decimals ?? 2)}x`;
    case 'days':
      return `${group(value, ctx.decimals ?? 0)} days`;
    case 'per_share':
      return `${currencySymbol(ctx.currency)}${group(value, ctx.decimals ?? 2)}`;
    case 'currency':
      return formatCurrency(value, ctx);
    case 'number':
    default:
      return group(value, ctx.decimals ?? 2);
  }
}

export function formatCurrency(value: Num, ctx: FormatContext = {}): string {
  if (!isNum(value)) return NOT_AVAILABLE;
  const sym = currencySymbol(ctx.currency);
  const suffix = ctx.units ? UNIT_LABELS[ctx.units] : '';
  const decimals = ctx.decimals ?? (Math.abs(value) >= 100 ? 0 : 1);
  const body = group(Math.abs(value), decimals);
  const signed = value < 0 ? `(${body})` : body;
  return [sym ? `${sym}${signed}` : signed, suffix].filter(Boolean).join(' ');
}

/** Signed display used for changes, e.g. "+2.1 pp" or "-0.4x". */
export function formatChange(value: Num, unit: MetricUnit, ctx: FormatContext = {}): string {
  if (!isNum(value)) return NOT_AVAILABLE;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  switch (unit) {
    case 'percent':
      return `${sign}${group(magnitude, ctx.decimals ?? 1)} pp`;
    case 'times':
      return `${sign}${group(magnitude, ctx.decimals ?? 2)}x`;
    case 'days':
      return `${sign}${group(magnitude, ctx.decimals ?? 0)} days`;
    default:
      return `${sign}${formatMetric(magnitude, unit, ctx)}`;
  }
}

export function formatPercent(value: Num, decimals = 1): string {
  return isNum(value) ? `${group(value, decimals)}%` : NOT_AVAILABLE;
}

/** Compact label for the units in force, e.g. "₹ Cr". */
export function unitsLabel(currency?: string, units?: Units): string {
  const sym = currencySymbol(currency);
  const u = units ? UNIT_LABELS[units] : '';
  return [sym, u].filter(Boolean).join(' ') || (currency ?? '');
}
