import { describe, expect, it } from 'vitest';
import {
  analyze,
  calculateCagr,
  calculateMetrics,
  cagr,
  normalizePeriods,
  percentChange,
  safeDiv,
  sumStrict,
} from '../src/index.js';
import { dataset, period } from './helpers.js';

/**
 * Every expectation below is a hand-calculated figure, not a snapshot of the engine's own output,
 * so a regression in a formula fails the test rather than silently rewriting the expectation.
 */

const base = {
  revenue: 1000, cogs: 600,
  employeeExpenses: 100, sellingMarketingExpenses: 50, generalAdminExpenses: 50,
  depreciation: 40, amortization: 10,
  interestExpense: 30, otherIncome: 10, taxExpense: 40,
  cash: 100, shortTermInvestments: 20, accountsReceivable: 150, inventory: 120, otherCurrentAssets: 30,
  ppe: 500, intangibleAssets: 40, goodwill: 60, longTermInvestments: 20, otherNonCurrentAssets: 20,
  accountsPayable: 110, shortTermDebt: 40, otherCurrentLiabilities: 90,
  longTermDebt: 260, otherNonCurrentLiabilities: 50,
  commonEquity: 100, retainedEarnings: 460,
  cfo: 180, capex: 90, cfi: -90, cff: -60,
  sharesOutstanding: 10,
};

function metricsFor(periods: ReturnType<typeof period>[]) {
  const normalized = normalizePeriods(periods).periods;
  return { normalized, metrics: calculateMetrics(normalized, 'general') };
}

describe('primitive helpers', () => {
  it('never divides by zero', () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(10, null)).toBeNull();
    expect(safeDiv(null, 5)).toBeNull();
    expect(safeDiv(10, 4)).toBe(2.5);
  });

  it('refuses growth off a zero or negative base', () => {
    expect(percentChange(0, 100)).toBeNull();
    expect(percentChange(-50, 100)).toBeNull();
    expect(percentChange(100, 120)).toBe(20);
  });

  it('computes CAGR and refuses non-positive endpoints', () => {
    // 100 -> 200 over 4 years = 2^(1/4) - 1 = 18.9207%
    expect(cagr(100, 200, 4)).toBeCloseTo(18.9207, 3);
    expect(cagr(-10, 200, 4)).toBeNull();
    expect(cagr(100, 0, 4)).toBeNull();
    expect(cagr(100, 200, 0)).toBeNull();
  });

  it('requires every input for a strict sum', () => {
    expect(sumStrict([1, 2, 3])).toBe(6);
    expect(sumStrict([1, null, 3])).toBeNull();
  });
});

describe('normalization and derived line items', () => {
  const { normalized } = metricsFor([period('FY24', 0, base)]);
  const p = normalized[0]!;

  it('derives the income statement chain', () => {
    expect(p.values['grossProfit']).toBe(400);            // 1000 - 600
    expect(p.values['operatingExpenses']).toBe(200);      // 100 + 50 + 50
    expect(p.values['ebitda']).toBe(200);                 // 400 - 200
    expect(p.values['ebit']).toBe(150);                   // 200 - 40 - 10
    expect(p.values['pbt']).toBe(130);                    // 150 - 30 + 10
    expect(p.values['netIncome']).toBe(90);               // 130 - 40
  });

  it('derives balance sheet totals', () => {
    expect(p.values['totalCurrentAssets']).toBe(420);     // 100+20+150+120+30
    expect(p.values['totalNonCurrentAssets']).toBe(640);  // 500+40+60+20+20
    expect(p.values['totalAssets']).toBe(1060);
    expect(p.values['totalCurrentLiabilities']).toBe(240);
    expect(p.values['totalNonCurrentLiabilities']).toBe(310);
    expect(p.values['totalLiabilities']).toBe(550);
    expect(p.values['totalEquity']).toBe(560);
  });

  it('marks derived values as calculated and leaves entered values alone', () => {
    expect(p.sources['revenue']).toBe('entered');
    expect(p.sources['netIncome']).toBe('calculated');
    expect(p.sources['ebitda']).toBe('calculated');
  });

  it('never overwrites a user-entered total with a derived one', () => {
    const withReported = metricsFor([period('FY24', 0, { ...base, ebitda: 195 })]);
    expect(withReported.normalized[0]!.values['ebitda']).toBe(195);
    expect(withReported.normalized[0]!.sources['ebitda']).toBe('entered');
  });

  it('derives EPS from net income and share count', () => {
    expect(p.values['basicEPS']).toBe(9);                 // 90 / 10
  });
});

describe('margins and returns', () => {
  const prior = period('FY23', 0, { ...base, revenue: 900, totalAssets: 1000, totalEquity: 520 });
  const current = period('FY24', 1, base);
  const { metrics } = metricsFor([prior, current]);

  const latest = (key: string) => metrics[key]!.latest!.value;

  it('calculates margins', () => {
    expect(latest('grossMargin')).toBe(40);      // 400/1000
    expect(latest('ebitdaMargin')).toBe(20);     // 200/1000
    expect(latest('ebitMargin')).toBe(15);       // 150/1000
    expect(latest('netMargin')).toBe(9);         // 90/1000
  });

  it('uses average balances for ROA and ROE', () => {
    // The prior period reports totals of 1,000 assets and 520 equity, which override the
    // component sums, so the averages are (1000+1060)/2 = 1030 and (520+560)/2 = 540.
    expect(latest('roa') as number).toBeCloseTo((90 / 1030) * 100, 3);
    expect(latest('roe') as number).toBeCloseTo((90 / 540) * 100, 3);
  });

  it('calculates ROIC from NOPAT over invested capital', () => {
    // Effective tax rate = 40/130 = 30.769%. NOPAT = 150 * (1 - 0.30769) = 103.846.
    // Invested capital uses the shared surplus-cash definition (cash plus short-term investments):
    // 520+300-120 = 700 prior, 560+300-140 = 720 current, average 710.
    expect(latest('roic') as number).toBeCloseTo((103.84615 / 720) * 100, 2);
  });

  it('reports ROE as unavailable when equity is negative', () => {
    const negative = metricsFor([
      period('FY24', 0, { ...base, commonEquity: -600, retainedEarnings: -100, totalEquity: -700 }),
    ]);
    const point = negative.metrics['roe']!.points[0]!;
    expect(point.value).toBeNull();
    expect(point.status).not.toBe('ok');
    expect(point.note).toMatch(/negative/i);
  });
});

describe('liquidity and solvency', () => {
  const { metrics } = metricsFor([period('FY24', 0, base)]);
  const latest = (key: string) => metrics[key]!.latest!.value;

  it('calculates liquidity ratios', () => {
    expect(latest('currentRatio') as number).toBeCloseTo(420 / 240, 4);       // 1.75x
    expect(latest('quickRatio') as number).toBeCloseTo((420 - 120) / 240, 4); // 1.25x
    expect(latest('cashRatio') as number).toBeCloseTo(120 / 240, 4);          // 0.50x
  });

  it('calculates leverage measures', () => {
    expect(latest('totalDebt')).toBe(300);
    expect(latest('netDebt')).toBe(180);                                       // 300 - 100 - 20
    expect(latest('debtToEquity') as number).toBeCloseTo(300 / 560, 4);
    expect(latest('netDebtToEbitda') as number).toBeCloseTo(180 / 200, 4);     // 0.9x
    expect(latest('interestCoverage') as number).toBeCloseTo(150 / 30, 4);     // 5.0x
  });

  it('preserves signed net cash leverage rather than flooring it at zero', () => {
    const netCash = metricsFor([period('FY24', 0, { ...base, cash: 500 })]);
    const point = netCash.metrics['netDebtToEbitda']!.latest!;
    expect(point.value).toBe(-1.1);
    expect(point.note).toMatch(/net cash/i);
  });

  it('reports interest coverage as not applicable when there is no interest expense', () => {
    const noDebt = metricsFor([period('FY24', 0, { ...base, interestExpense: 0 })]);
    const point = noDebt.metrics['interestCoverage']!.points[0]!;
    expect(point.value).toBeNull();
    expect(point.note).toMatch(/no interest expense/i);
  });
});

describe('efficiency and working capital', () => {
  const prior = period('FY23', 0, base);
  const current = period('FY24', 1, { ...base, revenue: 1200, cogs: 720, accountsReceivable: 200, inventory: 150, accountsPayable: 130 });
  const { metrics } = metricsFor([prior, current]);
  const latest = (key: string) => metrics[key]!.latest!.value as number;

  it('uses average balances and documents the methodology', () => {
    const avgAR = (150 + 200) / 2; // 175
    expect(latest('receivablesTurnover')).toBeCloseTo(1200 / avgAR, 4);
    expect(latest('dso')).toBeCloseTo((avgAR / 1200) * 365, 3);
    expect(metrics['dso']!.formula).toMatch(/Average Accounts Receivable/);
  });

  it('calculates DIO, DPO and the cash conversion cycle', () => {
    const avgInv = (120 + 150) / 2; // 135
    const avgAP = (110 + 130) / 2;  // 120
    const dio = (avgInv / 720) * 365;
    const dpo = (avgAP / 720) * 365;
    const dso = (175 / 1200) * 365;
    expect(latest('dio')).toBeCloseTo(dio, 3);
    expect(latest('dpo')).toBeCloseTo(dpo, 3);
    expect(latest('cashConversionCycle')).toBeCloseTo(dso + dio - dpo, 2);
  });

  it('falls back to the closing balance for the first period and says so', () => {
    const first = metrics['dso']!.points[0]!;
    expect(first.note).toMatch(/Closing balance used/i);
  });
});

describe('cash flow measures', () => {
  const prior = period('FY23', 0, base);
  const current = period('FY24', 1, { ...base, cfo: 200, capex: 80 });
  const { metrics } = metricsFor([prior, current]);
  const latest = (key: string) => metrics[key]!.latest!.value as number;

  it('calculates free cash flow as CFO less capex', () => {
    expect(latest('fcf')).toBe(120);
    expect(latest('fcfMargin')).toBeCloseTo((120 / 1000) * 100, 4);
  });

  it('calculates conversion ratios', () => {
    expect(latest('cfoToNetIncome')).toBeCloseTo(200 / 90, 4);
    expect(latest('fcfConversion')).toBeCloseTo(120 / 90, 4);
    expect(latest('capexToCfo')).toBeCloseTo((80 / 200) * 100, 4);
  });

  it('refuses conversion ratios when net income is not positive', () => {
    const loss = metricsFor([period('FY24', 0, { ...base, taxExpense: 0, netIncome: -50 })]);
    const point = loss.metrics['cfoToNetIncome']!.points[0]!;
    expect(point.value).toBeNull();
    expect(point.note).toMatch(/negative/i);
  });
});

describe('growth and CAGR across periods', () => {
  const periods = [
    period('FY22', 0, { ...base, revenue: 1000 }),
    period('FY23', 1, { ...base, revenue: 1150 }),
    period('FY24', 2, { ...base, revenue: 1300 }),
  ];
  const { normalized, metrics } = metricsFor(periods);

  it('calculates year-on-year growth', () => {
    expect(metrics['revenueGrowth']!.points[0]!.value).toBeNull();
    expect(metrics['revenueGrowth']!.points[1]!.value).toBe(15);
    expect(metrics['revenueGrowth']!.points[2]!.value).toBeCloseTo(13.0435, 3);
  });

  it('calculates revenue CAGR over the available span', () => {
    const revenueCagr = calculateCagr(normalized).find((c) => c.key === 'revenueCagr')!;
    expect(revenueCagr.value).toBeCloseTo(((1300 / 1000) ** (1 / 2) - 1) * 100, 3);
    expect(revenueCagr.inputs['years']).toBe(2);
  });

  it('states plainly that growth cannot be calculated from one period', () => {
    const single = calculateCagr(normalizePeriods([period('FY24', 0, base)]).periods);
    const revenueCagr = single.find((c) => c.key === 'revenueCagr')!;
    expect(revenueCagr.value).toBeNull();
    expect(revenueCagr.status).toBe('insufficient_data');
    expect(revenueCagr.note).toMatch(/at least two periods/i);
  });
});

describe('DuPont decomposition', () => {
  it('reconstructs ROE from its three components', () => {
    const periods = [
      period('FY23', 0, base),
      period('FY24', 1, { ...base, revenue: 1200, cogs: 700 }),
    ];
    const result = analyze(dataset(periods));
    const row = result.duPont.periods[1]!;
    expect(row.status).toBe('ok');
    const product = (row.netMargin as number) * (row.assetTurnover as number) * (row.equityMultiplier as number);
    expect(row.reconstructedRoe as number).toBeCloseTo(product, 3);
    // With flat balances the decomposition reproduces directly calculated ROE.
    expect(row.reconstructedRoe as number).toBeCloseTo(row.roe as number, 1);
  });

  it('attributes an ROE change to the dominant driver and the effects sum to the total', () => {
    const periods = [
      period('FY23', 0, base),
      // Margin improves sharply while the balance sheet is unchanged, so margin must dominate.
      period('FY24', 1, { ...base, cogs: 500 }),
    ];
    const { attribution } = analyze(dataset(periods)).duPont;
    expect(attribution).not.toBeNull();
    expect(attribution!.primaryDriver).toBe('margin');
    const sum = (attribution!.marginEffect as number) + (attribution!.turnoverEffect as number) + (attribution!.leverageEffect as number);
    expect(sum).toBeCloseTo(attribution!.roeChange as number, 3);
  });
});
