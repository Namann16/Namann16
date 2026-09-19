import { describe, expect, it } from 'vitest';
import {
  analyze,
  capexFormula,
  divergentAlternates,
  freeCashFlow,
  investedCapital,
  nopat,
  workingCapital,
} from '../src/index.js';
import type { MetricConfig } from '../src/types.js';
import { dataset, period } from './helpers.js';

/**
 * Specification Part B — configurable metric definitions.
 *
 * The switches were previously declared in the type, validated by the API and stored, while only
 * one of the six changed a number. These tests pin that every switch moves the figure it claims
 * to, that the formula shown always matches the arithmetic performed, and that a definition which
 * materially disagrees is reported rather than discarded.
 */

const VALUES = {
  revenue: 1000, cogs: 400, operatingExpenses: 200, ebit: 400, pbt: 380, taxExpense: 95,
  netIncome: 285, cash: 300, shortTermInvestments: 150, totalEquity: 600, longTermDebt: 200,
  totalAssets: 1400, totalCurrentAssets: 700, totalCurrentLiabilities: 300,
  accountsReceivable: 250, tradeReceivables: 100, inventory: 180, accountsPayable: 120,
  customerAdvancesCurrent: 150, customerAdvancesNonCurrent: 250,
  cfo: 350, purchaseOfPPE: 60, purchaseOfIntangibles: 40, purchaseOfInvestments: 100,
};

function run(metricConfig?: MetricConfig) {
  return analyze(
    dataset(
      [period('FY25', 0, VALUES), period('FY26', 1, VALUES)],
      { company: { name: 'Config Co', industry: 'manufacturing', currency: 'INR', units: 'crores', ...(metricConfig ? { metricConfig } : {}) } },
    ),
  );
}

const latest = (metricConfig: MetricConfig | undefined, key: string) => run(metricConfig).metrics[key]?.latest;

describe('every Part B switch changes the number it claims to', () => {
  it('ROCE numerator: selecting other income never deletes a figure the data supports', () => {
    const base = latest(undefined, 'roce')!.value as number;
    const point = latest({ roce: { numerator: 'ebit_plus_other_income' } }, 'roce');
    // This fixture reports no other income. The metric must still compute on EBIT alone rather
    // than vanish, and must not silently treat the absent line as zero without saying so.
    expect(point).not.toBeNull();
    expect(point!.status).toBe('ok');
    expect(point!.value).toBeCloseTo(base, 4);
    expect(point!.note).toMatch(/not reported for this period/i);
  });

  it('ROCE denominator: each basis produces a different capital base', () => {
    const textbook = latest(undefined, 'roce')!.value as number;
    const equityDebt = latest({ roce: { denominator: 'equity_plus_debt' } }, 'roce')!.value as number;
    const exCash = latest({ roce: { denominator: 'equity_plus_debt_less_surplus_cash' } }, 'roce')!.value as number;
    // 400 / (1400 − 300) = 36.4% ; 400 / 800 = 50% ; 400 / (800 − 450) = 114.3%
    expect(textbook).toBeCloseTo(36.36, 1);
    expect(equityDebt).toBeCloseTo(50, 1);
    expect(exCash).toBeCloseTo(114.29, 1);
  });

  it('ROCE excludeCustomerAdvances lifts the return by removing interest-free funding', () => {
    const withAdvances = latest(undefined, 'roce')!.value as number;
    const without = latest({ roce: { excludeCustomerAdvances: true } }, 'roce')!.value as number;
    // 400 / (1100 − 400) = 57.1%
    expect(without).toBeCloseTo(57.14, 1);
    expect(without).toBeGreaterThan(withAdvances);
  });

  it('ROIC surplus cash: cash-only leaves investments in the capital base', () => {
    // equity 600 + debt 200 = 800. Less cash 300 = 500; less cash + investments 450 = 350.
    expect(investedCapital(run().statements[1], { roic: { surplusCashTreatment: 'cash_only' } })).toBe(500);
    expect(investedCapital(run().statements[1], { roic: { surplusCashTreatment: 'cash_and_liquid_investments' } })).toBe(350);
  });

  it('ROIC statutory rate is used when supplied', () => {
    const p = run().statements[1]!;
    // Effective rate = 95 / 380 = 25%, so a statutory 40% must produce a lower NOPAT.
    expect(nopat(p).taxRate).toBeCloseTo(0.25, 4);
    const statutory = nopat(p, { roic: { nopatBasis: 'statutory_rate', statutoryRatePercent: 40 } });
    expect(statutory.basis).toBe('statutory');
    expect(statutory.value).toBeCloseTo(400 * 0.6, 4);
  });

  it('ROIC statutory rate falls back to effective, and says so, when no rate is supplied', () => {
    // Never assume a jurisdiction: without a rate the engine must not invent one.
    const result = nopat(run().statements[1], { roic: { nopatBasis: 'statutory_rate' } });
    expect(result.basis).toBe('effective');
    expect(result.taxRate).toBeCloseTo(0.25, 4);
    expect(result.note).toMatch(/no statutory rate was supplied/i);
  });

  it('free cash flow: each capex basis subtracts a different amount', () => {
    const p = run().statements[1]!;
    expect(freeCashFlow(p, { freeCashFlow: { capexBasis: 'ppe_only' } })).toBe(350 - 60);
    expect(freeCashFlow(p, { freeCashFlow: { capexBasis: 'ppe_plus_intangibles' } })).toBe(350 - 100);
    expect(freeCashFlow(p, { freeCashFlow: { capexBasis: 'total_investing_capex' } })).toBe(350 - 200);
  });

  it('working capital: the operating basis strips out cash and short-term debt', () => {
    const p = run().statements[1]!;
    expect(workingCapital(p)).toBe(700 - 300);
    // receivables 250 + inventory 180 − payables 120
    expect(workingCapital(p, { workingCapital: { basis: 'operating_only' } })).toBe(310);
  });

  it('DSO: the trade-only basis excludes unbilled revenue', () => {
    const all = latest(undefined, 'dso')!.value as number;
    const trade = latest({ receivables: { dsoBasis: 'trade_only' } }, 'dso')!.value as number;
    expect(all).toBeCloseTo(250 / 1000 * 365, 1);
    expect(trade).toBeCloseTo(100 / 1000 * 365, 1);
  });

  it('DIO: each denominator gives a different number of days', () => {
    expect(latest(undefined, 'dio')!.value as number).toBeCloseTo(180 / 400 * 365, 1);
    expect(latest({ inventory: { dioDenominator: 'total_operating_cost' } }, 'dio')!.value as number).toBeCloseTo(180 / 600 * 365, 1);
    expect(latest({ inventory: { dioDenominator: 'revenue' } }, 'dio')!.value as number).toBeCloseTo(180 / 1000 * 365, 1);
  });
});

describe('Part B rule 2 — the formula shown is the definition performed', () => {
  it('ROCE prints the resolved capital-employed definition, not a generic string', () => {
    expect(latest(undefined, 'roce')!.formula).toBe('Annualized EBIT / (Total Assets − Total Current Liabilities)');
    expect(latest({ roce: { denominator: 'equity_plus_debt' } }, 'roce')!.formula)
      .toBe('Annualized EBIT / (Total Equity + Total Debt)');
    // With no other income reported, naming it in the formula would be a claim the data does not
    // support, so the resolved string says EBIT and the metric carries the reason.
    const absent = latest({ roce: { numerator: 'ebit_plus_other_income', denominator: 'equity_plus_debt' } }, 'roce')!;
    expect(absent.formula).toBe('Annualized EBIT / (Total Equity + Total Debt)');
    expect(absent.note).toMatch(/not reported for this period/i);
  });

  it('names other income in the formula once the line actually exists', () => {
    const withOther = { ...VALUES, otherIncome: 50 };
    const result = analyze(dataset(
      [period('FY25', 0, withOther), period('FY26', 1, withOther)],
      { company: { name: 'C', industry: 'manufacturing', currency: 'INR', units: 'crores', metricConfig: { roce: { numerator: 'ebit_plus_other_income', denominator: 'equity_plus_debt' } } } },
    ));
    const roce = result.metrics.roce?.latest;
    expect(roce?.formula).toBe('Annualized (EBIT + Other Income) / (Total Equity + Total Debt)');
    expect(roce?.note).toBeUndefined();
    // (400 + 50) / 800 = 56.25%
    expect(roce?.value).toBeCloseTo(56.25, 1);
  });

  it('DSO and DIO name the line and the denominator actually used', () => {
    expect(latest({ receivables: { dsoBasis: 'trade_only' } }, 'dso')!.formula).toMatch(/Trade Receivables/);
    expect(latest(undefined, 'dso')!.formula).toMatch(/including unbilled/);
    expect(latest({ inventory: { dioDenominator: 'revenue' } }, 'dio')!.formula).toMatch(/Annualized Revenue/);
  });

  it('free cash flow names the capex basis', () => {
    expect(capexFormula({ freeCashFlow: { capexBasis: 'ppe_only' } })).toBe('CFO − Purchase of PP&E');
    expect(capexFormula({ freeCashFlow: { capexBasis: 'total_investing_capex' } })).toMatch(/investments purchased/);
    expect(latest({ freeCashFlow: { capexBasis: 'ppe_only' } }, 'fcf')!.formula).toBe('CFO − Purchase of PP&E');
  });
});

describe('Part B rule 1 — show both when they diverge', () => {
  it('keeps only the definitions that differ by more than the tolerance', () => {
    const candidates = [
      { label: 'Close', value: 105, formula: 'a' },
      { label: 'Far', value: 200, formula: 'b' },
      { label: 'Missing', value: null, formula: 'c' },
    ];
    const kept = divergentAlternates(100, candidates);
    expect(kept.map((k) => k.label)).toEqual(['Far']);
    expect(kept[0]?.divergencePercent).toBeCloseTo(100, 4);
  });

  it('respects a configured tolerance', () => {
    const candidates = [{ label: 'Close', value: 105, formula: 'a' }];
    expect(divergentAlternates(100, candidates, { definitionDivergencePercent: 25 })).toEqual([]);
    expect(divergentAlternates(100, candidates, { definitionDivergencePercent: 1 })).toHaveLength(1);
  });

  it('reports nothing when the figure itself is unavailable', () => {
    expect(divergentAlternates(null, [{ label: 'x', value: 10, formula: 'a' }])).toEqual([]);
    expect(divergentAlternates(0, [{ label: 'x', value: 10, formula: 'a' }])).toEqual([]);
  });

  it('surfaces the divergent ROCE bases on the metric itself, each with its own formula', () => {
    const roce = latest(undefined, 'roce')!;
    expect(roce.alternates?.length).toBeGreaterThan(0);
    const equityDebt = roce.alternates?.find((a) => a.label === 'Equity + debt');
    expect(equityDebt?.value).toBeCloseTo(50, 1);
    expect(equityDebt?.formula).toBe('Annualized EBIT / (Total Equity + Total Debt)');
    // The basis in use is never repeated as one of its own alternatives.
    expect(roce.alternates?.some((a) => a.label === 'Assets less current liabilities')).toBe(false);
  });

  it('reports the trade-only DSO beside the total, because the two are not comparable', () => {
    const dso = latest(undefined, 'dso')!;
    const trade = dso.alternates?.find((a) => a.label === 'Trade receivables only');
    expect(trade?.value).toBeCloseTo(36.5, 1);
    expect(trade?.divergencePercent).toBeLessThan(-25);
  });

  it('does not clutter a metric whose definitions agree', () => {
    // With no intangible or investment spend there is one honest capex figure, so no alternative.
    const noIntangibles = { ...VALUES, purchaseOfIntangibles: 0, purchaseOfInvestments: 0 };
    const result = analyze(dataset([period('FY25', 0, noIntangibles), period('FY26', 1, noIntangibles)]));
    expect(result.metrics.fcf?.latest?.alternates ?? []).toEqual([]);
  });
});
