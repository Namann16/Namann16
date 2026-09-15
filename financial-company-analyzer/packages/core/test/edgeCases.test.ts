import { describe, expect, it } from 'vitest';
import { analyze, calculateMetrics, normalizePeriods } from '../src/index.js';
import { dataset, period } from './helpers.js';

/**
 * The engine must never invent a number. These tests pin the behaviour for the awkward inputs
 * that a real analyst runs into: missing statements, zero denominators, losses, negative equity
 * and single-year datasets.
 */

describe('missing data is reported, never assumed', () => {
  it('reports ratios as unavailable rather than zero when inputs are missing', () => {
    const result = analyze(dataset([period('FY24', 0, { revenue: 1000, cogs: 600 })]));
    const currentRatio = result.metrics['currentRatio']!.points[0]!;
    expect(currentRatio.value).toBeNull();
    expect(currentRatio.status).toBe('insufficient_data');
    expect(currentRatio.note).toMatch(/requires/i);
    // The metric still carries its formula and inputs so the user can see what is missing.
    expect(currentRatio.formula).toBeTruthy();
    expect(Object.keys(currentRatio.inputs)).toContain('totalCurrentAssets');
  });

  it('does not derive a total from a single component', () => {
    const { periods } = normalizePeriods([period('FY24', 0, { cash: 100 })]);
    expect(periods[0]!.values['totalCurrentAssets']).toBeUndefined();
  });

  it('distinguishes a reported zero from a missing value', () => {
    const withZero = analyze(dataset([period('FY24', 0, { revenue: 1000, cogs: 1000, employeeExpenses: 0, sellingMarketingExpenses: 0 })]));
    const grossMargin = withZero.metrics['grossMargin']!.points[0]!;
    expect(grossMargin.value).toBe(0);
    expect(grossMargin.status).toBe('ok');
  });

  it('flags the partial dataset in data quality rather than silently proceeding', () => {
    const result = analyze(dataset([period('FY24', 0, { revenue: 1000 })]));
    expect(result.dataQuality.checks.some((c) => c.id === 'periods.single' && c.status === 'warn')).toBe(true);
    expect(result.dataQuality.completeness).toBeLessThan(100);
  });
});

describe('zero denominators', () => {
  it('returns null for a ratio whose denominator is zero', () => {
    const metrics = calculateMetrics(
      normalizePeriods([period('FY24', 0, { revenue: 0, netIncome: 50, totalCurrentAssets: 100, totalCurrentLiabilities: 0 })]).periods,
      'general',
    );
    expect(metrics['netMargin']!.points[0]!.value).toBeNull();
    expect(metrics['netMargin']!.points[0]!.status).toBe('undefined_denominator');
    expect(metrics['currentRatio']!.points[0]!.value).toBeNull();
  });
});

describe('losses and negative values', () => {
  const loss = {
    revenue: 1000, cogs: 800, employeeExpenses: 150, sellingMarketingExpenses: 100, generalAdminExpenses: 50,
    depreciation: 40, amortization: 10, interestExpense: 60, otherIncome: 5, taxExpense: 0,
    totalCurrentAssets: 300, totalCurrentLiabilities: 400, totalAssets: 900,
    commonEquity: 100, retainedEarnings: -250,
    shortTermDebt: 100, longTermDebt: 400, cash: 20, cfo: -30, capex: 25,
  };

  it('computes negative margins without error', () => {
    const result = analyze(dataset([period('FY24', 0, loss)]));
    expect(result.metrics['ebitdaMargin']!.points[0]!.value as number).toBeLessThan(0);
    expect(result.metrics['netMargin']!.points[0]!.value as number).toBeLessThan(0);
  });

  it('suppresses ROE and debt-to-equity when equity is negative and explains why', () => {
    const result = analyze(dataset([period('FY24', 0, loss)]));
    const roe = result.metrics['roe']!.points[0]!;
    const de = result.metrics['debtToEquity']!.points[0]!;
    expect(roe.value).toBeNull();
    expect(roe.note).toMatch(/negative/i);
    expect(de.value).toBeNull();
    expect(result.redFlags.some((f) => f.id === 'negative_equity')).toBe(true);
  });

  it('does not report a leverage multiple against negative EBITDA', () => {
    const result = analyze(dataset([period('FY24', 0, loss)]));
    const nde = result.metrics['netDebtToEbitda']!.points[0]!;
    expect(nde.value).toBeNull();
    expect(nde.note).toMatch(/negative/i);
  });

  it('produces free cash flow correctly when CFO is negative', () => {
    const result = analyze(dataset([period('FY24', 0, loss)]));
    expect(result.metrics['fcf']!.points[0]!.value).toBe(-55); // -30 - 25
  });
});

describe('single-period datasets', () => {
  const single = analyze(dataset([period('FY24', 0, {
    revenue: 1000, cogs: 600, employeeExpenses: 100, sellingMarketingExpenses: 50, generalAdminExpenses: 50,
    depreciation: 40, amortization: 10, interestExpense: 30, otherIncome: 10, taxExpense: 40,
    cash: 100, accountsReceivable: 150, inventory: 120, otherCurrentAssets: 30, shortTermInvestments: 20,
    accountsPayable: 110, shortTermDebt: 40, otherCurrentLiabilities: 90,
    ppe: 500, goodwill: 60, intangibleAssets: 40, longTermInvestments: 20, otherNonCurrentAssets: 20,
    longTermDebt: 260, otherNonCurrentLiabilities: 50, commonEquity: 100, retainedEarnings: 460,
    cfo: 180, capex: 90,
  })]));

  it('still calculates point-in-time ratios', () => {
    expect(single.metrics['currentRatio']!.latest!.value).not.toBeNull();
    expect(single.metrics['ebitdaMargin']!.latest!.value).toBe(20);
  });

  it('reports every growth measure as unavailable', () => {
    expect(single.metrics['revenueGrowth']!.latest).toBeNull();
    expect(single.cagr.every((c) => c.status !== 'ok')).toBe(true);
  });

  it('marks trends as insufficient data instead of guessing a direction', () => {
    expect(single.metrics['ebitdaMargin']!.trend).toBe('insufficient_data');
  });

  it('does not fire growth-based rules', () => {
    expect(single.redFlags.some((f) => f.id === 'receivables_vs_revenue')).toBe(false);
    expect(single.positiveSignals.some((f) => f.id === 'growth_accelerating')).toBe(false);
  });
});

describe('partial statements', () => {
  it('unlocks only the analysis the supplied data supports', () => {
    // Income statement and balance sheet only — no cash flow statement.
    const result = analyze(dataset([
      period('FY23', 0, { revenue: 900, cogs: 540, totalCurrentAssets: 380, totalCurrentLiabilities: 220, totalAssets: 1000, totalEquity: 520, totalLiabilities: 480 }),
      period('FY24', 1, { revenue: 1000, cogs: 600, totalCurrentAssets: 420, totalCurrentLiabilities: 240, totalAssets: 1060, totalEquity: 560, totalLiabilities: 500 }),
    ]));
    expect(result.metrics['grossMargin']!.latest!.value).toBe(40);
    expect(result.metrics['currentRatio']!.latest!.value).not.toBeNull();
    expect(result.metrics['fcf']!.latest).toBeNull();
    const cashflowInsight = result.insights.find((i) => i.id === 'cashflow.conversion')!;
    expect(cashflowInsight.narrative).toMatch(/Insufficient data/i);
  });
});

describe('industry configuration', () => {
  it('suppresses metrics that are structurally meaningless for the industry', () => {
    const bankData = period('FY24', 0, { revenue: 1000, cogs: 600, inventory: 100, totalCurrentAssets: 500, totalCurrentLiabilities: 400 });
    const result = analyze(dataset([bankData], { company: { name: 'Test Bank', industry: 'banking', currency: 'INR', units: 'crores' } }));
    const dio = result.metrics['dio']!.points[0]!;
    expect(dio.status).toBe('not_applicable');
    expect(dio.note).toMatch(/Banking/);
  });

  it('applies industry threshold overrides', () => {
    const infra = analyze(dataset([period('FY24', 0, { revenue: 100 })], { company: { name: 'Infra Co', industry: 'infrastructure', currency: 'INR', units: 'crores' } }));
    expect(infra.thresholds.netDebtToEbitdaHigh).toBe(5);
    const general = analyze(dataset([period('FY24', 0, { revenue: 100 })]));
    expect(general.thresholds.netDebtToEbitdaHigh).toBe(3);
  });

  it('honours per-company threshold overrides above the industry defaults', () => {
    const custom = analyze({
      company: { name: 'Custom', industry: 'general', currency: 'INR', units: 'crores' },
      periods: [period('FY24', 0, { revenue: 100 })],
      thresholds: { netDebtToEbitdaHigh: 1.5 },
    });
    expect(custom.thresholds.netDebtToEbitdaHigh).toBe(1.5);
  });
});

describe('empty dataset', () => {
  it('produces a usable result rather than throwing', () => {
    const result = analyze(dataset([]));
    expect(result.latestPeriod).toBeNull();
    expect(result.redFlags).toHaveLength(0);
    expect(result.health.overall).toBeNull();
    expect(result.executiveSummary.headline).toMatch(/No financial data/i);
  });
});
