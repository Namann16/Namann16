import type { MetricStatus, MetricUnit, MetricValue, Num, Trend } from '../types.js';
import { isNum, round, stdDev } from './number.js';

export interface MetricSpec {
  key: string;
  label: string;
  unit: MetricUnit;
  formula: string;
  meaning?: string;
  higherIsBetter?: boolean;
}

/**
 * Build a MetricValue carrying its own provenance.
 *
 * `inputs` must contain every raw number the computation consumed. If any required input
 * is missing the metric is returned with a `null` value and an explicit status — the engine
 * never substitutes zero for an absent number.
 */
export function makeMetric(
  spec: MetricSpec,
  period: string,
  value: Num,
  inputs: Record<string, Num>,
  options: { status?: MetricStatus; note?: string } = {},
): MetricValue {
  let status: MetricStatus = options.status ?? 'ok';
  let note = options.note;

  if (!isNum(value) && status === 'ok') {
    const missing = Object.entries(inputs)
      .filter(([, v]) => !isNum(v))
      .map(([k]) => k);
    if (missing.length > 0) {
      status = 'insufficient_data';
      note = note ?? `Requires ${missing.join(', ')}.`;
    } else {
      status = 'undefined_denominator';
      note = note ?? 'The denominator is zero, so this ratio is undefined for this period.';
    }
  }

  return {
    key: spec.key,
    label: spec.label,
    period,
    value: round(value, 4),
    unit: spec.unit,
    formula: spec.formula,
    inputs,
    status,
    ...(note ? { note } : {}),
    ...(spec.meaning ? { meaning: spec.meaning } : {}),
    ...(spec.higherIsBetter !== undefined ? { higherIsBetter: spec.higherIsBetter } : {}),
  };
}

/** A metric that is structurally not applicable (e.g. inventory days for a bank). */
export function notApplicable(spec: MetricSpec, period: string, reason: string): MetricValue {
  return makeMetric(spec, period, null, {}, { status: 'not_applicable', note: reason });
}

/**
 * Classify a trend from a series of values.
 *
 * `improving`/`deteriorating` require a consistent direction over the series and a move
 * larger than the noise in the series; otherwise the trend is `stable` or `volatile`.
 * Returns `insufficient_data` for fewer than three usable points rather than guessing.
 */
export function classifyTrend(values: Num[], higherIsBetter = true): Trend {
  const present = values.filter(isNum);
  if (present.length < 3) {
    if (present.length < 2) return 'insufficient_data';
    const [a, b] = [present[0]!, present[1]!];
    if (a === 0) return 'insufficient_data';
    const move = (b - a) / Math.abs(a);
    if (Math.abs(move) < 0.02) return 'stable';
    const better = higherIsBetter ? b > a : b < a;
    return better ? 'improving' : 'deteriorating';
  }

  const first = present[0]!;
  const last = present[present.length - 1]!;
  const base = Math.abs(first) > 1e-9 ? Math.abs(first) : null;
  const netMove = base ? (last - first) / base : null;

  // Count direction changes to detect volatility.
  let reversals = 0;
  for (let i = 2; i < present.length; i += 1) {
    const prevDelta = present[i - 1]! - present[i - 2]!;
    const delta = present[i]! - present[i - 1]!;
    if (prevDelta !== 0 && delta !== 0 && Math.sign(prevDelta) !== Math.sign(delta)) reversals += 1;
  }

  const sd = stdDev(present);
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const cv = sd !== null && Math.abs(mean) > 1e-9 ? sd / Math.abs(mean) : null;

  if (netMove === null) return 'insufficient_data';
  if (Math.abs(netMove) < 0.03) return reversals >= present.length - 2 && (cv ?? 0) > 0.25 ? 'volatile' : 'stable';
  if (reversals >= present.length - 2 && (cv ?? 0) > 0.3) return 'volatile';

  const better = higherIsBetter ? last > first : last < first;
  return better ? 'improving' : 'deteriorating';
}

export function trendLabel(trend: Trend): string {
  switch (trend) {
    case 'improving': return 'Improving';
    case 'deteriorating': return 'Deteriorating';
    case 'stable': return 'Stable';
    case 'volatile': return 'Volatile';
    default: return 'Insufficient data';
  }
}
