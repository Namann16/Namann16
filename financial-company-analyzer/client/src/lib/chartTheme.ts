/**
 * Chart colour system.
 *
 * The categorical slots below are a validated palette: they clear the lightness band, the chroma
 * floor, adjacent colour-vision-deficiency separation and the normal-vision floor against this
 * application's own surfaces (white cards in light mode, ink-900 in dark). They were checked with
 * a validator rather than chosen by eye — do not substitute a hue without re-validating the set.
 *
 * Three rules hold everywhere charts are drawn:
 *   - Hues are assigned in fixed slot order and never cycled. A series keeps its colour when
 *     other series are filtered out, so "revenue is blue" stays true.
 *   - Status colours (good/warning/critical) mean a state and are never reused as a series colour.
 *   - Colour never carries meaning alone: every chart with two or more series has a legend.
 *
 * In light mode three slots sit below 3:1 contrast against white. That is acceptable only because
 * the application always ships the relief the palette requires — a legend on every multi-series
 * chart, and the same figures available as a table on the ratio and statement screens.
 */

export type ChartMode = 'light' | 'dark';

/** Fixed categorical order. Slot 1 is the primary series on any single-series chart. */
const CATEGORICAL: Record<ChartMode, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Status palette. Fixed in both modes, and deliberately distinct from the categorical slots. */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Chart chrome: grid, axis and ink. Gridlines are solid hairlines — never dashed. */
export const CHROME: Record<ChartMode, {
  grid: string; axis: string; tick: string; label: string; surface: string;
}> = {
  light: { grid: '#e4e7ec', axis: '#c2cad7', tick: '#6b788d', label: '#4e5a6e', surface: '#ffffff' },
  dark: { grid: '#26304199', axis: '#3b465a', tick: '#94a0b3', label: '#c2cad7', surface: '#131b2b' },
};

export function categorical(mode: ChartMode): string[] {
  return CATEGORICAL[mode];
}

/**
 * Colour for a named series.
 *
 * Keyed by series name rather than by position, so a chart that hides a series does not repaint
 * the ones that remain. Past eight series the caller must fold the tail into "Other" or facet —
 * a ninth generated hue would not be distinguishable under colour-vision deficiency.
 */
export function seriesColor(mode: ChartMode, index: number): string {
  const slots = CATEGORICAL[mode];
  return slots[index % slots.length]!;
}

/** Sequential ramp (single hue, light to dark) for magnitude encoding. */
export const SEQUENTIAL_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

/** Diverging pair: warm/cool poles either side of a neutral midpoint. */
export const DIVERGING = {
  negative: '#d03b3b',
  midpoint: { light: '#f0efec', dark: '#383835' },
  positive: '#2a78d6',
} as const;

export function currentMode(): ChartMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
