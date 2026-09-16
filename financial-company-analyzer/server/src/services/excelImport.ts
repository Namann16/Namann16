import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { withPrototypeGuard } from './parseGuard.js';
import {
  AUTO_MAP_CONFIDENCE,
  LINE_ITEM_MAP,
  isLineItemKey,
  buildMappingPlan,
  isSectionHeader,
  parseCellValue,
  parsePeriodLabel,
  suggestMappings,
  type CompanyProfile,
  type FinancialPeriod,
  type MappingCandidate,
  type Num,
  type Units,
} from '@fca/core';

/**
 * Intelligent Excel import.
 *
 * The workflow is deliberately two-stage: parse and propose, then commit what the user confirmed.
 * A mapping below the auto-map confidence is never applied silently — the review screen surfaces
 * it and asks. Values that cannot be read are left absent rather than coerced to zero.
 */

export interface ParsedRow {
  /** Stable key for this row, used to round-trip the user's mapping decision. */
  key: string;
  sheet: string;
  row: number;
  label: string;
  /** True when at least one period column held a readable number. */
  hasValues: boolean;
  /** Raw values by period header, as read from the sheet. */
  cells: Record<string, { value: Num; raw: string; interpretation: string; warning?: string }>;
}

export interface DetectedPeriod {
  /** Normalised label, e.g. "FY24". */
  label: string;
  /** The header text exactly as it appears in the workbook. */
  header: string;
  sheet: string;
  column: number;
  year: number | null;
}

export interface ImportWarning {
  level: 'warning' | 'error';
  message: string;
  sheet?: string;
  row?: number;
}

export interface ParsedImport {
  importId: string;
  fileName: string;
  sheets: string[];
  detectedCompany: Partial<CompanyProfile>;
  periods: DetectedPeriod[];
  rows: ParsedRow[];
  mappings: MappingCandidate[];
  warnings: ImportWarning[];
  summary: ImportSummary;
}

export interface ImportSummary {
  rowsRead: number;
  fieldsDetected: number;
  mapped: number;
  needsConfirmation: number;
  unmapped: number;
  periodsDetected: number;
  warnings: number;
  errors: number;
}

/** Parsed uploads waiting for the user to confirm their mapping. */
const pending = new Map<string, { parsed: ParsedImport; expiresAt: number }>();
const IMPORT_TTL_MS = 30 * 60 * 1000;

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of pending) if (entry.expiresAt < now) pending.delete(id);
}

export function retrieveImport(importId: string): ParsedImport | null {
  sweep();
  return pending.get(importId)?.parsed ?? null;
}

export function discardImport(importId: string): void {
  pending.delete(importId);
}

const COMPANY_FIELD_ALIASES: Record<string, keyof CompanyProfile> = {
  'company name': 'name',
  company: 'name',
  name: 'name',
  industry: 'industry',
  sector: 'sector',
  country: 'country',
  currency: 'currency',
  units: 'units',
  unit: 'units',
  'financial year end': 'fiscalYearEnd',
  'fiscal year end': 'fiscalYearEnd',
  'reporting period': 'reportingPeriod',
  ticker: 'ticker',
  'stock ticker': 'ticker',
  benchmark: 'benchmark',
  'benchmark index': 'benchmark',
  'market capitalisation': 'marketCap',
  'market capitalization': 'marketCap',
  'market cap': 'marketCap',
  'share price': 'sharePrice',
  'shares outstanding': 'sharesOutstanding',
};

const VALID_UNITS = new Set<Units>(['units', 'thousands', 'lakhs', 'millions', 'crores', 'billions']);

/** Read the Company Information sheet, when the workbook has one. */
function readCompanySheet(workbook: XLSX.WorkBook, warnings: ImportWarning[]): Partial<CompanyProfile> {
  const sheetName = workbook.SheetNames.find((n) => /company|info|cover|general/i.test(n));
  if (!sheetName) return {};
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, { header: 1, blankrows: false, defval: null });

  const profile: Partial<CompanyProfile> = {};
  for (const row of rows) {
    const label = String(row?.[0] ?? '').trim().toLowerCase();
    const raw = row?.[1];
    if (!label || raw === null || raw === undefined || String(raw).trim() === '') continue;

    const field = COMPANY_FIELD_ALIASES[label];
    if (!field) continue;

    const text = String(raw).trim();
    switch (field) {
      case 'marketCap':
      case 'sharePrice':
      case 'sharesOutstanding': {
        const parsed = parseCellValue(raw);
        if (parsed.value !== null) (profile as Record<string, unknown>)[field] = parsed.value;
        break;
      }
      case 'units': {
        const normalized = text.toLowerCase() as Units;
        if (VALID_UNITS.has(normalized)) profile.units = normalized;
        else warnings.push({ level: 'warning', message: `Units "${text}" were not recognised and have been left for you to set.`, sheet: sheetName });
        break;
      }
      case 'currency': {
        const code = text.toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) (profile as Record<string, unknown>).currency = code;
        break;
      }
      default:
        (profile as Record<string, unknown>)[field] = text;
    }
  }
  return profile;
}

/** Locate the header row of a statement sheet and the period columns it declares. */
function detectHeader(rows: unknown[][], sheetName: string): { headerRow: number; periods: DetectedPeriod[] } {
  let best: { headerRow: number; periods: DetectedPeriod[] } = { headerRow: -1, periods: [] };

  for (let r = 0; r < Math.min(rows.length, 25); r += 1) {
    const row = rows[r] ?? [];
    const periods: DetectedPeriod[] = [];
    for (let c = 1; c < row.length; c += 1) {
      const parsed = parsePeriodLabel(row[c]);
      if (parsed) {
        periods.push({ label: parsed.label, header: parsed.raw, sheet: sheetName, column: c, year: parsed.year });
      }
    }
    if (periods.length > best.periods.length) best = { headerRow: r, periods };
  }
  return best;
}

export interface ParseOptions {
  fileName: string;
  /** Units the user declared for the upload; detected units from the workbook take precedence. */
  units?: Units;
}

export function parseWorkbook(buffer: Buffer, options: ParseOptions): ParsedImport {
  const warnings: ImportWarning[] = [];

  let workbook: XLSX.WorkBook;
  try {
    // cellDates keeps date headers as Date objects so period detection can read them.
    // Formula and HTML evaluation stay off, and the parse runs under a prototype guard because
    // the bytes are attacker controlled — see services/parseGuard.ts.
    workbook = withPrototypeGuard(() =>
      XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false }),
    );
  } catch (error) {
    if ((error as { status?: number }).status === 400) throw error;
    throw Object.assign(new Error(`The file could not be read as a spreadsheet: ${(error as Error).message}`), {
      status: 400,
    });
  }

  if (workbook.SheetNames.length === 0) {
    throw Object.assign(new Error('The workbook contains no sheets.'), { status: 400 });
  }

  const detectedCompany = readCompanySheet(workbook, warnings);
  const units = (detectedCompany.units ?? options.units ?? 'units') as Units;

  const rows: ParsedRow[] = [];
  const periodMap = new Map<string, DetectedPeriod>();

  for (const sheetName of workbook.SheetNames) {
    if (/company|info|cover|general|segment|notes?|instructions?/i.test(sheetName)) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
    const { headerRow, periods } = detectHeader(grid, sheetName);

    if (headerRow === -1 || periods.length === 0) {
      warnings.push({
        level: 'warning',
        sheet: sheetName,
        message: `No financial-year columns were recognised on "${sheetName}", so the sheet was skipped. Headers such as FY24, 2023-24 or 31-Mar-2024 are recognised.`,
      });
      continue;
    }

    for (const period of periods) {
      // Keep the first sheet's column position for a label; later sheets reuse the same label.
      if (!periodMap.has(period.label)) periodMap.set(period.label, period);
    }

    for (let r = headerRow + 1; r < grid.length; r += 1) {
      const row = grid[r] ?? [];
      const label = String(row[0] ?? '').trim();
      if (!label) continue;

      const cells: ParsedRow['cells'] = {};
      let hasValue = false;
      for (const period of periods) {
        const parsed = parseCellValue(row[period.column], units);
        cells[period.label] = {
          value: parsed.value,
          raw: parsed.raw,
          interpretation: parsed.interpretation,
          ...(parsed.warning ? { warning: parsed.warning } : {}),
        };
        if (parsed.value !== null) hasValue = true;
        if (parsed.warning && parsed.interpretation === 'text') {
          warnings.push({ level: 'warning', sheet: sheetName, row: r + 1, message: `${label} (${period.label}): ${parsed.warning}` });
        }
      }

      // A row with no numbers at all is either a section header or a note; keep headers so the
      // review screen can show the document structure, and drop free text.
      if (!hasValue && !isSectionHeader(label, { hasValues: false })) {
        const plausible = suggestMappings(label).length > 0;
        if (!plausible) continue;
      }

      rows.push({ key: `${sheetName}::${r}`, sheet: sheetName, row: r + 1, label, cells, hasValues: hasValue });
    }
  }

  const mappings = buildMappingPlan(
    rows.map((r) => ({ label: r.label, row: r.row, sheet: r.sheet, hasValues: r.hasValues })),
  );
  // Re-key the plan against the row keys so the client can round-trip a decision unambiguously.
  const keyedMappings = mappings.map((m, i) => ({ ...m, sourceLabel: rows[i]?.label ?? m.sourceLabel }));

  const detectedPeriods = [...periodMap.values()].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  if (detectedPeriods.length === 0) {
    // Without period columns there is nothing the user could import, so this is an outright
    // failure rather than a warning on an otherwise usable review screen.
    throw Object.assign(
      new Error(
        `No financial years could be identified in "${options.fileName}". The importer looks for a header row containing year labels such as FY24, 2023-24, Mar-24 or 31-Mar-2024. ` +
          `Sheets examined: ${workbook.SheetNames.join(', ')}.`,
      ),
      { status: 400 },
    );
  }

  const summary: ImportSummary = {
    rowsRead: rows.length,
    fieldsDetected: rows.filter((r) => !isSectionHeader(r.label, { hasValues: r.hasValues })).length,
    mapped: keyedMappings.filter((m) => m.selected !== null).length,
    needsConfirmation: keyedMappings.filter((m) => m.requiresConfirmation && m.suggestions.length > 0).length,
    unmapped: keyedMappings.filter((m) => m.selected === null && m.suggestions.length === 0 && !m.isSectionHeader).length,
    periodsDetected: detectedPeriods.length,
    warnings: warnings.filter((w) => w.level === 'warning').length,
    errors: warnings.filter((w) => w.level === 'error').length,
  };

  const parsed: ParsedImport = {
    importId: randomUUID(),
    fileName: options.fileName,
    sheets: workbook.SheetNames,
    detectedCompany: { ...detectedCompany, units },
    periods: detectedPeriods,
    rows,
    mappings: keyedMappings,
    warnings,
    summary,
  };

  sweep();
  pending.set(parsed.importId, { parsed, expiresAt: Date.now() + IMPORT_TTL_MS });
  return parsed;
}

export interface CommitResult {
  periods: FinancialPeriod[];
  applied: { rowKey: string; label: string; target: string; periodsFilled: number }[];
  skipped: { rowKey: string; label: string; reason: string }[];
  warnings: ImportWarning[];
}

/**
 * Apply a confirmed mapping and produce financial periods.
 *
 * Only mappings the user confirmed (or that scored at or above the auto-map confidence) are
 * applied. Where two confirmed rows target the same line item for the same period, the first is
 * kept and the collision is reported rather than one silently overwriting the other.
 */
export function commitImport(
  parsed: ParsedImport,
  decisions: Record<string, string | null>,
  selectedPeriods: string[],
): CommitResult {
  const warnings: ImportWarning[] = [];
  const applied: CommitResult['applied'] = [];
  const skipped: CommitResult['skipped'] = [];

  const periods: FinancialPeriod[] = selectedPeriods.map((label, index) => {
    const detected = parsed.periods.find((p) => p.label === label);
    return {
      label,
      endDate: detected?.year ? `${detected.year}-12-31` : null,
      order: index,
      values: {},
      sources: {},
    };
  });

  const claimed = new Map<string, string>(); // `${target}::${period}` -> row key

  for (const row of parsed.rows) {
    const decision = Object.prototype.hasOwnProperty.call(decisions, row.key)
      ? decisions[row.key]
      : parsed.mappings.find((m) => m.sourceRow === row.row && m.sheet === row.sheet)?.selected ?? null;

    if (!decision) {
      if (!isSectionHeader(row.label, { hasValues: row.hasValues })) {
        skipped.push({ rowKey: row.key, label: row.label, reason: 'No field was selected for this row, so it was not imported.' });
      }
      continue;
    }

    // The mapping target arrives from the client, so it is checked against the canonical registry
    // here as well. Without this, the import route would be a way around the allowlist that the
    // manual-input route enforces, and arbitrary keys could be written into a stored period.
    // A Set membership test, not a lookup on the registry object: that object inherits from
    // Object.prototype, so `LINE_ITEM_MAP['constructor']` is truthy and a bracket check here
    // would let inherited names straight through the allowlist.
    if (!isLineItemKey(decision)) {
      skipped.push({
        rowKey: row.key,
        label: row.label,
        reason: `"${decision}" is not a recognised financial line item, so this row was not imported.`,
      });
      warnings.push({
        level: 'warning',
        sheet: row.sheet,
        row: row.row,
        message: `"${row.label}" was mapped to an unrecognised field ("${decision}") and has been skipped.`,
      });
      continue;
    }

    let filled = 0;
    for (const period of periods) {
      const cell = row.cells[period.label];
      if (!cell || cell.value === null) continue;

      const claimKey = `${decision}::${period.label}`;
      const existing = claimed.get(claimKey);
      if (existing && existing !== row.key) {
        warnings.push({
          level: 'warning',
          sheet: row.sheet,
          row: row.row,
          message: `"${row.label}" also maps to the same field as an earlier row for ${period.label}. The first value was kept and this one ignored.`,
        });
        continue;
      }

      // Sign conventions differ between sources: some statements present costs and capital
      // expenditure as negatives, others as positives. Where the canonical line item declares a
      // positive convention, the magnitude is taken and the adjustment is reported — never
      // applied silently, because a genuine sign error would otherwise disappear.
      let value = cell.value;
      // Safe to look up directly: `decision` was checked against the registry above.
      const definition = LINE_ITEM_MAP[decision];
      if (definition?.sign === 'positive' && value < 0) {
        warnings.push({
          level: 'warning',
          sheet: row.sheet,
          row: row.row,
          message: `"${row.label}" was reported as ${value} for ${period.label}. ${definition.label} is held as a positive amount in this application, so ${Math.abs(value)} was imported. Check that the sign convention of the source was as expected.`,
        });
        value = Math.abs(value);
      }

      period.values[decision] = value;
      period.sources[decision] = 'entered';
      claimed.set(claimKey, row.key);
      filled += 1;
    }

    if (filled === 0) {
      skipped.push({ rowKey: row.key, label: row.label, reason: 'The row mapped to a field but contained no readable values for the selected periods.' });
    } else {
      applied.push({ rowKey: row.key, label: row.label, target: decision, periodsFilled: filled });
    }
  }

  const empty = periods.filter((p) => Object.keys(p.values).length === 0);
  for (const period of empty) {
    warnings.push({ level: 'warning', message: `No values were imported for ${period.label}. The period has been created but is empty.` });
  }

  return { periods, applied, skipped, warnings };
}

export { AUTO_MAP_CONFIDENCE };
