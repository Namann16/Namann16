import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { withPrototypeGuard } from '../src/services/parseGuard.js';
import { commitImport, parseWorkbook } from '../src/services/excelImport.js';
import { commitImportSchema, peerSchema, thresholdsSchema } from '../src/validation/schemas.js';

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

  /**
   * An allowlist checked with `map[key]` or `key in map` consults the prototype chain, so every
   * inherited member of Object.prototype passes it. These names must be refused like any other
   * unrecognised field; membership is tested through a Set for exactly this reason.
   */
  const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__'];

  it.each(INHERITED)('refuses the inherited name %s as a mapping target', (name) => {
    const result = commitImport(parsed, { [revenueRow.key]: name }, ['FY25']);
    expect(Object.keys(result.periods[0]!.values)).toHaveLength(0);
    expect(result.skipped.some((s) => /not a recognised financial line item/.test(s.reason))).toBe(true);
  });
});

describe('request validation rejects inherited property names', () => {
  const INHERITED = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];

  it.each(INHERITED)('rejects %s as an import mapping target', (name) => {
    const result = commitImportSchema.safeParse({
      importId: 'abcdefghij',
      mappings: { 'Sheet1::4': name },
      periods: ['FY25'],
    });
    expect(result.success).toBe(false);
  });

  it('still accepts a genuine line item as a mapping target', () => {
    const result = commitImportSchema.safeParse({
      importId: 'abcdefghij',
      mappings: { 'Sheet1::4': 'revenue', 'Sheet1::5': null },
      periods: ['FY25'],
    });
    expect(result.success).toBe(true);
  });

  /**
   * For object KEYS the guarantee is that nothing unrecognised survives parsing. Two mechanisms
   * deliver it: `constructor` and friends are rejected outright by the Set membership test, while
   * `__proto__` is dropped by the parser before the refinement sees it, because assigning that
   * name onto the result object sets a prototype rather than creating a property. Either way the
   * key never reaches storage, which is what the assertion checks.
   */
  it.each(INHERITED)('never lets %s through as a threshold name', (name) => {
    const result = thresholdsSchema.safeParse({ [name]: 1, roicHurdle: 9 });
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(['roicHurdle']);
      expect(Object.prototype.hasOwnProperty.call(result.data, name)).toBe(false);
    }
    // And the prototype itself is untouched either way.
    expect((Object.prototype as Record<string, unknown>)['roicHurdle']).toBeUndefined();
  });

  it('rejects an unrecognised threshold name outright', () => {
    const result = thresholdsSchema.safeParse({ notAThreshold: 1 });
    expect(result.success).toBe(false);
  });

  it('still accepts a genuine threshold', () => {
    expect(thresholdsSchema.safeParse({ roicHurdle: 9 }).success).toBe(true);
  });

  it.each(INHERITED)('never lets %s through as a peer metric name', (name) => {
    const result = peerSchema.safeParse({ name: 'Peer', metrics: { [name]: 1, ebitdaMargin: 12 } });
    if (result.success) {
      expect(Object.keys(result.data.metrics)).toEqual(['ebitdaMargin']);
    }
  });

  it('rejects an unrecognised peer metric outright', () => {
    expect(peerSchema.safeParse({ name: 'Peer', metrics: { madeUpMetric: 1 } }).success).toBe(false);
  });

  it('still accepts a genuine peer metric', () => {
    expect(peerSchema.safeParse({ name: 'Peer', metrics: { ebitdaMargin: 14.2 } }).success).toBe(true);
  });
});
