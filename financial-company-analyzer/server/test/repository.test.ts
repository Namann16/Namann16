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

/**
 * Specification C3 and C4 inputs cross three seams before they reach the engine: Zod validation,
 * the Mongoose document, and the dataset the engine consumes. A field dropped at any one of them
 * disables the explanation tests that depend on it, silently — the analysis still renders, it just
 * stops being able to account for anything. These pin the two seams the application owns.
 */
describe('business context and period flags survive persistence', () => {
  const doc = {
    _id: 'abc',
    name: 'Reference Co',
    industry: 'manufacturing',
    currency: 'INR',
    units: 'crores',
    metricConfig: { roce: { denominator: 'equity_plus_debt', excludeCustomerAdvances: true } },
    sectorProfile: 'defence_capital_goods',
    companyStage: 'mature',
    businessContext: {
      periods: { FY26: { orderBook: 254538, revenueRecognitionBasis: 'over_time_cost_to_cost' } },
    },
    periods: [
      {
        label: 'FY25',
        order: 0,
        unusual: true,
        unusualReason: 'One-off surge in customer advances.',
        values: new Map([['revenue', 30982]]),
        sources: new Map([['revenue', 'entered']]),
      },
    ],
    peers: [],
    thresholds: new Map(),
  };

  it('carries the unusual-period flag off the document', () => {
    const stored = fromDocument(doc);
    expect(stored.periods[0]?.unusual).toBe(true);
    expect(stored.periods[0]?.unusualReason).toBe('One-off surge in customer advances.');
  });

  it('carries the Part B metric configuration and the sector profile', () => {
    const stored = fromDocument(doc);
    expect(stored.company.metricConfig?.roce?.excludeCustomerAdvances).toBe(true);
    expect(stored.company.sectorProfile).toBe('defence_capital_goods');
    expect(stored.company.companyStage).toBe('mature');
  });

  it('hands the business context to the engine rather than dropping it', () => {
    const stored = fromDocument(doc);
    expect(toDataset(stored).businessContext?.periods?.FY26?.orderBook).toBe(254538);
  });
});
