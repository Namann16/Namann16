import type { Num, Units } from '../types.js';

/** True only for a usable finite number. `null`, `undefined` and `NaN` all fail. */
export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Safe division. Returns null rather than Infinity/NaN when the denominator is missing
 * or zero. The engine never divides by zero and never reports a ratio it could not compute.
 */
export function safeDiv(numerator: Num, denominator: Num): Num {
  if (!isNum(numerator) || !isNum(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/** Division where a negative denominator makes the result meaningless (e.g. negative equity). */
export function safeDivPositiveDenominator(numerator: Num, denominator: Num): Num {
  if (!isNum(denominator) || denominator <= 0) return null;
  return safeDiv(numerator, denominator);
}

export function safeMul(a: Num, b: Num): Num {
  if (!isNum(a) || !isNum(b)) return null;
  return a * b;
}

/** Sum that returns null when every input is missing, and ignores missing inputs otherwise. */
export function sumDefined(values: Num[]): Num {
  const present = values.filter(isNum);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

/** Sum that requires every input to be present — used where a missing part would silently understate a total. */
export function sumStrict(values: Num[]): Num {
  if (values.some((v) => !isNum(v))) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

export function subtract(a: Num, b: Num): Num {
  if (!isNum(a) || !isNum(b)) return null;
  return a - b;
}

export function add(a: Num, b: Num): Num {
  if (!isNum(a) || !isNum(b)) return null;
  return a + b;
}

export function negate(v: Num): Num {
  return isNum(v) ? -v : null;
}

export function abs(v: Num): Num {
  return isNum(v) ? Math.abs(v) : null;
}

/** Average of two balance-sheet points. Falls back to the single available point. */
export function average(a: Num, b: Num): Num {
  if (isNum(a) && isNum(b)) return (a + b) / 2;
  if (isNum(a)) return a;
  if (isNum(b)) return b;
  return null;
}

export function round(v: Num, dp = 2): Num {
  if (!isNum(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function toPercent(ratio: Num): Num {
  return isNum(ratio) ? ratio * 100 : null;
}

/** Percentage change from `from` to `to`. Undefined when the base is zero or negative-to-positive. */
export function percentChange(from: Num, to: Num): Num {
  if (!isNum(from) || !isNum(to)) return null;
  if (from === 0) return null;
  // A growth rate computed off a negative base is not interpretable (e.g. loss -> smaller loss
  // would read as "-50% growth"), so it is reported as unavailable rather than misleading.
  if (from < 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * Compound annual growth rate over `years` periods, as a percentage.
 * Requires a strictly positive start and end value; a CAGR through zero or negative
 * values has no real solution and is reported as unavailable.
 */
export function cagr(begin: Num, end: Num, years: number): Num {
  if (!isNum(begin) || !isNum(end)) return null;
  if (years <= 0) return null;
  if (begin <= 0 || end <= 0) return null;
  return ((end / begin) ** (1 / years) - 1) * 100;
}

export const UNIT_MULTIPLIERS: Record<Units, number> = {
  units: 1,
  thousands: 1e3,
  lakhs: 1e5,
  millions: 1e6,
  crores: 1e7,
  billions: 1e9,
};

export const UNIT_LABELS: Record<Units, string> = {
  units: '',
  thousands: "'000",
  lakhs: 'Lakh',
  millions: 'Mn',
  crores: 'Cr',
  billions: 'Bn',
};

/** Convert a value expressed in `from` units into `to` units. */
export function convertUnits(value: Num, from: Units, to: Units): Num {
  if (!isNum(value)) return null;
  const f = UNIT_MULTIPLIERS[from];
  const t = UNIT_MULTIPLIERS[to];
  if (!f || !t) return value;
  return (value * f) / t;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  OTHER: '',
};

export function currencySymbol(code?: string): string {
  if (!code) return '';
  return CURRENCY_SYMBOLS[code] ?? '';
}

/** Standard deviation of the sample, used for volatility checks. Null when fewer than two points. */
export function stdDev(values: Num[]): Num {
  const present = values.filter(isNum);
  if (present.length < 2) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const variance = present.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (present.length - 1);
  return Math.sqrt(variance);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
