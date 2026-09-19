import type { CompanyDataset, FinancialPeriod } from '../../src/types.js';

/**
 * Reference regression fixture — Hindustan Aeronautics Limited, consolidated, INR crore.
 *
 * PROVENANCE MATTERS HERE. Two kinds of number appear below:
 *
 *   REAL      — quoted directly from the upgrade specification's reference-case tables.
 *   PLACEHOLDER — a value the specification does not supply, chosen only so the period is
 *                 structurally complete and the engine has a prior column to work from.
 *
 * Every placeholder is marked. No assertion in the acceptance suite may depend on one: a test
 * that passes because of a number nobody sourced is worse than a missing test. The assertions in
 * `halAcceptance.test.ts` are restricted to outcomes that follow from the REAL figures, and the
 * specification's remaining acceptance criteria (ROCE at 31.9%, the Operating Efficiency score,
 * the absolute FCF figures) are listed there as pending until the real FY22–FY25 columns land.
 */

/** FY26 figures, all quoted from the specification. */
const FY26_REAL = {
  revenue: 33088.82,
  ebitda: 9769.83,
  ebit: 8414.97,
  otherIncome: 3742.75,
  pbt: 12151.93,
  netIncome: 9115.52,
  // "Cash + bank deposits". Held as cash, because the specification's net-debt arithmetic
  // (65.82 − 46,195.76 = −46,129.94, i.e. −4.72x EBITDA) treats the whole balance as surplus.
  cash: 46195.76,
  longTermDebt: 65.82,
  totalAssets: 132414.60,
  totalEquity: 41044.60,
  customerAdvancesCurrent: 29500.94,
  customerAdvancesNonCurrent: 44689.09,
  // The receivables line and its billed-only component, the pair that explanation E2 turns on.
  accountsReceivable: 25022,
  tradeReceivables: 4066,
  // The specification reports FY26 inventory two ways — 40,641 against a reported 30,850.68 —
  // and a cash-flow movement of 9,180 that reconciles with neither. The larger figure is used
  // here so that the roll-forward check has the real discrepancy to catch.
  inventory: 40641,
  purchaseOfIntangibles: 1063.95,
};

/** FY25 figures the specification supplies. */
const FY25_REAL = {
  cfo: 13643,
};

/**
 * PLACEHOLDERS. The specification gives no FY25 balance sheet or income statement, so these exist
 * only to give FY26 a prior column. They are internally coherent but they are not HAL's accounts.
 */
const FY25_PLACEHOLDER = {
  revenue: 30982,
  ebitda: 8600,
  ebit: 7400,
  otherIncome: 3100,
  pbt: 10500,
  netIncome: 7595,
  cash: 38000,
  longTermDebt: 80,
  totalAssets: 116000,
  totalEquity: 35000,
  customerAdvancesCurrent: 25000,
  customerAdvancesNonCurrent: 38000,
  accountsReceivable: 20000,
  tradeReceivables: 3500,
  inventory: 28088,
  purchaseOfIntangibles: 900,
};

export const HAL_FY25: FinancialPeriod = {
  label: 'FY25',
  order: 0,
  values: { ...FY25_PLACEHOLDER, ...FY25_REAL },
  sources: Object.fromEntries(
    Object.keys({ ...FY25_PLACEHOLDER, ...FY25_REAL }).map((k) => [k, 'entered' as const]),
  ),
  // Specification C4 and explanation E7: FY25 CFO was inflated by a one-off surge in customer
  // advances after contract signings, so the FY26 comparison against it is not like-for-like.
  unusual: true,
  unusualReason: 'CFO was inflated by a one-off surge in customer advances following contract signings.',
};

export const HAL_FY26: FinancialPeriod = {
  label: 'FY26',
  order: 1,
  values: {
    ...FY26_REAL,
    // PLACEHOLDER: needed for the inventory roll-forward check. The specification states the
    // cash-flow movement was 9,180 and that it reconciles with neither inventory figure.
    changeInInventory: -9180,
  },
  sources: Object.fromEntries(
    Object.keys({ ...FY26_REAL, changeInInventory: 0 }).map((k) => [k, 'entered' as const]),
  ),
};

export function halDataset(): CompanyDataset {
  return {
    company: {
      name: 'Hindustan Aeronautics Limited',
      industry: 'manufacturing',
      currency: 'INR',
      units: 'crores',
      companyStage: 'mature',
      sectorProfile: 'defence_capital_goods',
    },
    periods: [HAL_FY25, HAL_FY26],
    businessContext: {
      periods: {
        // Order book figures and the recognition basis are quoted from the specification.
        FY25: { orderBook: 189302, revenueRecognitionBasis: 'over_time_cost_to_cost', customerType: 'government', unusual: true, unusualReason: HAL_FY25.unusualReason },
        FY26: { orderBook: 254538, revenueRecognitionBasis: 'over_time_cost_to_cost', customerType: 'government' },
      },
    },
  };
}

/** Values the specification supplies, exposed so tests assert against the source, not a copy. */
export const HAL_REFERENCE = {
  netDebtToEbitdaFy26: -4.72,
  investedCapitalFy26: -5085.34,
  tradeDsoFy26Days: 45,
  intangibleCapexFy26: 1063.95,
  orderBookCoverageYears: 254538 / 33088.82,
} as const;
