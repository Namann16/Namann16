import { describe, expect, it } from 'vitest';
import tailwind from '../tailwind.config.js';

/**
 * Text contrast regression guard.
 *
 * The interface follows Apple's Human Interface Guidelines, and Apple's published label colours
 * are deliberately low-contrast: iOS and macOS ship an "Increase Contrast" accessibility setting
 * that darkens them system-wide. A web page has no such switch, so adopting the raw values would
 * inherit the weakness without the remedy — systemGray as secondaryLabel measures 3.26:1 on white,
 * below the WCAG AA floor of 4.5:1 for body text.
 *
 * These tests pin the corrected values. If someone "restores" Apple's published greys for
 * fidelity, this fails and says why.
 */

const AA_BODY = 4.5;
const AA_LARGE = 3;

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Composite a translucent label colour over an opaque surface. */
function over(rgb: [number, number, number], alpha: number, surface: string): string {
  const n = parseInt(surface.replace('#', ''), 16);
  const bg = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const out = rgb.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha)));
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
}

const ink = (tailwind.theme!.extend!.colors as Record<string, Record<string, string>>).ink!;

// Apple's grouped backgrounds: the page, a card, and a raised surface in dark mode.
const PAGE_LIGHT = '#F2F2F7';
const CARD_LIGHT = '#FFFFFF';
const CARD_DARK = '#1C1C1E';
const RAISED_DARK = '#2C2C2E';

describe('secondary body text clears WCAG AA', () => {
  it('ink-500 is legible on a light card and on the page behind it', () => {
    expect(contrast(ink['500']!, CARD_LIGHT)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrast(ink['500']!, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('ink-400, which carries secondary text in dark mode, clears AA on both dark surfaces', () => {
    expect(contrast(ink['400']!, CARD_DARK)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrast(ink['400']!, RAISED_DARK)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('rejects Apple systemGray as a body-text colour on white', () => {
    // #8E8E93 is the published secondaryLabel. Documented here so the reason the ramp diverges
    // from Apple's values is not lost.
    expect(contrast('#8E8E93', CARD_LIGHT)).toBeLessThan(AA_BODY);
  });
});

describe('the CSS label hierarchy clears its intended floor', () => {
  // These mirror the custom properties in index.css. Secondary carries body text and must reach
  // AA; tertiary is for text that repeats information available elsewhere and needs AA-large.
  const LIGHT_INK: [number, number, number] = [60, 60, 67];
  const DARK_INK: [number, number, number] = [235, 235, 245];

  it('light secondary at 0.78 reaches AA on both surfaces', () => {
    expect(contrast(over(LIGHT_INK, 0.78, CARD_LIGHT), CARD_LIGHT)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrast(over(LIGHT_INK, 0.78, PAGE_LIGHT), PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('dark secondary at 0.6 reaches AA', () => {
    expect(contrast(over(DARK_INK, 0.6, CARD_DARK), CARD_DARK)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('tertiary reaches AA-large in both appearances', () => {
    expect(contrast(over(LIGHT_INK, 0.56, CARD_LIGHT), CARD_LIGHT)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrast(over(DARK_INK, 0.48, CARD_DARK), CARD_DARK)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
