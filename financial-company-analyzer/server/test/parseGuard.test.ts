import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { withPrototypeGuard } from '../src/services/parseGuard.js';
import { commitImport, parseWorkbook } from '../src/services/excelImport.js';

/**
 * Defences around parsing untrusted spreadsheets.
 *
 * The workbook parser is the only place attacker-controlled bytes reach a third-party library,
 * and the mapping a client confirms is the only place a client names a storage key. Both are
 * bounded here rather than trusted.
 */

describe('prototype pollution guard', () => {
  it('lets a clean operation through untouched', () => {
    expect(withPrototypeGuard(() => 'parsed')).toBe('parsed');
  });

  it('reverts a polluted prototype and rejects the operation', () => {
    expect(() =>
      withPrototypeGuard(() => {
        (Object.prototype as Record<string, unknown>)['pollutedByTest'] = 'compromised';
        return 'parsed';
      }),
    ).toThrow(/modify built-in JavaScript prototypes/);

    // The important assertion: the pollution did not survive.
    expect('pollutedByTest' in {}).toBe(false);
    expect(({} as Record<string, unknown>)['pollutedByTest']).toBeUndefined();
  });

  it('cleans up when the operation pollutes and then throws', () => {
    expect(() =>
      withPrototypeGuard(() => {
        (Array.prototype as unknown as Record<string, unknown>)['pollutedByTest2'] = 'compromised';
        throw new Error('parser blew up');
      }),
    ).toThrow('parser blew up');

    expect('pollutedByTest2' in []).toBe(false);
  });

  it('carries a 400 so the route answers with a client error', () => {
    try {
      withPrototypeGuard(() => {
        (Object.prototype as Record<string, unknown>)['pollutedByTest3'] = 1;
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400);
    }
    expect('pollutedByTest3' in {}).toBe(false);
  });
});

describe('import mapping targets are validated server-side', () => {
  const buffer = XLSX.write(
    (() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([['Particulars', 'FY25', 'FY26'], ['Revenue', 1000, 1200]]),
        'PL',
      );
      return wb;
    })(),
    { type: 'buffer', bookType: 'xlsx' },
  ) as Buffer;

  const parsed = parseWorkbook(buffer, { fileName: 'simple.xlsx' });
  const revenueRow = parsed.rows.find((r) => r.label === 'Revenue')!;

  it('accepts a target that is in the canonical registry', () => {
    const result = commitImport(parsed, { [revenueRow.key]: 'revenue' }, ['FY25', 'FY26']);
    expect(result.periods[0]!.values['revenue']).toBe(1000);
  });

  it('refuses a target that is not a real line item, rather than storing it', () => {
    // The client could send any string here; the route must not take it on trust.
    const result = commitImport(parsed, { [revenueRow.key]: 'arbitraryInjectedKey' }, ['FY25']);
    expect(result.periods[0]!.values['arbitraryInjectedKey']).toBeUndefined();
    expect(Object.keys(result.periods[0]!.values)).toHaveLength(0);
    expect(result.skipped.some((s) => /not a recognised financial line item/.test(s.reason))).toBe(true);
  });

  it('refuses a prototype-shaped target without disturbing the prototype', () => {
    const result = commitImport(parsed, { [revenueRow.key]: '__proto__' }, ['FY25']);
    expect(Object.keys(result.periods[0]!.values)).toHaveLength(0);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
