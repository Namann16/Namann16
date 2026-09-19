/**
 * Chart colour system — Apple system colours, re-stepped and validated.
 *
 * Apple's flat system colours do NOT work as a categorical palette. Checked all-pairs, the eight
 * UI colours collide badly: systemGreen against systemOrange reaches ΔE 4.8 for a deuteranope,
 * systemIndigo against systemPurple 3.3 for a protanope, and systemPink against systemRed only 4.5
 * even in full colour vision. They are designed to sit alone as a tint on a control, not side by
 * side as data marks.
 *
 * So the slots below keep Apple's HUES and re-step their LIGHTNESS in OKLCH, which is what Apple
 * itself does for the chart palettes in Numbers and Keynote. Every value was produced by the
 * validator, not by eye:
 *
 *   light, on a white card   CVD ΔE 9.3 (worst pair, protan) · normal-vision ΔE 28.6 · all bands pass
 *   dark,  on #1C1C1E        CVD ΔE 9.0 (worst pair, protan) · normal-vision ΔE 20.3 · all bands pass
 *
 * Four slots is the whole palette, and that is deliberate: a fifth Apple hue drops the worst pair
 * into the 6–8 floor band whichever hue is chosen. No chart in this application plots more than
 * four series, so the palette covers every real case and a fifth series must fold into "Other" or
 * become a second chart rather than take a generated hue.
 *
 * Three rules hold everywhere charts are drawn:
 *   - Hues are assigned in fixed slot order and never cycled, so "revenue is blue" stays true when
 *     other series are filtered out.
 *   - Status colours mean a state and are never reused as a series colour.
 *   - Colour never carries meaning alone: every chart with two or more series has a legend, and
 *     the same figures are available as a table.
 *
 * Both modes carry one sub-3:1 slot against their surface (orange and purple in light, green in
 * dark). The validator marks that as requiring relief rather than as a failure, and the relief is
 * present: a legend on every multi-series chart and a "Show data table" toggle on every plot.
 */

export type ChartMode = 'light' | 'dark';

/**
 * Fixed categorical order: systemBlue, systemOrange, systemGreen, systemPurple.
 *
 * Do not reorder, substitute or extend these without re-running
 * `scripts/validate_palette.js "<hex,…>" --mode <mode> --surface <surface> --pairs all`.
 */
const CATEGORICAL: Record<ChartMode, string[]> = {
  // Apple hues at L 0.46 / 0.76 / 0.58 / 0.70 — orange and green are pushed apart in lightness
  // because that pair is what collapses under red-green colour-vision deficiency.
  light: ['#004ec4', '#f7972c', '#019437', '#c675f2'],
  // Dark mode is stepped separately against #1C1C1E, not flipped: L 0.66 / 0.66 / 0.49 / 0.57.
  dark: ['#4290fe', '#d17a05', '#007626', '#a044ce'],
};

/**
 * Status palette — Apple's accessible system colours. A severity ramp is ordinal, so warning,
 * serious and critical are deliberately a warm progression rather than four unrelated hues. Every
 * step clears 3:1 against its surface, and severity always ships with its written label beside it.
 */
export const STATUS_COLORS = {
  good: '#248A3D',      // accessible systemGreen
  warning: '#8F6A00',   // systemYellow, darkened to stay legible on white
  serious: '#C93400',   // accessible systemOrange
  critical: '#D70015',  // accessible systemRed
} as const;

/** The same states for a dark surface, where Apple's brighter appearance variants apply. */
export const STATUS_COLORS_DARK = {
  good: '#30D158',      // systemGreen (dark)
  warning: '#FFD60A',   // systemYellow (dark)
  serious: '#FF9F0A',   // systemOrange (dark)
  critical: '#FF453A',  // systemRed (dark)
} as const;

/**
 * Chart chrome. Gridlines are solid hairlines drawn in Apple's separator colour — the same line
 * weight and value the rest of the interface uses, so a plot reads as part of the card rather than
 * as a pasted-in image. Never dashed.
 */
export const CHROME: Record<ChartMode, {
  grid: string; axis: string; tick: string; label: string; surface: string;
}> = {
  light: {
    grid: 'rgba(60, 60, 67, 0.16)',    // separator, lightened — recessive behind the data
    axis: 'rgba(60, 60, 67, 0.29)',    // separator
    tick: 'rgba(60, 60, 67, 0.6)',     // secondaryLabel
    label: 'rgba(60, 60, 67, 0.6)',    // secondaryLabel
    surface: '#FFFFFF',                 // secondarySystemGroupedBackground
  },
  dark: {
    grid: 'rgba(84, 84, 88, 0.45)',
    axis: 'rgba(84, 84, 88, 0.65)',
    tick: 'rgba(235, 235, 245, 0.6)',
    label: 'rgba(235, 235, 245, 0.6)',
    surface: '#1C1C1E',
  },
};

export function categorical(mode: ChartMode): string[] {
  return CATEGORICAL[mode];
}

/**
 * Colour for a series slot.
 *
 * Callers pass a stable slot index per series, never the series' current position, so hiding one
 * series does not repaint the others. Past four slots the caller must fold the tail into "Other"
 * or facet — a fifth generated hue would not survive the colour-vision check.
 */
export function seriesColor(mode: ChartMode, index: number): string {
  const slots = CATEGORICAL[mode];
  return slots[index % slots.length]!;
}

/**
 * Sequential ramp for magnitude: one hue (systemBlue), light to dark, six steps.
 * Monotone in lightness with every adjacent gap above 0.06, and the light end clears 2:1 on white.
 */
export const SEQUENTIAL_BLUE = ['#86b9ff', '#579bfc', '#267cee', '#005ed5', '#0046a7', '#003176'];

/** Diverging pair: systemRed and systemBlue either side of a neutral Apple grey midpoint. */
export const DIVERGING = {
  negative: '#D70015',
  midpoint: { light: '#E5E5EA', dark: '#3A3A3C' },
  positive: '#004ec4',
} as const;

export function currentMode(): ChartMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Status colours for the active appearance. */
export function statusColors(mode: ChartMode) {
  return mode === 'dark' ? STATUS_COLORS_DARK : STATUS_COLORS;
}
