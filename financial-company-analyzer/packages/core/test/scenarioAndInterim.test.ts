import { describe, expect, it } from 'vitest';
import { analyze, analyzeScenario, calculateMetrics } from '../src/index.js';
import { approx, dataset, period } from './helpers.js';

describe('scenario analysis', () => {
  it('runs a what-if without mutating the base dataset', () => {
    const input = dataset([
      period('Q1', 0, { revenue: 100, cogs: 60, ppe: 40 }),
      period('Q2', 1, { revenue: 110, cogs: 66, ppe: 42 }),
    ], { company: { industry: 'manufacturing' } });
    const before = analyze(input);
    const result = analyzeScenario(input, [{ period: 'Q2', values: { revenue: 121 } }]);

    expect(input.periods[1]?.values.revenue).toBe(110);
    expect(result.base.metrics.revenue.latest?.value).toBe(before.metrics.revenue.latest?.value);
    expect(result.scenario.metrics.revenue.latest?.value).toBe(121);
    expect(result.metricChanges.some((change) => change.key === 'revenue' && change.delta === 11)).toBe(true);
  });
});

describe('opt-in interim annualization', () => {
  it('annualizes quarterly growth and days metrics only when enabled', () => {
    const periods = [
      period('Q1', 0, { revenue: 100, accountsReceivable: 25, cogs: 60, inventory: 12, accountsPayable: 15 }),
      period('Q2', 1, { revenue: 110, accountsReceivable: 25, cogs: 66, inventory: 12, accountsPayable: 15 }),
    ];
    const raw = calculateMetrics(periods, 'general', { reportingPeriod: 'quarterly' });
    const annualized = calculateMetrics(periods, 'general', { reportingPeriod: 'quarterly', annualizeInterimMetrics: true });

    expect(approx(raw.revenueGrowth?.latest?.value ?? null, 10)).toBe(true);
    expect(approx(annualized.revenueGrowth?.latest?.value ?? null, 46.41, 0.02)).toBe(true);
    expect(approx(annualized.dso?.latest?.value ?? null, 20.74, 0.02)).toBe(true);
    expect(annualized.dso?.latest?.note).toContain('Annualized from quarterly');
  });

  it('annualizes turnover and return metrics while preserving annual values', () => {
    const periods = [
      period('Q1', 0, { revenue: 100, cogs: 60, inventory: 15, totalAssets: 100, totalEquity: 50, netIncome: 2 }),
      period('Q2', 1, { revenue: 100, cogs: 60, inventory: 15, totalAssets: 100, totalEquity: 50, netIncome: 5 }),
    ];
    const annualized = calculateMetrics(periods, 'general', { reportingPeriod: 'quarterly', annualizeInterimMetrics: true });

    expect(annualized.inventoryTurnover?.latest?.value).toBe(16);
    expect(annualized.assetTurnover?.latest?.value).toBe(4);
    expect(annualized.roe?.latest?.value).toBe(40);
    expect(annualized.inventoryTurnover?.formula).toContain('Annualized COGS');
  });
});

describe('industry-specific metrics', () => {
  it('exposes capital intensity only for supported capital-intensive industries', () => {
    const periods = [period('FY25', 0, { revenue: 100, ppe: 45 })];
    const manufacturing = analyze(dataset(periods, { company: { industry: 'manufacturing' } }));
    const retail = analyze(dataset(periods, { company: { industry: 'retail' } }));

    expect(manufacturing.metrics.capitalIntensity?.latest?.value).toBe(45);
    expect(retail.metrics.capitalIntensity?.points[0]?.status).toBe('not_applicable');
  });

  it('calculates banking and retail-specific first-release metrics', () => {
    const banking = analyze(dataset([
      period('FY24', 0, { netInterestIncome: 12, interestEarningAssets: 100, operatingExpenses: 5, otherIncome: 3 }),
    ], { company: { industry: 'banking' } }));
    const retail = analyze(dataset([
      period('FY24', 0, { sameStoreRevenue: 100 }),
      period('FY25', 1, { sameStoreRevenue: 110 }),
    ], { company: { industry: 'retail' } }));

    expect(banking.metrics.netInterestMargin?.latest?.value).toBe(12);
    expect(banking.metrics.costToIncome?.latest?.value).toBe(33.3333);
    expect(retail.metrics.sameStoreSalesGrowth?.latest?.value).toBe(10);
  });
});
