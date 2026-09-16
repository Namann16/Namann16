import { describe, expect, it } from 'vitest';
import { analyze } from '@fca/core';
import { fromDocument, mapToObject, toDataset } from '../src/services/repository.js';

/**
 * The persistence seam.
 *
 * Mongoose stores the open-ended line-item map as a schema `Map`, which comes back as a `Map`
 * instance from a hydrated document and as a plain object from `.lean()`. If that conversion is
 * wrong, a saved analysis silently loses line items — the numbers would not be incorrect, they
 * would be missing, which is harder to notice. These tests pin both shapes.
 *
 * A live MongoDB is not available in this environment, so the driver round trip itself is not
 * covered here; this exercises the mapping the application owns.
 */

describe('map conversion', () => {
  it('reads a Mongoose Map', () => {
    expect(mapToObject(new Map([['revenue', 1000], ['cogs', 600]]))).toEqual({ revenue: 1000, cogs: 600 });
  });

  it('reads a lean plain object', () => {
    expect(mapToObject({ revenue: 1000 })).toEqual({ revenue: 1000 });
  });

  it('treats an absent map as empty rather than throwing', () => {
    expect(mapToObject(undefined)).toEqual({});
    expect(mapToObject(null)).toEqual({});
  });

  it('preserves a genuine zero', () => {
    // A reported zero must survive persistence as 0, not become absent.
    expect(mapToObject(new Map([['exceptionalItems', 0]]))).toEqual({ exceptionalItems: 0 });
  });
});

describe('document to domain conversion', () => {
  const doc = {
    _id: 'abc123',
    name: 'Persisted Co Ltd.',
    industry: 'manufacturing',
    sector: 'Industrials',
    country: null,
    currency: 'INR',
    units: 'crores',
    reportingPeriod: 'annual',
    ticker: null,
    marketCap: null,
    isSample: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    periods: [
      {
        label: 'FY25', order: 0, endDate: '2025-03-31', isPartial: false,
        values: new Map<string, number>([['revenue', 900], ['cogs', 540], ['totalAssets', 1000], ['totalEquity', 520], ['totalLiabilities', 480]]),
        sources: new Map<string, string>([['revenue', 'entered'], ['cogs', 'entered']]),
      },
      {
        label: 'FY26', order: 1, endDate: '2026-03-31', isPartial: false,
        values: new Map<string, number>([['revenue', 1000], ['cogs', 600], ['totalAssets', 1060], ['totalEquity', 560], ['totalLiabilities', 500]]),
        sources: new Map<string, string>([['revenue', 'entered'], ['cogs', 'entered']]),
      },
    ],
    peers: [{ name: 'Rival Ltd.', source: 'Manual', metrics: new Map<string, number>([['ebitdaMargin', 14.2]]) }],
    thresholds: new Map<string, number>([['netDebtToEbitdaHigh', 2.5]]),
  };

  const stored = fromDocument(doc);

  it('recovers the company profile', () => {
    expect(stored.id).toBe('abc123');
    expect(stored.company.name).toBe('Persisted Co Ltd.');
    expect(stored.company.industry).toBe('manufacturing');
    expect(stored.company.units).toBe('crores');
  });

  it('recovers every line item from both periods', () => {
    expect(stored.periods).toHaveLength(2);
    expect(stored.periods[0]!.values['revenue']).toBe(900);
    expect(stored.periods[1]!.values['revenue']).toBe(1000);
    expect(stored.periods[1]!.sources['cogs']).toBe('entered');
  });

  it('recovers peers and threshold overrides', () => {
    expect(stored.peers?.[0]!.name).toBe('Rival Ltd.');
    expect(stored.peers?.[0]!.metrics['ebitdaMargin']).toBe(14.2);
    expect(stored.thresholds?.netDebtToEbitdaHigh).toBe(2.5);
  });

  it('produces a dataset the engine can analyse, with the stored threshold in force', () => {
    const result = analyze(toDataset(stored));
    expect(result.company.name).toBe('Persisted Co Ltd.');
    expect(result.latestPeriod).toBe('FY26');
    expect(result.metrics['grossMargin']!.latest!.value).toBe(40);
    // The per-company override must beat the manufacturing industry default of 3.0.
    expect(result.thresholds.netDebtToEbitdaHigh).toBe(2.5);
  });
});
