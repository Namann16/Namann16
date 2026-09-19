import type { FinancialPeriod, Num } from '../types.js';
import { add, isNum, subtract, sumDefined, sumStrict } from '../utils/number.js';
import { LINE_ITEM_KEYS } from './lineItems.js';

/**
 * A single derivation rule. `compute` returns null when the rule cannot fire for lack of inputs.
 * Rules never overwrite a value the user entered — entered data always wins over derived data,
 * and any disagreement between the two is surfaced by the data-quality engine instead of being
 * silently resolved.
 */
export interface DerivationRule {
  target: string;
  formula: string;
  compute: (v: Record<string, Num>) => Num;
}

const g = (v: Record<string, Num>, k: string): Num => (isNum(v[k]) ? (v[k] as number) : null);

export const DERIVATION_RULES: DerivationRule[] = [
  /* ---------------- Income statement ---------------- */
  {
    target: 'grossProfit',
    formula: 'Revenue − COGS',
    compute: (v) => subtract(g(v, 'revenue'), g(v, 'cogs')),
  },
  {
    target: 'cogs',
    formula: 'Revenue − Gross Profit',
    compute: (v) => subtract(g(v, 'revenue'), g(v, 'grossProfit')),
  },
  {
    target: 'operatingExpenses',
    formula: 'Employee + Selling & Marketing + G&A + Other Operating Expenses',
    compute: (v) => {
      const parts = [
        g(v, 'employeeExpenses'),
        g(v, 'sellingMarketingExpenses'),
        g(v, 'generalAdminExpenses'),
        g(v, 'otherOperatingExpenses'),
      ];
      // Only derive when at least two components are present; a single component is more
      // likely to be a partial disclosure than a complete operating cost base.
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'ebitda',
    formula: 'Gross Profit − Operating Expenses',
    compute: (v) => subtract(g(v, 'grossProfit'), g(v, 'operatingExpenses')),
  },
  {
    target: 'ebitda',
    formula: 'EBIT + Depreciation + Amortisation',
    compute: (v) => {
      const ebit = g(v, 'ebit');
      if (!isNum(ebit)) return null;
      const da = sumDefined([g(v, 'depreciation'), g(v, 'amortization')]);
      return isNum(da) ? ebit + da : null;
    },
  },
  {
    target: 'ebit',
    formula: 'EBITDA − Depreciation − Amortisation',
    compute: (v) => {
      const ebitda = g(v, 'ebitda');
      if (!isNum(ebitda)) return null;
      const da = sumDefined([g(v, 'depreciation'), g(v, 'amortization')]);
      return isNum(da) ? ebitda - da : null;
    },
  },
  {
    target: 'pbt',
    formula: 'EBIT − Interest Expense + Other Income + Exceptional Items',
    compute: (v) => {
      const ebit = g(v, 'ebit');
      if (!isNum(ebit)) return null;
      const interest = g(v, 'interestExpense');
      if (!isNum(interest)) return null;
      const other = g(v, 'otherIncome') ?? 0;
      const exceptional = g(v, 'exceptionalItems') ?? 0;
      return ebit - interest + other + exceptional;
    },
  },
  {
    target: 'netIncome',
    formula: 'Profit Before Tax − Tax Expense',
    compute: (v) => subtract(g(v, 'pbt'), g(v, 'taxExpense')),
  },
  {
    target: 'pbt',
    formula: 'Net Income + Tax Expense',
    compute: (v) => add(g(v, 'netIncome'), g(v, 'taxExpense')),
  },
  {
    target: 'taxExpense',
    formula: 'Profit Before Tax − Net Income',
    compute: (v) => subtract(g(v, 'pbt'), g(v, 'netIncome')),
  },

  /* ---------------- Balance sheet ---------------- */
  // Trade receivables and unbilled revenue split the single v1 receivables line. Whichever two
  // of the three a workbook supplies, the third follows — which is what lets DSO be reported on
  // a trade-only basis (specification A/C1, explanation E2) for a v1-shaped import.
  {
    target: 'tradeReceivables',
    formula: 'Accounts Receivable − Unbilled Revenue',
    compute: (v) => subtract(g(v, 'accountsReceivable'), g(v, 'unbilledRevenue')),
  },
  {
    target: 'unbilledRevenue',
    formula: 'Accounts Receivable − Trade Receivables',
    compute: (v) => subtract(g(v, 'accountsReceivable'), g(v, 'tradeReceivables')),
  },
  {
    target: 'accountsReceivable',
    formula: 'Trade Receivables + Unbilled Revenue',
    compute: (v) => {
      const trade = g(v, 'tradeReceivables');
      const unbilled = g(v, 'unbilledRevenue');
      return isNum(trade) && isNum(unbilled) ? trade + unbilled : null;
    },
  },
  {
    target: 'totalCurrentAssets',
    formula: 'Cash + Short-Term Investments + Receivables + Inventory + Other Current Assets',
    compute: (v) => {
      const parts = [
        g(v, 'cash'),
        g(v, 'shortTermInvestments'),
        g(v, 'accountsReceivable'),
        g(v, 'inventory'),
        g(v, 'otherCurrentAssets'),
      ];
      return parts.filter(isNum).length >= 3 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'totalNonCurrentAssets',
    formula: 'PP&E + Intangibles + Goodwill + Long-Term Investments + Other Non-Current Assets',
    compute: (v) => {
      const parts = [
        g(v, 'ppe'),
        g(v, 'intangibleAssets'),
        g(v, 'goodwill'),
        g(v, 'longTermInvestments'),
        g(v, 'otherNonCurrentAssets'),
      ];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'totalNonCurrentAssets',
    formula: 'Total Assets − Total Current Assets',
    compute: (v) => subtract(g(v, 'totalAssets'), g(v, 'totalCurrentAssets')),
  },
  {
    target: 'totalAssets',
    formula: 'Total Current Assets + Total Non-Current Assets',
    compute: (v) => sumStrict([g(v, 'totalCurrentAssets'), g(v, 'totalNonCurrentAssets')]),
  },
  {
    target: 'totalCurrentLiabilities',
    formula: 'Accounts Payable + Short-Term Debt + Other Current Liabilities',
    compute: (v) => {
      const parts = [g(v, 'accountsPayable'), g(v, 'shortTermDebt'), g(v, 'otherCurrentLiabilities')];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'totalNonCurrentLiabilities',
    formula: 'Long-Term Debt + Other Non-Current Liabilities',
    compute: (v) => {
      const parts = [g(v, 'longTermDebt'), g(v, 'otherNonCurrentLiabilities')];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'totalLiabilities',
    formula: 'Total Current Liabilities + Total Non-Current Liabilities',
    compute: (v) => sumStrict([g(v, 'totalCurrentLiabilities'), g(v, 'totalNonCurrentLiabilities')]),
  },
  {
    target: 'totalEquity',
    formula: 'Common Equity + Preferred Equity + Retained Earnings + Treasury Stock + Other Equity',
    compute: (v) => {
      const parts = [
        g(v, 'commonEquity'),
        g(v, 'preferredEquity'),
        g(v, 'retainedEarnings'),
        g(v, 'treasuryStock'),
        g(v, 'otherEquity'),
      ];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },

  /* ---------------- Cash flow ---------------- */
  {
    target: 'cfo',
    formula:
      'Net Income + Depreciation + Amortisation + Non-Cash Items + Changes in Working Capital + Other Operating Adjustments',
    compute: (v) => {
      const ni = g(v, 'cfNetIncome') ?? g(v, 'netIncome');
      if (!isNum(ni)) return null;
      const parts = [
        g(v, 'cfDepreciation') ?? g(v, 'depreciation'),
        g(v, 'cfAmortization') ?? g(v, 'amortization'),
        g(v, 'otherNonCashExpenses'),
        g(v, 'changeInReceivables'),
        g(v, 'changeInInventory'),
        g(v, 'changeInPayables'),
        g(v, 'changeInOtherWorkingCapital'),
        g(v, 'otherOperatingAdjustments'),
      ];
      // Require depreciation and at least one working-capital movement before reconstructing CFO;
      // otherwise the result would understate the reconciliation rather than be unavailable.
      const hasDA = isNum(parts[0]) || isNum(parts[1]);
      const hasWC = [parts[3], parts[4], parts[5], parts[6]].some(isNum);
      if (!hasDA || !hasWC) return null;
      return ni + (sumDefined(parts) ?? 0);
    },
  },
  {
    target: 'capex',
    formula: 'Purchase of PP&E (absolute cash outflow)',
    compute: (v) => {
      const p = g(v, 'purchaseOfPPE');
      return isNum(p) ? Math.abs(p) : null;
    },
  },
  {
    target: 'cfi',
    formula:
      'Purchase of PP&E + Sale of PP&E + Purchase of Investments + Sale of Investments + Other Investing Cash Flow',
    compute: (v) => {
      const parts = [
        isNum(g(v, 'purchaseOfPPE')) ? -Math.abs(g(v, 'purchaseOfPPE') as number) : (isNum(g(v, 'capex')) ? -Math.abs(g(v, 'capex') as number) : null),
        g(v, 'saleOfPPE'),
        g(v, 'purchaseOfInvestments'),
        g(v, 'saleOfInvestments'),
        g(v, 'otherInvestingCashFlow'),
      ];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'cff',
    formula: 'Debt Issued + Debt Repaid + Equity Issued + Buybacks + Dividends + Other Financing Cash Flow',
    compute: (v) => {
      const parts = [
        g(v, 'debtIssued'),
        g(v, 'debtRepaid'),
        g(v, 'equityIssued'),
        g(v, 'shareBuybacks'),
        g(v, 'dividendsPaid'),
        g(v, 'otherFinancingCashFlow'),
      ];
      return parts.filter(isNum).length >= 2 ? sumDefined(parts) : null;
    },
  },
  {
    target: 'netChangeInCash',
    formula: 'CFO + CFI + CFF + FX Effect',
    compute: (v) => {
      const core = sumStrict([g(v, 'cfo'), g(v, 'cfi'), g(v, 'cff')]);
      if (!isNum(core)) return null;
      return core + (g(v, 'fxEffectOnCash') ?? 0);
    },
  },
  {
    target: 'closingCash',
    formula: 'Opening Cash + Net Change in Cash',
    compute: (v) => add(g(v, 'openingCash'), g(v, 'netChangeInCash')),
  },

  /* ---------------- Share data ---------------- */
  {
    target: 'basicEPS',
    formula: '(Net Income − Preferred Dividends) / Shares Outstanding',
    compute: (v) => {
      const ni = g(v, 'netIncome');
      const shares = g(v, 'sharesOutstanding');
      if (!isNum(ni) || !isNum(shares) || shares === 0) return null;
      const pref = g(v, 'preferredDividends') ?? 0;
      return (ni - pref) / shares;
    },
  },
  {
    target: 'marketCap',
    formula: 'Share Price × Shares Outstanding',
    compute: (v) => {
      const p = g(v, 'sharePrice');
      const s = g(v, 'sharesOutstanding');
      return isNum(p) && isNum(s) ? p * s : null;
    },
  },
];

export interface NormalizationNote {
  period: string;
  key: string;
  formula: string;
  message: string;
}

export interface NormalizationResult {
  periods: FinancialPeriod[];
  notes: NormalizationNote[];
}

/**
 * Fill in derivable line items and record which values were entered and which were calculated.
 *
 * Runs to a fixed point so chained derivations resolve (e.g. gross profit -> EBITDA -> EBIT -> PBT).
 * Entered values are never modified.
 */
export function normalizePeriods(input: FinancialPeriod[]): NormalizationResult {
  const notes: NormalizationNote[] = [];

  const periods = input
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((period) => {
      const values: Record<string, Num> = {};
      const sources: Record<string, 'entered' | 'calculated'> = {};

      // Seed with entered values only, dropping anything that is not a usable number.
      for (const key of LINE_ITEM_KEYS) {
        const raw = period.values?.[key];
        if (isNum(raw)) {
          values[key] = raw;
          sources[key] = period.sources?.[key] === 'calculated' ? 'calculated' : 'entered';
        }
      }

      // Opening cash for a period can be taken from the prior period's closing cash later;
      // here we only resolve within-period derivations.
      for (let pass = 0; pass < 8; pass += 1) {
        let changed = false;
        for (const rule of DERIVATION_RULES) {
          if (isNum(values[rule.target])) continue;
          const result = rule.compute(values);
          if (isNum(result)) {
            values[rule.target] = result;
            sources[rule.target] = 'calculated';
            notes.push({
              period: period.label,
              key: rule.target,
              formula: rule.formula,
              message: `${rule.target} was calculated as ${rule.formula}.`,
            });
            changed = true;
          }
        }
        if (!changed) break;
      }

      return {
        ...period,
        values,
        sources,
      } satisfies FinancialPeriod;
    });

  // Cross-period fill: opening cash of period n is closing cash of period n-1 when not supplied.
  for (let i = 1; i < periods.length; i += 1) {
    const prev = periods[i - 1]!;
    const cur = periods[i]!;
    if (!isNum(cur.values['openingCash'])) {
      const prevClosing = isNum(prev.values['closingCash']) ? prev.values['closingCash'] : prev.values['cash'];
      if (isNum(prevClosing)) {
        cur.values['openingCash'] = prevClosing;
        cur.sources['openingCash'] = 'calculated';
        notes.push({
          period: cur.label,
          key: 'openingCash',
          formula: `Closing cash of ${prev.label}`,
          message: `Opening cash was carried forward from ${prev.label}.`,
        });
        const closing = add(cur.values['openingCash'], cur.values['netChangeInCash'] ?? null);
        if (isNum(closing) && !isNum(cur.values['closingCash'])) {
          cur.values['closingCash'] = closing;
          cur.sources['closingCash'] = 'calculated';
        }
      }
    }
  }

  return { periods, notes };
}

/** Convenience accessor that treats an absent line item as null rather than undefined. */
export function val(period: FinancialPeriod | undefined, key: string): Num {
  if (!period) return null;
  const v = period.values[key];
  return isNum(v) ? v : null;
}

export function sourceOf(period: FinancialPeriod | undefined, key: string): 'entered' | 'calculated' | 'missing' {
  if (!period) return 'missing';
  if (!isNum(period.values[key])) return 'missing';
  return period.sources[key] === 'calculated' ? 'calculated' : 'entered';
}
