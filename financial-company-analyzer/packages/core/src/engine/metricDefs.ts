import type { FinancialPeriod, IndustryKey, MetricAlternate, MetricConfig, MetricGroup, MetricUnit, Num } from '../types.js';
import {
  add,
  average,
  isNum,
  percentChange,
  safeDiv,
  safeDivPositiveDenominator,
  subtract,
  sumDefined,
  toPercent,
} from '../utils/number.js';
import { val } from './normalize.js';

export interface MetricContext {
  /** The period being measured. */
  current: FinancialPeriod;
  /** The immediately preceding period, when one exists. Used for averages and growth. */
  prior: FinancialPeriod | undefined;
  annualizeInterimMetrics?: boolean;
  reportingPeriod?: 'annual' | 'half_yearly' | 'quarterly';
  metricConfig?: MetricConfig;
}

export interface MetricComputation {
  value: Num;
  /** Every raw input consumed, so the result is fully traceable. */
  inputs: Record<string, Num>;
  note?: string;
  denominatorBasis?: 'average' | 'spot';
  /**
   * The definition actually used, when configuration can change it (specification Part B, rule 2:
   * "always print the definition in use"). Overrides the definition's static formula string, so a
   * reader never sees a formula that does not match the number beside it.
   */
  formula?: string;
  /** Other defensible definitions, filtered to the ones that diverge (Part B, rule 1). */
  alternates?: MetricAlternate[];
}

/** Default tolerance before two definitions of one metric are both shown. */
export const DEFAULT_DEFINITION_DIVERGENCE_PERCENT = 25;

/**
 * Keep the alternative definitions that differ from the reported figure by more than the
 * tolerance. Specification Part B rule 1: show both when they diverge, because silently picking
 * one is what produced a 9.6% ROCE printed beside a 24% ROE with nothing to account for the gap.
 */
export function divergentAlternates(
  reported: Num,
  candidates: { label: string; value: Num; formula: string }[],
  config?: MetricConfig,
): MetricAlternate[] {
  if (!isNum(reported) || reported === 0) return [];
  const tolerance = config?.definitionDivergencePercent ?? DEFAULT_DEFINITION_DIVERGENCE_PERCENT;
  return candidates
    .filter((c) => isNum(c.value))
    .map((c) => ({
      ...c,
      divergencePercent: ((c.value as number) - reported) / Math.abs(reported) * 100,
    }))
    .filter((c) => Math.abs(c.divergencePercent) > tolerance);
}

export interface MetricDefinition {
  key: string;
  label: string;
  group: MetricGroup;
  unit: MetricUnit;
  formula: string;
  meaning: string;
  higherIsBetter?: boolean;
  polarity?: 'higher_is_better' | 'lower_is_better' | 'neutral' | 'context_dependent';
  saturationThreshold?: number;
  /** When true a change is naturally expressed in absolute terms (pp, days, x) not in %. */
  absoluteChangeOnly?: boolean;
  supportedIndustries?: IndustryKey[];
  compute: (ctx: MetricContext) => MetricComputation;
}

/* ------------------------------------------------------------------ */
/* Shared derived aggregates                                          */
/* ------------------------------------------------------------------ */

/** Total debt = short-term debt + long-term debt. Null when neither is available. */
export function totalDebt(p: FinancialPeriod | undefined): Num {
  return sumDefined([val(p, 'shortTermDebt'), val(p, 'longTermDebt')]);
}

/** Net debt = total debt − cash − short-term investments. */
export function netDebt(p: FinancialPeriod | undefined): Num {
  const debt = totalDebt(p);
  if (!isNum(debt)) return null;
  const liquid = surplusCash(p) ?? 0;
  return debt - liquid;
}

/** Single source of truth for surplus cash used by leverage and return metrics. */
export function surplusCash(p: FinancialPeriod | undefined, treatment: 'cash_only' | 'cash_and_liquid_investments' = 'cash_and_liquid_investments'): Num {
  if (!p) return null;
  return treatment === 'cash_only' ? val(p, 'cash') : sumDefined([val(p, 'cash'), val(p, 'shortTermInvestments')]);
}

/** Free cash flow = CFO − capital expenditure. */
export function freeCashFlow(p: FinancialPeriod | undefined, config?: MetricConfig): Num {
  const cfo = val(p, 'cfo');
  const ppeCapex = val(p, 'purchaseOfPPE') ?? val(p, 'capex');
  const intangibles = sumDefined([val(p, 'purchaseOfIntangibles'), val(p, 'purchaseOfIntangibleDevelopment')]) ?? 0;
  const basis = config?.freeCashFlow?.capexBasis;
  let capex: Num;
  if (basis === 'ppe_only') {
    capex = ppeCapex;
  } else if (basis === 'total_investing_capex') {
    // Everything the investing section spent on capacity, including investments purchased.
    const investing = sumDefined([ppeCapex, val(p, 'purchaseOfIntangibles'), val(p, 'purchaseOfIntangibleDevelopment'), val(p, 'purchaseOfInvestments')]);
    capex = investing;
  } else {
    capex = isNum(ppeCapex) ? ppeCapex + intangibles : null;
  }
  if (!isNum(cfo) || !isNum(capex)) return null;
  return cfo - Math.abs(capex);
}

export type CapexBasis = NonNullable<NonNullable<MetricConfig['freeCashFlow']>['capexBasis']>;

/** Short name for a capex basis, used to label an alternative reading. */
export function capexLabel(basis: CapexBasis | undefined): string {
  switch (basis) {
    case 'ppe_only': return 'PP&E capex only';
    case 'total_investing_capex': return 'All investing capex';
    default: return 'PP&E plus intangibles';
  }
}

/** The resolved capex definition, for the formula shown beside free cash flow. */
export function capexFormula(config?: MetricConfig): string {
  switch (config?.freeCashFlow?.capexBasis) {
    case 'ppe_only': return 'CFO − Purchase of PP&E';
    case 'total_investing_capex': return 'CFO − (PP&E + intangibles + investments purchased)';
    default: return 'CFO − (Purchase of PP&E + Purchase of Intangibles)';
  }
}

/**
 * Invested capital = total equity + total debt − surplus cash.
 *
 * Which cash counts as surplus is a configuration decision, and it routes through the same
 * `surplusCash` function as net debt, enterprise value and the cash ratio so the four cannot
 * disagree about the same balance (specification A5).
 */
export function investedCapital(p: FinancialPeriod | undefined, config?: MetricConfig): Num {
  const equity = val(p, 'totalEquity');
  const debt = totalDebt(p);
  if (!isNum(equity) || !isNum(debt)) return null;
  const cash = surplusCash(p, config?.roic?.surplusCashTreatment) ?? 0;
  return equity + debt - cash;
}

/**
 * NOPAT = EBIT × (1 − tax rate).
 *
 * The rate is the effective rate from the P&L by default. A statutory basis is available, but
 * only when the rate is supplied: there is no universal statutory rate, so rather than assume a
 * jurisdiction the engine falls back to the effective rate and reports that it did.
 */
export function nopat(
  p: FinancialPeriod | undefined,
  config?: MetricConfig,
): { value: Num; taxRate: Num; basis: 'effective' | 'statutory'; note?: string } {
  const ebit = val(p, 'ebit');
  if (!isNum(ebit)) return { value: null, taxRate: null, basis: 'effective' };

  const wantsStatutory = config?.roic?.nopatBasis === 'statutory_rate';
  const statutory = config?.roic?.statutoryRatePercent;
  if (wantsStatutory && isNum(statutory)) {
    const rate = statutory / 100;
    return { value: ebit * (1 - rate), taxRate: rate, basis: 'statutory' };
  }

  const pbt = val(p, 'pbt');
  const tax = val(p, 'taxExpense');
  let rate: Num = null;
  if (isNum(pbt) && isNum(tax) && pbt > 0) {
    rate = tax / pbt;
    // Guard against nonsensical effective rates from one-off tax items.
    if (rate < 0 || rate > 0.6) rate = null;
  }
  if (rate === null) return { value: null, taxRate: null, basis: 'effective' };
  return {
    value: ebit * (1 - rate),
    taxRate: rate,
    basis: 'effective',
    ...(wantsStatutory
      ? { note: 'A statutory tax basis was selected but no statutory rate was supplied, so the effective rate from the P&L was used instead.' }
      : {}),
  };
}

/**
 * Working capital.
 *
 * The total-current basis is the accounting definition. The operating basis
 * (receivables + inventory − payables) strips out cash, short-term debt and other items that are
 * financing rather than operating decisions, which is what makes a working-capital cycle
 * comparable between companies.
 */
export function workingCapital(p: FinancialPeriod | undefined, config?: MetricConfig): Num {
  if (config?.workingCapital?.basis === 'operating_only') {
    const receivables = val(p, 'accountsReceivable');
    const inventory = val(p, 'inventory');
    const payables = val(p, 'accountsPayable');
    const assets = sumDefined([receivables, inventory]);
    if (!isNum(assets)) return null;
    return assets - (payables ?? 0);
  }
  return subtract(val(p, 'totalCurrentAssets'), val(p, 'totalCurrentLiabilities'));
}

/** Label for the working-capital basis in use, for the resolved formula string. */
export function workingCapitalFormula(config?: MetricConfig): string {
  return config?.workingCapital?.basis === 'operating_only'
    ? 'Receivables + Inventory − Payables (operating basis)'
    : 'Total Current Assets − Total Current Liabilities';
}

/**
 * Average balance across the period, used for flow-over-stock ratios (ROE, turnover, DSO...).
 * When no prior period exists the closing balance is used and the caller is told so, because
 * silently mixing the two methodologies would make period comparisons misleading.
 */
function avgBalance(ctx: MetricContext, key: string): { value: Num; note?: string; inputs: Record<string, Num>; denominatorBasis: 'average' | 'spot' } {
  const cur = val(ctx.current, key);
  const prev = val(ctx.prior, key);
  if (isNum(cur) && isNum(prev)) {
    return {
      value: average(cur, prev),
      denominatorBasis: 'average',
      inputs: { [`${key} (opening)`]: prev, [`${key} (closing)`]: cur },
    };
  }
  return {
    value: cur,
    denominatorBasis: 'spot',
    note: 'Closing balance used — no prior-period balance is available to compute an average. This point is not directly comparable with average-based periods.',
    inputs: { [`${key} (closing)`]: cur },
  };
}

function interimFactor(ctx: MetricContext): number {
  if (ctx.reportingPeriod === 'quarterly') return 4;
  if (ctx.reportingPeriod === 'half_yearly') return 2;
  return 1;
}

function growth(ctx: MetricContext, key: string): MetricComputation {
  const cur = val(ctx.current, key);
  const prev = val(ctx.prior, key);
  const raw = percentChange(prev, cur);
  const factor = ctx.annualizeInterimMetrics ? interimFactor(ctx) : 1;
  const value = isNum(raw) && factor > 1 && raw > -100
    ? ((1 + raw / 100) ** factor - 1) * 100
    : raw;
  return {
    value,
    inputs: { [`${key} (prior)`]: prev, [`${key} (current)`]: cur },
    ...(isNum(prev) && prev < 0
      ? { note: 'Growth is not reported off a negative base because the result would not be interpretable.' }
      : factor > 1 ? { note: `Annualized from ${ctx.reportingPeriod === 'quarterly' ? 'quarterly' : 'half-yearly'} change using a ${factor}x factor.` } : {}),
  };
}

function daysBasis(ctx: MetricContext): { days: number; note?: string } {
  const factor = ctx.annualizeInterimMetrics ? interimFactor(ctx) : 1;
  if (factor === 1) return { days: 365 };
  return {
    days: 365 / factor,
    note: `Annualized from ${ctx.reportingPeriod === 'quarterly' ? 'quarterly' : 'half-yearly'} flow data using a ${factor}x annualization factor.`,
  };
}

function annualizedFlow(ctx: MetricContext, key: string): { value: Num; note?: string } {
  const value = val(ctx.current, key);
  const factor = ctx.annualizeInterimMetrics ? interimFactor(ctx) : 1;
  if (!isNum(value) || factor === 1) return { value };
  return {
    value: value * factor,
    note: `Annualized ${key} using a ${factor}x ${ctx.reportingPeriod === 'quarterly' ? 'quarterly' : 'half-yearly'} factor.`,
  };
}

function marginOf(ctx: MetricContext, numeratorKey: string): MetricComputation {
  const num = val(ctx.current, numeratorKey);
  const revenue = val(ctx.current, 'revenue');
  return {
    value: toPercent(safeDiv(num, revenue)),
    inputs: { [numeratorKey]: num, revenue },
  };
}

/* ------------------------------------------------------------------ */
/* Metric registry                                                    */
/* ------------------------------------------------------------------ */

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  /* ============ Headline absolute figures (for charts and KPI cards) ============ */
  {
    key: 'revenue', label: 'Revenue', group: 'growth', unit: 'currency',
    formula: 'Reported revenue / net sales',
    meaning: 'Total value of goods and services sold in the period.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'revenue'), inputs: { revenue: val(ctx.current, 'revenue') } }),
  },
  {
    key: 'sameStoreSalesGrowth', label: 'Same-Store Sales Growth', group: 'growth', unit: 'percent',
    formula: '(Same-Store Revenue − Prior Same-Store Revenue) / Prior Same-Store Revenue',
    meaning: 'Growth from comparable stores, excluding the effect of openings and closures.',
    higherIsBetter: true, polarity: 'neutral', absoluteChangeOnly: true,
    supportedIndustries: ['retail'],
    compute: (ctx) => growth(ctx, 'sameStoreRevenue'),
  },
  {
    key: 'ebitdaValue', label: 'EBITDA', group: 'profitability', unit: 'currency',
    formula: 'Earnings before interest, tax, depreciation and amortisation',
    meaning: 'Operating profit before non-cash charges and financing decisions.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'ebitda'), inputs: { ebitda: val(ctx.current, 'ebitda') } }),
  },
  {
    key: 'ebitValue', label: 'EBIT', group: 'profitability', unit: 'currency',
    formula: 'EBITDA − Depreciation − Amortisation',
    meaning: 'Operating profit after the cost of using long-lived assets.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'ebit'), inputs: { ebit: val(ctx.current, 'ebit') } }),
  },
  {
    key: 'netIncomeValue', label: 'Net Income', group: 'profitability', unit: 'currency',
    formula: 'Profit after tax attributable to shareholders',
    meaning: 'The bottom-line profit left for shareholders after all costs, interest and tax.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'netIncome'), inputs: { netIncome: val(ctx.current, 'netIncome') } }),
  },
  {
    key: 'capitalIntensity', label: 'Capital Intensity', group: 'efficiency', unit: 'percent',
    formula: 'PPE / Revenue × 100',
    meaning: 'Net property, plant and equipment required for each unit of revenue; useful for capital-intensive industries.',
    higherIsBetter: false,
    supportedIndustries: [
      'manufacturing', 'fmcg', 'pharmaceuticals', 'automobile',
      'infrastructure', 'energy', 'telecom',
    ],
    compute: (ctx) => {
      const ppe = val(ctx.current, 'ppe');
      const revenue = val(ctx.current, 'revenue');
      return { value: toPercent(safeDiv(ppe, revenue)), inputs: { ppe, revenue } };
    },
  },

  /* ============ Growth ============ */
  {
    key: 'revenueGrowth', label: 'Revenue Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Revenue − Prior Revenue) / Prior Revenue',
    meaning: 'Rate at which the top line expanded or contracted versus the prior period.',
    higherIsBetter: false, polarity: 'lower_is_better', absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'revenue'),
  },
  {
    key: 'ebitdaGrowth', label: 'EBITDA Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(EBITDA − Prior EBITDA) / Prior EBITDA',
    meaning: 'Growth in operating profitability before non-cash charges.',
    higherIsBetter: false, polarity: 'lower_is_better', absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'ebitda'),
  },
  {
    key: 'ebitGrowth', label: 'EBIT Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(EBIT − Prior EBIT) / Prior EBIT',
    meaning: 'Growth in operating profit after depreciation and amortisation.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'ebit'),
  },
  {
    key: 'netIncomeGrowth', label: 'Net Income Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Net Income − Prior Net Income) / Prior Net Income',
    meaning: 'Growth in bottom-line profit.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'netIncome'),
  },
  {
    key: 'epsGrowth', label: 'EPS Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Basic EPS − Prior Basic EPS) / Prior Basic EPS',
    meaning: 'Growth in profit per share, which reflects dilution as well as profitability.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'basicEPS'),
  },
  {
    key: 'cfoGrowth', label: 'CFO Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(CFO − Prior CFO) / Prior CFO',
    meaning: 'Growth in cash actually generated by operations.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'cfo'),
  },
  {
    key: 'fcfGrowth', label: 'FCF Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(FCF − Prior FCF) / Prior FCF',
    meaning: 'Growth in cash left after maintaining and expanding the asset base.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cur = freeCashFlow(ctx.current, ctx.metricConfig);
      const prev = freeCashFlow(ctx.prior, ctx.metricConfig);
      return { value: percentChange(prev, cur), inputs: { 'FCF (prior)': prev, 'FCF (current)': cur } };
    },
  },
  {
    key: 'assetGrowth', label: 'Total Asset Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Total Assets − Prior Total Assets) / Prior Total Assets',
    meaning: 'Rate at which the balance sheet is expanding.',
    absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'totalAssets'),
  },
  {
    key: 'debtGrowth', label: 'Total Debt Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Total Debt − Prior Total Debt) / Prior Total Debt',
    meaning: 'Rate at which borrowings are increasing or being repaid.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cur = totalDebt(ctx.current);
      const prev = totalDebt(ctx.prior);
      return { value: percentChange(prev, cur), inputs: { 'Total debt (prior)': prev, 'Total debt (current)': cur } };
    },
  },
  {
    key: 'equityGrowth', label: 'Equity Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Total Equity − Prior Total Equity) / Prior Total Equity',
    meaning: 'Growth in shareholders’ funds from retained profit and capital raised.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'totalEquity'),
  },
  {
    key: 'receivablesGrowth', label: 'Receivables Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Receivables − Prior Receivables) / Prior Receivables',
    meaning: 'Change in amounts owed by customers. Compared against revenue growth to test collection quality.',
    absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'accountsReceivable'),
  },
  {
    key: 'inventoryGrowth', label: 'Inventory Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Inventory − Prior Inventory) / Prior Inventory',
    meaning: 'Change in stock held. Compared against revenue growth to test demand and obsolescence risk.',
    absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'inventory'),
  },

  /* ============ Profitability ============ */
  {
    key: 'grossMargin', label: 'Gross Margin', group: 'profitability', unit: 'percent',
    formula: 'Gross Profit / Revenue',
    meaning: 'Share of each unit of revenue left after the direct cost of production. Reflects pricing power and input costs.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'grossProfit'),
  },
  {
    key: 'ebitdaMargin', label: 'EBITDA Margin', group: 'profitability', unit: 'percent',
    formula: 'EBITDA / Revenue',
    meaning: 'Operating profitability before non-cash charges. The cleanest read on core operating efficiency.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'ebitda'),
  },
  {
    key: 'ebitMargin', label: 'EBIT Margin', group: 'profitability', unit: 'percent',
    formula: 'EBIT / Revenue',
    meaning: 'Operating profitability after the cost of using long-lived assets.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'ebit'),
  },
  {
    key: 'netMargin', label: 'Net Profit Margin', group: 'profitability', unit: 'percent',
    formula: 'Net Income / Revenue',
    meaning: 'Share of revenue converted into profit for shareholders after all costs, interest and tax.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'netIncome'),
  },
  {
    key: 'netInterestMargin', label: 'Net Interest Margin', group: 'profitability', unit: 'percent',
    formula: 'Net Interest Income / Average Interest-Earning Assets',
    meaning: 'Interest spread earned on a bank’s interest-earning asset base.',
    higherIsBetter: true, absoluteChangeOnly: true,
    supportedIndustries: ['banking', 'financial_services'],
    compute: (ctx) => {
      const nii = annualizedFlow(ctx, 'netInterestIncome');
      const assets = avgBalance(ctx, 'interestEarningAssets');
      return {
        value: toPercent(safeDivPositiveDenominator(nii.value, assets.value)),
        inputs: { netInterestIncome: nii.value, ...assets.inputs },
        ...(assets.note ? { note: assets.note } : {}),
      };
    },
  },
  {
    key: 'costToIncome', label: 'Cost-to-Income Ratio', group: 'efficiency', unit: 'percent',
    formula: 'Operating Expenses / (Net Interest Income + Other Income)',
    meaning: 'Operating cost required to generate each unit of a bank’s operating income.',
    higherIsBetter: false, absoluteChangeOnly: true,
    supportedIndustries: ['banking', 'financial_services'],
    compute: (ctx) => {
      const costs = annualizedFlow(ctx, 'operatingExpenses');
      const nii = annualizedFlow(ctx, 'netInterestIncome');
      const other = annualizedFlow(ctx, 'otherIncome');
      const income = sumDefined([nii.value, other.value]);
      return { value: toPercent(safeDivPositiveDenominator(costs.value, income)), inputs: { operatingExpenses: costs.value, netInterestIncome: nii.value, otherIncome: other.value } };
    },
  },
  {
    key: 'pbtMargin', label: 'PBT Margin', group: 'profitability', unit: 'percent',
    formula: 'Profit Before Tax / Revenue',
    meaning: 'Profitability before tax, isolating operating and financing performance from tax effects.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'pbt'),
  },
  {
    key: 'effectiveTaxRate', label: 'Effective Tax Rate', group: 'profitability', unit: 'percent',
    formula: 'Tax Expense / Profit Before Tax',
    meaning: 'Average rate of tax borne on pre-tax profit. Sharp moves often indicate one-off tax items.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const tax = val(ctx.current, 'taxExpense');
      const pbt = val(ctx.current, 'pbt');
      return {
        value: toPercent(safeDivPositiveDenominator(tax, pbt)),
        inputs: { taxExpense: tax, pbt },
        ...(isNum(pbt) && pbt <= 0 ? { note: 'Not meaningful when pre-tax profit is zero or negative.' } : {}),
      };
    },
  },

  /* ============ Returns ============ */
  {
    key: 'roa', label: 'Return on Assets (ROA)', group: 'returns', unit: 'percent',
    formula: 'Annualized Net Income / Average Total Assets',
    meaning: 'Profit generated per unit of assets deployed, regardless of how those assets were financed.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ni = annualizedFlow(ctx, 'netIncome');
      const avg = avgBalance(ctx, 'totalAssets');
      return {
        value: toPercent(safeDivPositiveDenominator(ni.value, avg.value)),
        inputs: { netIncome: ni.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'roe', label: 'Return on Equity (ROE)', group: 'returns', unit: 'percent',
    formula: '(Annualized Net Income − Preferred Dividends) / Average Shareholders’ Equity',
    meaning: 'Return generated on the capital shareholders have invested in the business.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ni = annualizedFlow(ctx, 'netIncome');
      const pref = val(ctx.current, 'preferredDividends');
      const attributable = isNum(ni.value) ? ni.value - (pref ?? 0) : null;
      const avg = avgBalance(ctx, 'totalEquity');
      const negativeEquity = isNum(avg.value) && avg.value <= 0;
      return {
        value: negativeEquity ? null : toPercent(safeDivPositiveDenominator(attributable, avg.value)),
        inputs: { netIncome: ni.value, preferredDividends: pref, ...avg.inputs },
        ...(negativeEquity
          ? { note: 'Equity is zero or negative, so return on equity has no meaningful interpretation for this period.' }
          : avg.note
            ? { note: avg.note }
            : {}),
      };
    },
  },
  {
    key: 'roic', label: 'Return on Invested Capital (ROIC)', group: 'returns', unit: 'percent',
    formula: 'Annualized NOPAT / Average Invested Capital, where NOPAT = EBIT × (1 − effective tax rate) and Invested Capital = Equity + Total Debt − Cash',
    meaning: 'Return the business earns on all operating capital employed, before financing structure. The core test of whether growth creates value.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cfg = ctx.metricConfig;
      const { value: rawNopat, taxRate, basis: taxBasis, note: taxNote } = nopat(ctx.current, cfg);
      const factor = ctx.annualizeInterimMetrics ? interimFactor(ctx) : 1;
      const nopatValue = isNum(rawNopat) ? rawNopat * factor : null;
      const curIC = investedCapital(ctx.current, cfg);
      const prevIC = investedCapital(ctx.prior, cfg);
      const avgIC = isNum(curIC) && isNum(prevIC) ? average(curIC, prevIC) : curIC;
      const inputs: Record<string, Num> = {
        ebit: val(ctx.current, 'ebit'),
        'effective tax rate': isNum(taxRate) ? taxRate * 100 : null,
        NOPAT: nopatValue,
        'invested capital (opening)': prevIC,
        'invested capital (closing)': curIC,
      };
      const cashLabel = cfg?.roic?.surplusCashTreatment === 'cash_only' ? 'Cash' : 'Cash + Short-Term Investments';
      const reported = toPercent(safeDivPositiveDenominator(nopatValue, avgIC));
      // The other surplus-cash treatment, shown when it moves the answer materially.
      const otherTreatment = cfg?.roic?.surplusCashTreatment === 'cash_only' ? 'cash_and_liquid_investments' as const : 'cash_only' as const;
      const otherCfg: MetricConfig = { ...cfg, roic: { ...cfg?.roic, surplusCashTreatment: otherTreatment } };
      const otherCur = investedCapital(ctx.current, otherCfg);
      const otherPrev = investedCapital(ctx.prior, otherCfg);
      const otherAvg = isNum(otherCur) && isNum(otherPrev) ? average(otherCur, otherPrev) : otherCur;
      const otherLabel = otherTreatment === 'cash_only' ? 'Cash' : 'Cash + Short-Term Investments';
      return {
        value: reported,
        formula: `Annualized NOPAT / Average Invested Capital, where NOPAT = EBIT × (1 − ${taxBasis} tax rate) and Invested Capital = Equity + Total Debt − ${cashLabel}`,
        ...(taxNote ? { note: taxNote } : {}),
        alternates: divergentAlternates(reported, [{
          label: `Surplus cash as ${otherLabel.toLowerCase()}`,
          value: toPercent(safeDivPositiveDenominator(nopatValue, otherAvg)),
          formula: `Annualized NOPAT / (Equity + Total Debt − ${otherLabel})`,
        }], cfg),
        inputs,
        ...(!isNum(taxRate)
          ? { note: 'An effective tax rate could not be established from pre-tax profit and tax expense, so NOPAT cannot be calculated.' }
          : !isNum(prevIC)
            ? { note: 'Closing invested capital used — no prior-period balance available for an average.' }
            : {}),
      };
    },
  },
  {
    key: 'roce', label: 'Return on Capital Employed (ROCE)', group: 'returns', unit: 'percent',
    formula: 'Annualized EBIT / resolved capital employed definition',
    meaning: 'Pre-tax operating return on the long-term capital financing the business.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ebit = annualizedFlow(ctx, 'ebit');
      const ta = val(ctx.current, 'totalAssets');
      const tcl = val(ctx.current, 'totalCurrentLiabilities');
      const equity = val(ctx.current, 'totalEquity');
      const debt = totalDebt(ctx.current);
      const advances = sumDefined([val(ctx.current, 'customerAdvancesCurrent'), val(ctx.current, 'customerAdvancesNonCurrent')]) ?? 0;
      const config = ctx.metricConfig?.roce;
      const otherIncome = val(ctx.current, 'otherIncome');
      const wantsOtherIncome = config?.numerator === 'ebit_plus_other_income';
      /*
       * A company that reports no other income should still get a ROCE. `add` returns null when
       * either side is missing, which suppressed the metric entirely for every such company the
       * moment this basis was selected — a configuration choice must never delete a figure the
       * data supports. The absent line is treated as absent rather than as zero, and the omission
       * is disclosed on the metric instead of being silently absorbed.
       */
      const numerator = wantsOtherIncome ? sumDefined([ebit.value, otherIncome]) : ebit.value;
      const numeratorLabel = wantsOtherIncome
        ? isNum(otherIncome) ? 'Annualized (EBIT + Other Income)' : 'Annualized EBIT'
        : 'Annualized EBIT';
      const numeratorNote = wantsOtherIncome && !isNum(otherIncome)
        ? 'Other income was selected for the numerator but is not reported for this period, so EBIT alone was used.'
        : undefined;
      const employedLabel = config?.denominator === 'equity_plus_debt'
        ? 'Equity + debt'
        : config?.denominator === 'equity_plus_debt_less_surplus_cash'
          ? 'Equity + debt less surplus cash'
          : config?.excludeCustomerAdvances
            ? 'Excluding customer advances'
            : 'Assets less current liabilities';
      const denominatorFormula = config?.denominator === 'equity_plus_debt'
        ? '(Total Equity + Total Debt)'
        : config?.denominator === 'equity_plus_debt_less_surplus_cash'
          ? '(Total Equity + Total Debt − Surplus Cash)'
          : config?.excludeCustomerAdvances
            ? '(Total Assets − Total Current Liabilities − Customer Advances)'
            : '(Total Assets − Total Current Liabilities)';
      const employed = config?.denominator === 'equity_plus_debt'
        ? (isNum(equity) && isNum(debt) ? equity + debt : null)
        : config?.denominator === 'equity_plus_debt_less_surplus_cash'
          ? (isNum(equity) && isNum(debt) ? equity + debt - (surplusCash(ctx.current) ?? 0) : null)
          : (() => {
              const base = subtract(ta, tcl);
              return isNum(base) ? base - (config?.excludeCustomerAdvances ? advances : 0) : null;
            })();
      const reported = toPercent(safeDivPositiveDenominator(numerator, employed));

      // Specification Part B. Every other defensible capital-employed basis is computed, and the
      // ones that disagree materially are carried alongside rather than discarded — the reference
      // case's two ROCE definitions differ by 3.3x and point to opposite conclusions.
      const assetsLessCurrent = subtract(ta, tcl);
      const bases: { label: string; value: Num; formula: string }[] = [
        {
          label: 'Assets less current liabilities',
          value: toPercent(safeDivPositiveDenominator(numerator, assetsLessCurrent)),
          formula: `${numeratorLabel} / (Total Assets − Total Current Liabilities)`,
        },
        {
          label: 'Excluding customer advances',
          value: toPercent(safeDivPositiveDenominator(numerator, isNum(assetsLessCurrent) ? assetsLessCurrent - advances : null)),
          formula: `${numeratorLabel} / (Total Assets − Total Current Liabilities − Customer Advances)`,
        },
        {
          label: 'Equity + debt',
          value: toPercent(safeDivPositiveDenominator(numerator, isNum(equity) && isNum(debt) ? equity + debt : null)),
          formula: `${numeratorLabel} / (Total Equity + Total Debt)`,
        },
        {
          label: 'Equity + debt less surplus cash',
          value: toPercent(safeDivPositiveDenominator(numerator, isNum(equity) && isNum(debt) ? equity + debt - (surplusCash(ctx.current) ?? 0) : null)),
          formula: `${numeratorLabel} / (Total Equity + Total Debt − Surplus Cash)`,
        },
      ].filter((basis) => basis.label !== employedLabel);

      return {
        value: reported,
        formula: `${numeratorLabel} / ${denominatorFormula}`,
        ...(numeratorNote ? { note: numeratorNote } : {}),
        inputs: { ebit: numerator, totalAssets: ta, totalCurrentLiabilities: tcl, totalEquity: equity, totalDebt: debt, customerAdvances: advances, 'capital employed': employed },
        alternates: divergentAlternates(reported, bases, ctx.metricConfig),
      };
    },
  },

  /* ============ Liquidity ============ */
  {
    key: 'currentRatio', label: 'Current Ratio', group: 'liquidity', unit: 'times',
    formula: 'Total Current Assets / Total Current Liabilities',
    meaning: 'Measures the ability to meet short-term obligations out of assets expected to convert to cash within a year.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ca = val(ctx.current, 'totalCurrentAssets');
      const cl = val(ctx.current, 'totalCurrentLiabilities');
      return { value: safeDiv(ca, cl), inputs: { totalCurrentAssets: ca, totalCurrentLiabilities: cl } };
    },
  },
  {
    key: 'quickRatio', label: 'Quick Ratio', group: 'liquidity', unit: 'times',
    formula: '(Total Current Assets − Inventory) / Total Current Liabilities',
    meaning: 'Short-term coverage excluding inventory, which is the slowest current asset to convert to cash.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ca = val(ctx.current, 'totalCurrentAssets');
      const inv = val(ctx.current, 'inventory');
      const cl = val(ctx.current, 'totalCurrentLiabilities');
      const quickAssets = isNum(ca) ? ca - (inv ?? 0) : null;
      return {
        value: safeDiv(quickAssets, cl),
        inputs: { totalCurrentAssets: ca, inventory: inv, totalCurrentLiabilities: cl },
        ...(!isNum(inv) && isNum(ca)
          ? { note: 'Inventory was not supplied and has been treated as nil for this calculation; the ratio may be overstated if inventory exists.' }
          : {}),
      };
    },
  },
  {
    key: 'cashRatio', label: 'Cash Ratio', group: 'liquidity', unit: 'times',
    formula: '(Cash + Short-Term Investments) / Total Current Liabilities',
    meaning: 'The most conservative liquidity test: obligations coverable from cash on hand alone.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cash = val(ctx.current, 'cash');
      const sti = val(ctx.current, 'shortTermInvestments');
      const cl = val(ctx.current, 'totalCurrentLiabilities');
      const liquid = isNum(cash) ? cash + (sti ?? 0) : null;
      return { value: safeDiv(liquid, cl), inputs: { cash, shortTermInvestments: sti, totalCurrentLiabilities: cl } };
    },
  },

  /* ============ Solvency ============ */
  {
    key: 'totalDebt', label: 'Total Debt', group: 'solvency', unit: 'currency',
    formula: 'Short-Term Debt + Long-Term Debt',
    meaning: 'All interest-bearing borrowings on the balance sheet.',
    higherIsBetter: false,
    compute: (ctx) => ({
      value: totalDebt(ctx.current),
      inputs: { shortTermDebt: val(ctx.current, 'shortTermDebt'), longTermDebt: val(ctx.current, 'longTermDebt') },
    }),
  },
  {
    key: 'netDebt', label: 'Net Debt', group: 'solvency', unit: 'currency',
    formula: 'Total Debt − Cash − Short-Term Investments',
    meaning: 'Borrowings net of liquid resources. Negative net debt means the company holds more cash than debt.',
    higherIsBetter: false,
    compute: (ctx) => ({
      value: netDebt(ctx.current),
      inputs: {
        'total debt': totalDebt(ctx.current),
        cash: val(ctx.current, 'cash'),
        shortTermInvestments: val(ctx.current, 'shortTermInvestments'),
      },
    }),
  },
  {
    key: 'debtToEquity', label: 'Debt / Equity', group: 'solvency', unit: 'times',
    formula: 'Total Debt / Total Equity',
    meaning: 'How much borrowed capital the company uses per unit of shareholder capital.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const debt = totalDebt(ctx.current);
      const equity = val(ctx.current, 'totalEquity');
      const negative = isNum(equity) && equity <= 0;
      return {
        value: negative ? null : safeDiv(debt, equity),
        inputs: { 'total debt': debt, totalEquity: equity },
        ...(negative ? { note: 'Equity is zero or negative, so the ratio is not meaningful.' } : {}),
      };
    },
  },
  {
    key: 'debtToAssets', label: 'Debt / Assets', group: 'solvency', unit: 'times',
    formula: 'Total Debt / Total Assets',
    meaning: 'Share of the asset base funded by borrowings.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => ({
      value: safeDiv(totalDebt(ctx.current), val(ctx.current, 'totalAssets')),
      inputs: { 'total debt': totalDebt(ctx.current), totalAssets: val(ctx.current, 'totalAssets') },
    }),
  },
  {
    key: 'netDebtToEbitda', label: 'Net Debt / EBITDA', group: 'solvency', unit: 'times',
    formula: 'Net Debt / EBITDA',
    meaning: 'Years of current operating earnings needed to repay net borrowings. The standard leverage test used by lenders.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const nd = netDebt(ctx.current);
      const ebitda = val(ctx.current, 'ebitda');
      const negativeEbitda = isNum(ebitda) && ebitda <= 0;
      return {
        value: negativeEbitda ? null : safeDiv(nd, ebitda),
        inputs: { 'net debt': nd, ebitda },
        ...(isNum(nd) && nd < 0 ? { note: 'Negative leverage represents a net cash position; display it as net cash.' } : {}),
        ...(negativeEbitda ? { note: 'EBITDA is zero or negative, so this leverage multiple cannot be interpreted.' } : {}),
      };
    },
  },
  {
    key: 'interestCoverage', label: 'Interest Coverage', group: 'solvency', unit: 'times',
    formula: 'EBIT / Interest Expense',
    meaning: 'How many times operating profit covers the interest bill. A direct read on debt-servicing capacity.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ebit = val(ctx.current, 'ebit');
      const interest = val(ctx.current, 'interestExpense');
      if (isNum(interest) && interest === 0) {
        return {
          value: null,
          inputs: { ebit, interestExpense: interest },
          note: 'No interest expense was reported, so coverage is not applicable.',
        };
      }
      return { value: safeDiv(ebit, interest), inputs: { ebit, interestExpense: interest } };
    },
  },
  {
    key: 'equityMultiplier', label: 'Equity Multiplier', group: 'solvency', unit: 'times',
    formula: 'Average Total Assets / Average Total Equity',
    meaning: 'Assets supported per unit of equity. The leverage component of the DuPont decomposition.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const assets = avgBalance(ctx, 'totalAssets');
      const equity = avgBalance(ctx, 'totalEquity');
      const negative = isNum(equity.value) && equity.value <= 0;
      return {
        value: negative ? null : safeDiv(assets.value, equity.value),
        inputs: { ...assets.inputs, ...equity.inputs },
        ...(negative ? { note: 'Equity is zero or negative, so the multiplier is not meaningful.' } : {}),
      };
    },
  },
  {
    key: 'cfoToDebt', label: 'CFO / Total Debt', group: 'solvency', unit: 'times',
    formula: 'Cash Flow from Operations / Total Debt',
    meaning: 'Share of borrowings that one year of operating cash flow could repay.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => ({
      value: safeDivPositiveDenominator(val(ctx.current, 'cfo'), totalDebt(ctx.current)),
      inputs: { cfo: val(ctx.current, 'cfo'), 'total debt': totalDebt(ctx.current) },
    }),
  },

  /* ============ Efficiency ============ */
  {
    key: 'assetTurnover', label: 'Asset Turnover', group: 'efficiency', unit: 'times',
    formula: 'Annualized Revenue / Average Total Assets',
    meaning: 'Revenue generated per unit of assets. Measures how hard the asset base is working.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = annualizedFlow(ctx, 'revenue');
      const avg = avgBalance(ctx, 'totalAssets');
      return {
        value: safeDivPositiveDenominator(rev.value, avg.value),
        inputs: { revenue: rev.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'fixedAssetTurnover', label: 'Fixed Asset Turnover', group: 'efficiency', unit: 'times',
    formula: 'Annualized Revenue / Average Net PP&E',
    meaning: 'Revenue generated per unit of productive fixed assets.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = annualizedFlow(ctx, 'revenue');
      const avg = avgBalance(ctx, 'ppe');
      return {
        value: safeDivPositiveDenominator(rev.value, avg.value),
        inputs: { revenue: rev.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'inventoryTurnover', label: 'Inventory Turnover', group: 'efficiency', unit: 'times',
    formula: 'Annualized COGS / Average Inventory',
    meaning: 'Number of times inventory is sold and replaced during the period.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = annualizedFlow(ctx, 'cogs');
      const avg = avgBalance(ctx, 'inventory');
      return {
        value: safeDivPositiveDenominator(cogs.value, avg.value),
        inputs: { cogs: cogs.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'receivablesTurnover', label: 'Receivables Turnover', group: 'efficiency', unit: 'times',
    formula: 'Annualized Revenue / Average Accounts Receivable',
    meaning: 'Number of times receivables are collected during the period.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = annualizedFlow(ctx, 'revenue');
      const avg = avgBalance(ctx, 'accountsReceivable');
      return {
        value: safeDivPositiveDenominator(rev.value, avg.value),
        inputs: { revenue: rev.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'payablesTurnover', label: 'Payables Turnover', group: 'efficiency', unit: 'times',
    formula: 'Annualized COGS / Average Accounts Payable',
    meaning: 'Number of times supplier balances are settled during the period.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = annualizedFlow(ctx, 'cogs');
      const avg = avgBalance(ctx, 'accountsPayable');
      return {
        value: safeDivPositiveDenominator(cogs.value, avg.value),
        inputs: { cogs: cogs.value, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },

  /* ============ Working capital ============ */
  {
    key: 'dso', label: 'Days Sales Outstanding (DSO)', group: 'workingCapital', unit: 'days',
    formula: '(Average Accounts Receivable / Annualized Revenue) × 365',
    meaning: 'Average number of days it takes to collect cash from customers after a sale.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const basis = daysBasis(ctx);
      // Specification Part B: which receivables line the collection period is measured on.
      // 'trade_only' is the peer-comparable basis; the default total includes unbilled revenue
      // and is not comparable without adjustment (see explanation E2).
      const dsoBasis = ctx.metricConfig?.receivables?.dsoBasis ?? 'trade_plus_unbilled';
      const sourceKey = dsoBasis === 'trade_only' ? 'tradeReceivables' : 'accountsReceivable';
      const avg = avgBalance(ctx, sourceKey);
      const ratio = safeDivPositiveDenominator(avg.value, rev);
      const reported = isNum(ratio) ? ratio * basis.days : null;

      const otherKey = sourceKey === 'tradeReceivables' ? 'accountsReceivable' : 'tradeReceivables';
      const otherAvg = avgBalance(ctx, otherKey);
      const otherRatio = safeDivPositiveDenominator(otherAvg.value, rev);
      const otherLabel = otherKey === 'tradeReceivables' ? 'Trade receivables only' : 'Including unbilled revenue';

      return {
        value: reported,
        formula: dsoBasis === 'trade_only'
          ? `(Average Trade Receivables / Annualized Revenue) × ${basis.days}`
          : `(Average Accounts Receivable, including unbilled / Annualized Revenue) × ${basis.days}`,
        inputs: { revenue: rev, ...avg.inputs },
        // 'both' always shows the second basis; otherwise only when it materially disagrees.
        alternates: dsoBasis === 'both' || isNum(otherRatio)
          ? divergentAlternates(reported, [{
              label: otherLabel,
              value: isNum(otherRatio) ? otherRatio * basis.days : null,
              formula: `(Average ${otherKey === 'tradeReceivables' ? 'Trade Receivables' : 'Accounts Receivable'} / Annualized Revenue) × ${basis.days}`,
            }], dsoBasis === 'both' ? { ...ctx.metricConfig, definitionDivergencePercent: 0 } : ctx.metricConfig)
          : [],
        ...(avg.note || basis.note ? { note: [avg.note, basis.note].filter(Boolean).join(' ') } : {}),
      };
    },
  },
  {
    key: 'tradeDso', label: 'Trade Receivables DSO', group: 'workingCapital', unit: 'days',
    formula: '(Average Trade Receivables / Annualized Revenue) × 365',
    meaning: 'Collection days using billed trade receivables only; excludes unbilled contract assets.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const avg = avgBalance(ctx, 'tradeReceivables');
      const basis = daysBasis(ctx);
      const ratio = safeDivPositiveDenominator(avg.value, rev);
      return {
        value: isNum(ratio) ? ratio * basis.days : null,
        inputs: { revenue: rev, ...avg.inputs },
        ...(avg.note || basis.note ? { note: [avg.note, basis.note].filter(Boolean).join(' ') } : {}),
      };
    },
  },
  {
    key: 'dio', label: 'Days Inventory Outstanding (DIO)', group: 'workingCapital', unit: 'days',
    formula: '(Average Inventory / Annualized COGS) × 365',
    meaning: 'Average number of days inventory sits before it is sold.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const avg = avgBalance(ctx, 'inventory');
      const basis = daysBasis(ctx);
      // Specification Part B. COGS is the textbook denominator, but a business that reports no
      // COGS split, or carries most of its cost below the gross-profit line, needs another base.
      const denominatorBasis = ctx.metricConfig?.inventory?.dioDenominator ?? 'cogs';
      const cogs = val(ctx.current, 'cogs');
      const totalOperatingCost = sumDefined([cogs, val(ctx.current, 'operatingExpenses')]);
      const revenue = val(ctx.current, 'revenue');
      const denominators: Record<string, { value: Num; label: string }> = {
        cogs: { value: cogs, label: 'Annualized COGS' },
        total_operating_cost: { value: totalOperatingCost, label: 'Annualized Total Operating Cost' },
        revenue: { value: revenue, label: 'Annualized Revenue' },
      };
      const chosen = denominators[denominatorBasis]!;
      const ratio = safeDivPositiveDenominator(avg.value, chosen.value);
      const reported = isNum(ratio) ? ratio * basis.days : null;

      return {
        value: reported,
        formula: `(Average Inventory / ${chosen.label}) × ${basis.days}`,
        inputs: { [denominatorBasis === 'cogs' ? 'cogs' : chosen.label.toLowerCase()]: chosen.value, ...avg.inputs },
        alternates: divergentAlternates(reported, Object.entries(denominators)
          .filter(([key]) => key !== denominatorBasis)
          .map(([, d]) => {
            const r = safeDivPositiveDenominator(avg.value, d.value);
            return { label: `On ${d.label.replace('Annualized ', '').toLowerCase()}`, value: isNum(r) ? r * basis.days : null, formula: `(Average Inventory / ${d.label}) × ${basis.days}` };
          }), ctx.metricConfig),
        ...(avg.note || basis.note ? { note: [avg.note, basis.note].filter(Boolean).join(' ') } : {}),
      };
    },
  },
  {
    key: 'dpo', label: 'Days Payables Outstanding (DPO)', group: 'workingCapital', unit: 'days',
    formula: '(Average Accounts Payable / COGS) × 365',
    meaning: 'Average number of days taken to pay suppliers. Longer terms fund the business, but can strain supplier relationships.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = val(ctx.current, 'cogs');
      const avg = avgBalance(ctx, 'accountsPayable');
      const ratio = safeDivPositiveDenominator(avg.value, cogs);
      const basis = daysBasis(ctx);
      return {
        value: isNum(ratio) ? ratio * basis.days : null,
        inputs: { cogs, ...avg.inputs },
        ...(avg.note || basis.note ? { note: [avg.note, basis.note].filter(Boolean).join(' ') } : {}),
      };
    },
  },
  {
    key: 'cashConversionCycle', label: 'Cash Conversion Cycle', group: 'workingCapital', unit: 'days',
    formula: 'DSO + DIO − DPO',
    meaning: 'Days of cash tied up in the operating cycle. A shorter cycle releases cash; a longer one consumes it.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const defs = METRIC_DEFINITIONS;
      const pick = (k: string) => defs.find((d) => d.key === k)!.compute(ctx).value;
      const dso = pick('dso');
      const dio = pick('dio');
      const dpo = pick('dpo');
      if (!isNum(dso) || !isNum(dpo)) {
        return { value: null, inputs: { DSO: dso, DIO: dio, DPO: dpo } };
      }
      // Inventory-free businesses legitimately have no DIO; treat it as nil but say so.
      const dioUsed = isNum(dio) ? dio : 0;
      return {
        value: dso + dioUsed - dpo,
        inputs: { DSO: dso, DIO: dio, DPO: dpo },
        ...(!isNum(dio) ? { note: 'Inventory days were unavailable and treated as nil in this cycle.' } : {}),
      };
    },
  },
  {
    key: 'workingCapital', label: 'Working Capital', group: 'workingCapital', unit: 'currency',
    formula: 'Total Current Assets − Total Current Liabilities',
    meaning: 'Net short-term capital tied up in running the business.',
    compute: (ctx) => {
      const cfg = ctx.metricConfig;
      const reported = workingCapital(ctx.current, cfg);
      const otherBasis: MetricConfig = {
        ...cfg,
        workingCapital: { basis: cfg?.workingCapital?.basis === 'operating_only' ? 'total_current' : 'operating_only' },
      };
      return {
        value: reported,
        formula: workingCapitalFormula(cfg),
        inputs: {
          totalCurrentAssets: val(ctx.current, 'totalCurrentAssets'),
          totalCurrentLiabilities: val(ctx.current, 'totalCurrentLiabilities'),
          accountsReceivable: val(ctx.current, 'accountsReceivable'),
          inventory: val(ctx.current, 'inventory'),
          accountsPayable: val(ctx.current, 'accountsPayable'),
        },
        alternates: divergentAlternates(reported, [{
          label: cfg?.workingCapital?.basis === 'operating_only' ? 'Total current basis' : 'Operating basis',
          value: workingCapital(ctx.current, otherBasis),
          formula: workingCapitalFormula(otherBasis),
        }], cfg),
      };
    },
  },
  {
    key: 'workingCapitalToRevenue', label: 'Working Capital / Revenue', group: 'workingCapital', unit: 'percent',
    formula: '(Total Current Assets − Total Current Liabilities) / Revenue',
    meaning: 'Share of revenue permanently tied up in working capital. Rising intensity consumes cash as the business grows.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const wc = workingCapital(ctx.current, ctx.metricConfig);
      const rev = val(ctx.current, 'revenue');
      return { value: toPercent(safeDivPositiveDenominator(wc, rev)), inputs: { 'working capital': wc, revenue: rev } };
    },
  },

  /* ============ Cash flow ============ */
  {
    key: 'cfo', label: 'Cash Flow from Operations', group: 'cashFlow', unit: 'currency',
    formula: 'Net cash generated by operating activities',
    meaning: 'Cash the core business actually produced, before investment and financing.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'cfo'), inputs: { cfo: val(ctx.current, 'cfo') } }),
  },
  {
    key: 'cfi', label: 'Cash Flow from Investing', group: 'cashFlow', unit: 'currency',
    formula: 'Net cash used in or generated by investing activities',
    meaning: 'Cash spent on (or released from) assets and investments. Sustained large outflows signal an investment phase.',
    compute: (ctx) => ({ value: val(ctx.current, 'cfi'), inputs: { cfi: val(ctx.current, 'cfi') } }),
  },
  {
    key: 'cff', label: 'Cash Flow from Financing', group: 'cashFlow', unit: 'currency',
    formula: 'Net cash from debt, equity and distributions',
    meaning: 'Cash raised from or returned to lenders and shareholders.',
    compute: (ctx) => ({ value: val(ctx.current, 'cff'), inputs: { cff: val(ctx.current, 'cff') } }),
  },
  {
    key: 'fcf', label: 'Free Cash Flow', group: 'cashFlow', unit: 'currency',
    formula: 'CFO − Capital Expenditure',
    meaning: 'Cash left after maintaining and growing the asset base. What is genuinely available to lenders and shareholders.',
    higherIsBetter: true,
    compute: (ctx) => {
      const cfg = ctx.metricConfig;
      const reported = freeCashFlow(ctx.current, cfg);
      // Understating capex overstates free cash flow, and the reference case shows how far: the
      // omitted intangible spend overstated FCF by 11%. The other bases are carried when they
      // materially disagree, so the gap is visible rather than a matter of which switch is set.
      const bases: CapexBasis[] = ['ppe_only', 'ppe_plus_intangibles', 'total_investing_capex'];
      const current = cfg?.freeCashFlow?.capexBasis ?? 'ppe_plus_intangibles';
      return {
        value: reported,
        formula: capexFormula(cfg),
        inputs: {
          cfo: val(ctx.current, 'cfo'),
          'purchase of PP&E': val(ctx.current, 'purchaseOfPPE') ?? val(ctx.current, 'capex'),
          'purchase of intangibles': val(ctx.current, 'purchaseOfIntangibles'),
        },
        alternates: divergentAlternates(reported, bases
          .filter((basis) => basis !== current)
          .map((basis) => {
            const alt: MetricConfig = { ...cfg, freeCashFlow: { capexBasis: basis } };
            return { label: capexLabel(basis), value: freeCashFlow(ctx.current, alt), formula: capexFormula(alt) };
          }), cfg),
      };
    },
  },
  {
    key: 'cfoMargin', label: 'CFO Margin', group: 'cashFlow', unit: 'percent',
    formula: 'CFO / Revenue',
    meaning: 'Share of revenue converted into operating cash.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => marginOf(ctx, 'cfo'),
  },
  {
    key: 'fcfMargin', label: 'FCF Margin', group: 'cashFlow', unit: 'percent',
    formula: 'Free Cash Flow / Revenue',
    meaning: 'Share of revenue converted into cash available after capital investment.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const fcf = freeCashFlow(ctx.current, ctx.metricConfig);
      const rev = val(ctx.current, 'revenue');
      return { value: toPercent(safeDivPositiveDenominator(fcf, rev)), inputs: { FCF: fcf, revenue: rev } };
    },
  },
  {
    key: 'cfoToNetIncome', label: 'CFO / Net Income', group: 'cashFlow', unit: 'times',
    formula: 'CFO / Net Income',
    meaning: 'Earnings quality test. Sustained readings below 1.0x mean reported profit is not turning into cash.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cfo = val(ctx.current, 'cfo');
      const ni = val(ctx.current, 'netIncome');
      const nonPositive = isNum(ni) && ni <= 0;
      return {
        value: nonPositive ? null : safeDiv(cfo, ni),
        inputs: { cfo, netIncome: ni },
        ...(nonPositive ? { note: 'Net income is zero or negative, so this conversion ratio is not interpretable.' } : {}),
      };
    },
  },
  {
    key: 'fcfConversion', label: 'FCF / Net Income', group: 'cashFlow', unit: 'times',
    formula: 'Free Cash Flow / Net Income',
    meaning: 'Share of accounting profit that survives as cash after capital investment.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const fcf = freeCashFlow(ctx.current, ctx.metricConfig);
      const ni = val(ctx.current, 'netIncome');
      const nonPositive = isNum(ni) && ni <= 0;
      return {
        value: nonPositive ? null : safeDiv(fcf, ni),
        inputs: { FCF: fcf, netIncome: ni },
        ...(nonPositive ? { note: 'Net income is zero or negative, so this conversion ratio is not interpretable.' } : {}),
      };
    },
  },
  {
    key: 'capexToCfo', label: 'Capex / CFO', group: 'cashFlow', unit: 'percent',
    formula: 'Capital Expenditure / CFO',
    meaning: 'Share of operating cash reinvested in the asset base. Readings above 100% mean investment exceeds internal cash generation.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const capex = val(ctx.current, 'capex');
      const cfo = val(ctx.current, 'cfo');
      return {
        value: toPercent(safeDivPositiveDenominator(isNum(capex) ? Math.abs(capex) : null, cfo)),
        inputs: { capex, cfo },
      };
    },
  },
  {
    key: 'capexToRevenue', label: 'Capex / Revenue', group: 'cashFlow', unit: 'percent',
    formula: 'Capital Expenditure / Revenue',
    meaning: 'Capital intensity of the business relative to its sales base.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const capex = val(ctx.current, 'capex');
      const rev = val(ctx.current, 'revenue');
      return {
        value: toPercent(safeDivPositiveDenominator(isNum(capex) ? Math.abs(capex) : null, rev)),
        inputs: { capex, revenue: rev },
      };
    },
  },
  {
    key: 'netChangeInCash', label: 'Net Change in Cash', group: 'cashFlow', unit: 'currency',
    formula: 'CFO + CFI + CFF (+ FX effect)',
    meaning: 'Overall movement in the cash balance across all three activities.',
    compute: (ctx) => ({
      value: val(ctx.current, 'netChangeInCash'),
      inputs: {
        cfo: val(ctx.current, 'cfo'),
        cfi: val(ctx.current, 'cfi'),
        cff: val(ctx.current, 'cff'),
        'fx effect': val(ctx.current, 'fxEffectOnCash'),
      },
    }),
  },

  /* ============ Per share and valuation ============ */
  {
    key: 'basicEPS', label: 'Basic EPS', group: 'perShare', unit: 'per_share',
    formula: '(Net Income − Preferred Dividends) / Weighted Average Shares Outstanding',
    meaning: 'Profit attributable to each ordinary share.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'basicEPS'), inputs: { basicEPS: val(ctx.current, 'basicEPS') } }),
  },
  {
    key: 'dilutedEPS', label: 'Diluted EPS', group: 'perShare', unit: 'per_share',
    formula: '(Net Income − Preferred Dividends) / Diluted Shares Outstanding',
    meaning: 'Profit per share assuming all dilutive instruments are converted.',
    higherIsBetter: true,
    compute: (ctx) => ({ value: val(ctx.current, 'dilutedEPS'), inputs: { dilutedEPS: val(ctx.current, 'dilutedEPS') } }),
  },
  {
    key: 'bookValuePerShare', label: 'Book Value Per Share', group: 'perShare', unit: 'per_share',
    formula: '(Total Equity − Preferred Equity) / Shares Outstanding',
    meaning: 'Accounting value of equity attributable to each ordinary share.',
    higherIsBetter: true,
    compute: (ctx) => {
      const eq = val(ctx.current, 'totalEquity');
      const pref = val(ctx.current, 'preferredEquity');
      const shares = val(ctx.current, 'sharesOutstanding');
      const common = isNum(eq) ? eq - (pref ?? 0) : null;
      return { value: safeDivPositiveDenominator(common, shares), inputs: { totalEquity: eq, preferredEquity: pref, sharesOutstanding: shares } };
    },
  },
  {
    key: 'dividendPayout', label: 'Dividend Payout Ratio', group: 'perShare', unit: 'percent',
    formula: 'Declared dividends (DPS × weighted shares) / Net Income; cash payout shown as secondary',
    meaning: 'Share of profit distributed to shareholders rather than retained in the business.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const div = val(ctx.current, 'dividendsPaid');
      const dps = val(ctx.current, 'dividendPerShare');
      const shares = val(ctx.current, 'sharesOutstanding');
      const ni = val(ctx.current, 'netIncome');
      const paid = isNum(div) ? Math.abs(div) : null;
      const declared = isNum(dps) && isNum(shares) ? Math.abs(dps * shares) : null;
      return {
        value: toPercent(safeDivPositiveDenominator(declared ?? paid, ni)),
        inputs: { declaredDividends: declared, dividendPerShare: dps, sharesOutstanding: shares, dividendsPaid: div, netIncome: ni },
        ...(isNum(declared) && isNum(paid) ? { note: `Headline uses declared payout (${declared.toFixed(2)}); cash payout was ${paid.toFixed(2)}.` } : {}),
      };
    },
  },
  {
    key: 'peRatio', label: 'Price / Earnings', group: 'valuation', unit: 'times',
    formula: 'Share Price / Basic EPS',
    meaning: 'Price paid per unit of current earnings.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const price = val(ctx.current, 'sharePrice');
      const eps = val(ctx.current, 'basicEPS');
      return { value: safeDivPositiveDenominator(price, eps), inputs: { sharePrice: price, basicEPS: eps } };
    },
  },
  {
    key: 'pbRatio', label: 'Price / Book', group: 'valuation', unit: 'times',
    formula: 'Market Capitalisation / Total Equity',
    meaning: 'Market value paid for each unit of book equity.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const marketCap = val(ctx.current, 'marketCap');
      const equity = val(ctx.current, 'totalEquity');
      return { value: safeDivPositiveDenominator(marketCap, equity), inputs: { marketCap, totalEquity: equity } };
    },
  },
  {
    key: 'evToEbitda', label: 'EV / EBITDA', group: 'valuation', unit: 'times',
    formula: '(Market Capitalisation + Net Debt) / EBITDA',
    meaning: 'Enterprise value relative to operating earnings.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const marketCap = val(ctx.current, 'marketCap');
      const nd = netDebt(ctx.current);
      const ebitda = val(ctx.current, 'ebitda');
      const ev = isNum(marketCap) && isNum(nd) ? marketCap + nd : null;
      return { value: safeDivPositiveDenominator(ev, ebitda), inputs: { marketCap, netDebt: nd, enterpriseValue: ev, ebitda } };
    },
  },
  {
    key: 'evToSales', label: 'EV / Sales', group: 'valuation', unit: 'times',
    formula: '(Market Capitalisation + Net Debt) / Revenue',
    meaning: 'Enterprise value relative to revenue.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const marketCap = val(ctx.current, 'marketCap');
      const nd = netDebt(ctx.current);
      const revenue = val(ctx.current, 'revenue');
      const ev = isNum(marketCap) && isNum(nd) ? marketCap + nd : null;
      return { value: safeDivPositiveDenominator(ev, revenue), inputs: { marketCap, netDebt: nd, enterpriseValue: ev, revenue } };
    },
  },
  {
    key: 'dividendYield', label: 'Dividend Yield', group: 'valuation', unit: 'percent',
    formula: 'Dividend Per Share / Share Price × 100',
    meaning: 'Declared cash distribution relative to the period-end share price.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const dps = val(ctx.current, 'dividendPerShare');
      const price = val(ctx.current, 'sharePrice');
      return { value: toPercent(safeDivPositiveDenominator(dps, price)), inputs: { dividendPerShare: dps, sharePrice: price } };
    },
  },
  {
    key: 'fcfYield', label: 'FCF Yield', group: 'valuation', unit: 'percent',
    formula: 'Free Cash Flow / Market Capitalisation × 100',
    meaning: 'Free cash flow generated relative to the market value of equity.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const fcf = freeCashFlow(ctx.current, ctx.metricConfig);
      const marketCap = val(ctx.current, 'marketCap');
      return { value: toPercent(safeDivPositiveDenominator(fcf, marketCap)), inputs: { freeCashFlow: fcf, marketCap } };
    },
  },
  {
    key: 'earningsYield', label: 'Earnings Yield', group: 'valuation', unit: 'percent',
    formula: 'Net Income / Market Capitalisation × 100',
    meaning: 'Accounting earnings relative to the market value of equity.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const ni = val(ctx.current, 'netIncome');
      const marketCap = val(ctx.current, 'marketCap');
      return { value: toPercent(safeDivPositiveDenominator(ni, marketCap)), inputs: { netIncome: ni, marketCap } };
    },
  },
];

export const METRIC_MAP: Record<string, MetricDefinition> = Object.fromEntries(
  METRIC_DEFINITIONS.map((d) => [d.key, d]),
);

export const METRIC_GROUP_LABELS: Record<MetricGroup, string> = {
  growth: 'Growth',
  profitability: 'Profitability',
  liquidity: 'Liquidity',
  solvency: 'Solvency & Leverage',
  efficiency: 'Operating Efficiency',
  workingCapital: 'Working Capital',
  cashFlow: 'Cash Flow',
  returns: 'Returns on Capital',
  perShare: 'Per Share',
  valuation: 'Valuation',
};

/** Aggregates used by charts and narratives that are not themselves metric definitions. */
export const DERIVED_AGGREGATES = { totalDebt, netDebt, freeCashFlow, investedCapital, nopat, workingCapital };

/** Re-exported for callers that need the raw accessor without importing normalize directly. */
export { val, add };
