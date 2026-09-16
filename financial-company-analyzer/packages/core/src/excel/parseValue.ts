import type { Num, Units } from '../types.js';
import { UNIT_MULTIPLIERS, isNum } from '../utils/number.js';

export interface ParsedCell {
  value: Num;
  /** How the raw text was interpreted, surfaced in the import review screen. */
  interpretation: 'number' | 'negative_parentheses' | 'percentage' | 'blank' | 'text' | 'scaled';
  raw: string;
  warning?: string;
}

const CURRENCY_CHARS = /[₹$€£¥]|Rs\.?|INR|USD|EUR|GBP|JPY/gi;
/** Magnitude suffixes commonly used in financial disclosures. */
const SUFFIXES: { pattern: RegExp; multiplier: number; label: string }[] = [
  { pattern: /\b(cr|crore|crores)\b\.?$/i, multiplier: UNIT_MULTIPLIERS.crores, label: 'crores' },
  { pattern: /\b(lakh|lakhs|lac|lacs)\b\.?$/i, multiplier: UNIT_MULTIPLIERS.lakhs, label: 'lakhs' },
  { pattern: /\b(bn|billion|billions)\b\.?$/i, multiplier: UNIT_MULTIPLIERS.billions, label: 'billions' },
  { pattern: /\b(mn|m|million|millions)\b\.?$/i, multiplier: UNIT_MULTIPLIERS.millions, label: 'millions' },
  { pattern: /\b(k|thousand|thousands)\b\.?$/i, multiplier: UNIT_MULTIPLIERS.thousands, label: 'thousands' },
];

const BLANK_TOKENS = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'nil', 'nm', 'not available', 'null', '#n/a', '#value!', '#div/0!']);

/**
 * Parse a spreadsheet cell into a number.
 *
 * Handles thousands separators (both Western and Indian grouping), currency symbols,
 * parentheses for negatives, trailing minus signs, percentages and magnitude suffixes.
 * A cell that cannot be interpreted returns `null` — never zero — so that missing data
 * stays distinguishable from a genuine zero downstream.
 */
export function parseCellValue(raw: unknown, targetUnits?: Units): ParsedCell {
  if (raw === null || raw === undefined) {
    return { value: null, interpretation: 'blank', raw: '' };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { value: raw, interpretation: 'number', raw: String(raw) }
      : { value: null, interpretation: 'blank', raw: String(raw) };
  }
  if (typeof raw === 'boolean') {
    return { value: null, interpretation: 'text', raw: String(raw), warning: 'Boolean cell ignored.' };
  }
  if (raw instanceof Date) {
    return { value: null, interpretation: 'text', raw: raw.toISOString(), warning: 'Date cell ignored in a numeric field.' };
  }

  const original = String(raw).trim();
  if (BLANK_TOKENS.has(original.toLowerCase())) {
    return { value: null, interpretation: 'blank', raw: original };
  }

  let text = original;
  let negative = false;
  let interpretation: ParsedCell['interpretation'] = 'number';
  let warning: string | undefined;

  // Parentheses denote a negative value in financial statements.
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) {
    negative = true;
    interpretation = 'negative_parentheses';
    text = parenthesised[1]!.trim();
  }

  // Trailing minus, e.g. "1,234-".
  if (/-$/.test(text)) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  }

  text = text.replace(CURRENCY_CHARS, '').trim();

  const isPercent = /%\s*$/.test(text);
  if (isPercent) {
    interpretation = 'percentage';
    text = text.replace(/%\s*$/, '').trim();
  }

  let multiplier = 1;
  for (const suffix of SUFFIXES) {
    if (suffix.pattern.test(text)) {
      multiplier = suffix.multiplier;
      text = text.replace(suffix.pattern, '').trim();
      interpretation = 'scaled';
      warning = `Value was expressed in ${suffix.label} and has been converted.`;
      break;
    }
  }

  // Remove grouping separators and any remaining whitespace.
  text = text.replace(/[,\s ']/g, '');

  if (text === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(text)) {
    return {
      value: null,
      interpretation: 'text',
      raw: original,
      warning: `"${original}" could not be read as a number and has been left empty rather than treated as zero.`,
    };
  }

  let value = Number(text);
  if (!Number.isFinite(value)) {
    return { value: null, interpretation: 'text', raw: original, warning: `"${original}" is not a finite number.` };
  }

  if (negative) value = -value;
  if (isPercent) value = value / 100;
  if (multiplier !== 1) {
    // Convert from the detected magnitude into the workbook's declared units.
    const targetMultiplier = targetUnits ? UNIT_MULTIPLIERS[targetUnits] : 1;
    value = (value * multiplier) / (targetMultiplier || 1);
  }

  return { value, interpretation, raw: original, ...(warning ? { warning } : {}) };
}

/**
 * Recognise a period label from a header cell.
 *
 * Accepts FY24, FY2024, 2024, 2023-24, 31-Mar-2024, "Mar'24", "Year ended 31 March 2024"
 * and similar forms, and normalises them to a consistent FYxx label.
 */
export function parsePeriodLabel(raw: unknown): { label: string; year: number | null; raw: string } | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) {
    const year = raw.getUTCFullYear();
    return { label: `FY${String(year).slice(-2)}`, year, raw: raw.toISOString().slice(0, 10) };
  }

  const text = String(raw).trim();
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ');

  // FY24 / FY2024 / FY 2023-24 / F.Y. 2024
  const fy = /f\.?y\.?\s*'?(\d{2,4})(?:\s*[-/–]\s*'?(\d{2,4}))?/i.exec(normalized);
  if (fy) {
    const end = fy[2] ?? fy[1]!;
    const year = normaliseYear(end);
    return { label: `FY${String(year).slice(-2)}`, year, raw: text };
  }

  // 2023-24 / 2023-2024 / FY ranges without the FY prefix
  const range = /\b(\d{4})\s*[-/–]\s*(\d{2,4})\b/.exec(normalized);
  if (range) {
    const year = normaliseYear(range[2]!);
    return { label: `FY${String(year).slice(-2)}`, year, raw: text };
  }

  // Month-year forms, e.g. "Mar-24", "March 2024", "31-Mar-2024"
  const monthYear = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s'\-/]*(\d{2,4})/i.exec(normalized);
  if (monthYear) {
    const year = normaliseYear(monthYear[2]!);
    return { label: `FY${String(year).slice(-2)}`, year, raw: text };
  }

  // Bare year
  const bare = /\b(19|20)(\d{2})\b/.exec(normalized);
  if (bare) {
    const year = Number(`${bare[1]}${bare[2]}`);
    return { label: `FY${bare[2]}`, year, raw: text };
  }

  return null;
}

function normaliseYear(fragment: string): number {
  const n = Number(fragment);
  if (fragment.length === 4) return n;
  // Two-digit years: 00-79 map to 2000s, 80-99 to 1900s.
  return n <= 79 ? 2000 + n : 1900 + n;
}
