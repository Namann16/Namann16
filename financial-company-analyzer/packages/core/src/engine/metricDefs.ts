import type { FinancialPeriod, MetricGroup, MetricUnit, Num } from '../types.js';
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
}

export interface MetricComputation {
  value: Num;
  /** Every raw input consumed, so the result is fully traceable. */
  inputs: Record<string, Num>;
  note?: string;
}

export interface MetricDefinition {
  key: string;
  label: string;
  group: MetricGroup;
  unit: MetricUnit;
  formula: string;
  meaning: string;
  higherIsBetter?: boolean;
  /** When true a change is naturally expressed in absolute terms (pp, days, x) not in %. */
  absoluteChangeOnly?: boolean;
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
  const liquid = sumDefined([val(p, 'cash'), val(p, 'shortTermInvestments')]) ?? 0;
  return debt - liquid;
}

/** Free cash flow = CFO − capital expenditure. */
export function freeCashFlow(p: FinancialPeriod | undefined): Num {
  const cfo = val(p, 'cfo');
  const capex = val(p, 'capex');
  if (!isNum(cfo) || !isNum(capex)) return null;
  return cfo - Math.abs(capex);
}

/**
 * Invested capital = total equity + total debt − cash.
 * This is the operating capital base the business must earn a return on.
 */
export function investedCapital(p: FinancialPeriod | undefined): Num {
  const equity = val(p, 'totalEquity');
  const debt = totalDebt(p);
  if (!isNum(equity) || !isNum(debt)) return null;
  const cash = val(p, 'cash') ?? 0;
  return equity + debt - cash;
}

/** NOPAT = EBIT × (1 − effective tax rate), with the effective rate taken from the P&L. */
export function nopat(p: FinancialPeriod | undefined): { value: Num; taxRate: Num } {
  const ebit = val(p, 'ebit');
  if (!isNum(ebit)) return { value: null, taxRate: null };
  const pbt = val(p, 'pbt');
  const tax = val(p, 'taxExpense');
  let rate: Num = null;
  if (isNum(pbt) && isNum(tax) && pbt > 0) {
    rate = tax / pbt;
    // Guard against nonsensical effective rates from one-off tax items.
    if (rate < 0 || rate > 0.6) rate = null;
  }
  if (rate === null) return { value: null, taxRate: null };
  return { value: ebit * (1 - rate), taxRate: rate };
}

export function workingCapital(p: FinancialPeriod | undefined): Num {
  return subtract(val(p, 'totalCurrentAssets'), val(p, 'totalCurrentLiabilities'));
}

/**
 * Average balance across the period, used for flow-over-stock ratios (ROE, turnover, DSO...).
 * When no prior period exists the closing balance is used and the caller is told so, because
 * silently mixing the two methodologies would make period comparisons misleading.
 */
function avgBalance(ctx: MetricContext, key: string): { value: Num; note?: string; inputs: Record<string, Num> } {
  const cur = val(ctx.current, key);
  const prev = val(ctx.prior, key);
  if (isNum(cur) && isNum(prev)) {
    return {
      value: average(cur, prev),
      inputs: { [`${key} (opening)`]: prev, [`${key} (closing)`]: cur },
    };
  }
  return {
    value: cur,
    note: 'Closing balance used — no prior-period balance is available to compute an average.',
    inputs: { [`${key} (closing)`]: cur },
  };
}

function growth(ctx: MetricContext, key: string): MetricComputation {
  const cur = val(ctx.current, key);
  const prev = val(ctx.prior, key);
  return {
    value: percentChange(prev, cur),
    inputs: { [`${key} (prior)`]: prev, [`${key} (current)`]: cur },
    ...(isNum(prev) && prev < 0
      ? { note: 'Growth is not reported off a negative base because the result would not be interpretable.' }
      : {}),
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

  /* ============ Growth ============ */
  {
    key: 'revenueGrowth', label: 'Revenue Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(Revenue − Prior Revenue) / Prior Revenue',
    meaning: 'Rate at which the top line expanded or contracted versus the prior period.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => growth(ctx, 'revenue'),
  },
  {
    key: 'ebitdaGrowth', label: 'EBITDA Growth (YoY)', group: 'growth', unit: 'percent',
    formula: '(EBITDA − Prior EBITDA) / Prior EBITDA',
    meaning: 'Growth in operating profitability before non-cash charges.',
    higherIsBetter: true, absoluteChangeOnly: true,
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
      const cur = freeCashFlow(ctx.current);
      const prev = freeCashFlow(ctx.prior);
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
    formula: 'Net Income / Average Total Assets',
    meaning: 'Profit generated per unit of assets deployed, regardless of how those assets were financed.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ni = val(ctx.current, 'netIncome');
      const avg = avgBalance(ctx, 'totalAssets');
      return {
        value: toPercent(safeDivPositiveDenominator(ni, avg.value)),
        inputs: { netIncome: ni, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'roe', label: 'Return on Equity (ROE)', group: 'returns', unit: 'percent',
    formula: '(Net Income − Preferred Dividends) / Average Shareholders’ Equity',
    meaning: 'Return generated on the capital shareholders have invested in the business.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ni = val(ctx.current, 'netIncome');
      const pref = val(ctx.current, 'preferredDividends');
      const attributable = isNum(ni) ? ni - (pref ?? 0) : null;
      const avg = avgBalance(ctx, 'totalEquity');
      const negativeEquity = isNum(avg.value) && avg.value <= 0;
      return {
        value: negativeEquity ? null : toPercent(safeDivPositiveDenominator(attributable, avg.value)),
        inputs: { netIncome: ni, preferredDividends: pref, ...avg.inputs },
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
    formula: 'NOPAT / Average Invested Capital, where NOPAT = EBIT × (1 − effective tax rate) and Invested Capital = Equity + Total Debt − Cash',
    meaning: 'Return the business earns on all operating capital employed, before financing structure. The core test of whether growth creates value.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const { value: nopatValue, taxRate } = nopat(ctx.current);
      const curIC = investedCapital(ctx.current);
      const prevIC = investedCapital(ctx.prior);
      const avgIC = isNum(curIC) && isNum(prevIC) ? average(curIC, prevIC) : curIC;
      const inputs: Record<string, Num> = {
        ebit: val(ctx.current, 'ebit'),
        'effective tax rate': isNum(taxRate) ? taxRate * 100 : null,
        NOPAT: nopatValue,
        'invested capital (opening)': prevIC,
        'invested capital (closing)': curIC,
      };
      return {
        value: toPercent(safeDivPositiveDenominator(nopatValue, avgIC)),
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
    formula: 'EBIT / (Total Assets − Total Current Liabilities)',
    meaning: 'Pre-tax operating return on the long-term capital financing the business.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const ebit = val(ctx.current, 'ebit');
      const ta = val(ctx.current, 'totalAssets');
      const tcl = val(ctx.current, 'totalCurrentLiabilities');
      const employed = subtract(ta, tcl);
      return {
        value: toPercent(safeDivPositiveDenominator(ebit, employed)),
        inputs: { ebit, totalAssets: ta, totalCurrentLiabilities: tcl, 'capital employed': employed },
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
      if (isNum(nd) && nd <= 0) {
        return {
          value: 0,
          inputs: { 'net debt': nd, ebitda },
          note: 'Net debt is zero or negative (net cash position), so leverage is reported as 0.0x.',
        };
      }
      const negativeEbitda = isNum(ebitda) && ebitda <= 0;
      return {
        value: negativeEbitda ? null : safeDiv(nd, ebitda),
        inputs: { 'net debt': nd, ebitda },
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
    formula: 'Revenue / Average Total Assets',
    meaning: 'Revenue generated per unit of assets. Measures how hard the asset base is working.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const avg = avgBalance(ctx, 'totalAssets');
      return {
        value: safeDivPositiveDenominator(rev, avg.value),
        inputs: { revenue: rev, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'fixedAssetTurnover', label: 'Fixed Asset Turnover', group: 'efficiency', unit: 'times',
    formula: 'Revenue / Average Net PP&E',
    meaning: 'Revenue generated per unit of productive fixed assets.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const avg = avgBalance(ctx, 'ppe');
      return {
        value: safeDivPositiveDenominator(rev, avg.value),
        inputs: { revenue: rev, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'inventoryTurnover', label: 'Inventory Turnover', group: 'efficiency', unit: 'times',
    formula: 'COGS / Average Inventory',
    meaning: 'Number of times inventory is sold and replaced during the period.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = val(ctx.current, 'cogs');
      const avg = avgBalance(ctx, 'inventory');
      return {
        value: safeDivPositiveDenominator(cogs, avg.value),
        inputs: { cogs, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'receivablesTurnover', label: 'Receivables Turnover', group: 'efficiency', unit: 'times',
    formula: 'Revenue / Average Accounts Receivable',
    meaning: 'Number of times receivables are collected during the period.',
    higherIsBetter: true, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const avg = avgBalance(ctx, 'accountsReceivable');
      return {
        value: safeDivPositiveDenominator(rev, avg.value),
        inputs: { revenue: rev, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'payablesTurnover', label: 'Payables Turnover', group: 'efficiency', unit: 'times',
    formula: 'COGS / Average Accounts Payable',
    meaning: 'Number of times supplier balances are settled during the period.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = val(ctx.current, 'cogs');
      const avg = avgBalance(ctx, 'accountsPayable');
      return {
        value: safeDivPositiveDenominator(cogs, avg.value),
        inputs: { cogs, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },

  /* ============ Working capital ============ */
  {
    key: 'dso', label: 'Days Sales Outstanding (DSO)', group: 'workingCapital', unit: 'days',
    formula: '(Average Accounts Receivable / Revenue) × 365',
    meaning: 'Average number of days it takes to collect cash from customers after a sale.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const rev = val(ctx.current, 'revenue');
      const avg = avgBalance(ctx, 'accountsReceivable');
      const ratio = safeDivPositiveDenominator(avg.value, rev);
      return {
        value: isNum(ratio) ? ratio * 365 : null,
        inputs: { revenue: rev, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
      };
    },
  },
  {
    key: 'dio', label: 'Days Inventory Outstanding (DIO)', group: 'workingCapital', unit: 'days',
    formula: '(Average Inventory / COGS) × 365',
    meaning: 'Average number of days inventory sits before it is sold.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const cogs = val(ctx.current, 'cogs');
      const avg = avgBalance(ctx, 'inventory');
      const ratio = safeDivPositiveDenominator(avg.value, cogs);
      return {
        value: isNum(ratio) ? ratio * 365 : null,
        inputs: { cogs, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
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
      return {
        value: isNum(ratio) ? ratio * 365 : null,
        inputs: { cogs, ...avg.inputs },
        ...(avg.note ? { note: avg.note } : {}),
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
    compute: (ctx) => ({
      value: workingCapital(ctx.current),
      inputs: {
        totalCurrentAssets: val(ctx.current, 'totalCurrentAssets'),
        totalCurrentLiabilities: val(ctx.current, 'totalCurrentLiabilities'),
      },
    }),
  },
  {
    key: 'workingCapitalToRevenue', label: 'Working Capital / Revenue', group: 'workingCapital', unit: 'percent',
    formula: '(Total Current Assets − Total Current Liabilities) / Revenue',
    meaning: 'Share of revenue permanently tied up in working capital. Rising intensity consumes cash as the business grows.',
    higherIsBetter: false, absoluteChangeOnly: true,
    compute: (ctx) => {
      const wc = workingCapital(ctx.current);
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
    compute: (ctx) => ({
      value: freeCashFlow(ctx.current),
      inputs: { cfo: val(ctx.current, 'cfo'), capex: val(ctx.current, 'capex') },
    }),
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
      const fcf = freeCashFlow(ctx.current);
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
      const fcf = freeCashFlow(ctx.current);
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
    formula: 'Dividends Paid / Net Income',
    meaning: 'Share of profit distributed to shareholders rather than retained in the business.',
    absoluteChangeOnly: true,
    compute: (ctx) => {
      const div = val(ctx.current, 'dividendsPaid');
      const ni = val(ctx.current, 'netIncome');
      const paid = isNum(div) ? Math.abs(div) : null;
      return {
        value: toPercent(safeDivPositiveDenominator(paid, ni)),
        inputs: { dividendsPaid: div, netIncome: ni },
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
