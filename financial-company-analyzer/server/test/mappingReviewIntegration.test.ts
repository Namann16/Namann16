import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applyMappingReview, rowsNeedingReview } from '@fca/core';
import { applyReviewedMappings, commitImport, parseWorkbook } from '../src/services/excelImport.js';

/**
 * The review is only worth anything if a demotion actually stops the import.
 *
 * `commitImport` falls back to the staged `selected` value for any row the client does not send a
 * decision for, so a demotion that existed only in the HTTP response would be silently undone by a
 * client that omitted the row. These tests pin the write-back rather than the model call: the
 * verdicts are supplied directly, which is also the only way to test the demotion path without a
 * live API key.
 */

function workbookBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Financials');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** A filing whose labels include the three the text matcher gets confidently wrong. */
const buffer = workbookBuffer([
  ['Particulars', 'FY2025', 'FY2024'],
  ['Revenue from operations', 12000, 10000],
  ['Profit before exceptional items and tax', 2100, 1800],
  ['Borrowings (non-current)', 3400, 3900],
  ['Trade payables', 1200, 1100],
]);

function parse() {
  return parseWorkbook(buffer, { fileName: 'filing.xlsx' });
}

function find(parsed: ReturnType<typeof parse>, label: string) {
  const index = parsed.mappings.findIndex((m) => m.sourceLabel === label);
  expect(index, `expected a row for "${label}"`).toBeGreaterThanOrEqual(0);
  return { index, mapping: parsed.mappings[index]! };
}

describe('the hole the review closes', () => {
  it('auto-applies a wrong mapping with no confirmation when nothing reviews it', () => {
    const parsed = parse();
    const { mapping } = find(parsed, 'Profit before exceptional items and tax');
    // Not an assertion about what is correct — an assertion about what happens today.
    expect(mapping.selected).toBe('exceptionalItems');
    expect(mapping.requiresConfirmation).toBe(false);

    // A client that simply accepts the proposal sends no decisions at all.
    const result = commitImport(parsed, {}, ['FY25']);
    const targets = result.applied.map((a) => a.target);
    expect(targets).toContain('exceptionalItems');
  });
});

describe('a demotion written back to the staged import', () => {
  it('stops the row being imported even when the client omits a decision', () => {
    const parsed = parse();
    const { index } = find(parsed, 'Profit before exceptional items and tax');

    const review = applyMappingReview(parsed.mappings, [
      { index, agrees: false, betterKey: 'ebit', why: 'A profit line that only mentions exceptional items.' },
    ]);
    expect(review.demoted).toBe(1);
    applyReviewedMappings(parsed, review.candidates);

    const result = commitImport(parsed, {}, ['FY25']);
    const targets = result.applied.map((a) => a.target);
    // The wrong field is not written...
    expect(targets).not.toContain('exceptionalItems');
    // ...and the reviewer's alternative is not written either: it was a suggestion, not a decision.
    expect(targets).not.toContain('ebit');
    // The row is reported as skipped rather than vanishing quietly.
    expect(result.skipped.some((s) => s.label === 'Profit before exceptional items and tax')).toBe(true);
    // Rows nobody objected to still import normally.
    expect(targets).toContain('revenue');
  });

  it('lets the user apply the reviewer\'s alternative by confirming it', () => {
    const parsed = parse();
    const { index, mapping } = find(parsed, 'Profit before exceptional items and tax');
    const review = applyMappingReview(parsed.mappings, [
      { index, agrees: false, betterKey: 'ebit', why: 'A profit line.' },
    ]);
    applyReviewedMappings(parsed, review.candidates);

    const rowKey = `${mapping.sheet}::${mapping.sourceRow - 1}`;
    const result = commitImport(parsed, { [rowKey]: 'ebit' }, ['FY25']);
    expect(result.applied.map((a) => a.target)).toContain('ebit');
  });

  it('keeps the summary honest about how many rows now need confirming', () => {
    const parsed = parse();
    const before = parsed.summary.needsConfirmation;
    const mapped = parsed.summary.mapped;

    const band = rowsNeedingReview(parsed.mappings);
    expect(band.length).toBeGreaterThan(0);
    const review = applyMappingReview(
      parsed.mappings,
      band.map(({ index }) => ({ index, agrees: false, betterKey: null, why: 'Rejected.' })),
    );
    applyReviewedMappings(parsed, review.candidates);

    expect(parsed.summary.needsConfirmation).toBe(before + band.length);
    expect(parsed.summary.mapped).toBe(mapped - band.length);
  });

  it('does not touch the staged plan when the candidate list does not line up', () => {
    const parsed = parse();
    const original = parsed.mappings;
    applyReviewedMappings(parsed, original.slice(1));
    expect(parsed.mappings).toBe(original);
  });
});
