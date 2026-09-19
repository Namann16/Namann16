import type { LineItemDef, StatementKey } from '../types.js';

/**
 * Canonical chart of accounts for the analyzer.
 *
 * Every raw number that enters the system is stored against one of these keys. Excel mapping,
 * manual input, validation, normalization and all downstream formulas refer to these keys only,
 * so there is exactly one place to add a new line item.
 */
export const LINE_ITEMS: LineItemDef[] = [
  /* ---------------- Income statement ---------------- */
  { key: 'revenue', label: 'Revenue / Net Sales', statement: 'income', section: 'Revenue', sign: 'positive', description: 'Net sales or total operating revenue for the period, after returns and discounts.' },
  { key: 'cogs', label: 'Cost of Goods Sold', statement: 'income', section: 'Revenue', sign: 'positive', description: 'Direct cost of producing the goods or services sold. Enter as a positive cost.' },
  { key: 'grossProfit', label: 'Gross Profit', statement: 'income', section: 'Revenue', derivable: true, description: 'Revenue less cost of goods sold.' },
  { key: 'operatingExpenses', label: 'Operating Expenses (total)', statement: 'income', section: 'Operating costs', sign: 'positive', description: 'Total operating expenses excluding COGS, depreciation and amortisation.' },
  { key: 'employeeExpenses', label: 'Employee Expenses', statement: 'income', section: 'Operating costs', sign: 'positive' },
  { key: 'sellingMarketingExpenses', label: 'Selling & Marketing Expenses', statement: 'income', section: 'Operating costs', sign: 'positive' },
  { key: 'generalAdminExpenses', label: 'General & Administrative Expenses', statement: 'income', section: 'Operating costs', sign: 'positive' },
  { key: 'otherOperatingExpenses', label: 'Other Operating Expenses', statement: 'income', section: 'Operating costs', sign: 'positive' },
  { key: 'ebitda', label: 'EBITDA', statement: 'income', section: 'Earnings', derivable: true, description: 'Earnings before interest, tax, depreciation and amortisation.' },
  { key: 'depreciation', label: 'Depreciation', statement: 'income', section: 'Earnings', sign: 'positive' },
  { key: 'amortization', label: 'Amortisation', statement: 'income', section: 'Earnings', sign: 'positive' },
  { key: 'ebit', label: 'EBIT / Operating Profit', statement: 'income', section: 'Earnings', derivable: true, description: 'Earnings before interest and tax.' },
  { key: 'interestExpense', label: 'Interest Expense (Finance Cost)', statement: 'income', section: 'Below the line', sign: 'positive' },
  { key: 'otherIncome', label: 'Other Income', statement: 'income', section: 'Below the line', sign: 'any' },
  { key: 'exceptionalItems', label: 'Exceptional / One-off Items', statement: 'income', section: 'Below the line', sign: 'any', description: 'Positive = gain, negative = loss. Excluded from EBITDA derivation.' },
  { key: 'pbt', label: 'Profit Before Tax', statement: 'income', section: 'Below the line', derivable: true },
  { key: 'taxExpense', label: 'Tax Expense', statement: 'income', section: 'Below the line', sign: 'positive' },
  { key: 'netIncome', label: 'Net Income (PAT)', statement: 'income', section: 'Below the line', derivable: true },
  { key: 'preferredDividends', label: 'Preferred Dividends', statement: 'income', section: 'Below the line', sign: 'positive' },
  { key: 'minorityInterest', label: 'Minority Interest', statement: 'income', section: 'Below the line', sign: 'any' },
  { key: 'interestIncome', label: 'Interest Income', statement: 'income', section: 'Banking', sign: 'positive', description: 'Interest earned by a bank or lender.' },
  { key: 'netInterestIncome', label: 'Net Interest Income', statement: 'income', section: 'Banking', sign: 'any', description: 'Interest income less interest expense.' },
  { key: 'sameStoreRevenue', label: 'Same-Store Revenue', statement: 'income', section: 'Retail', sign: 'positive', description: 'Revenue from stores open in both comparison periods.' },
  { key: 'dividendsDeclared', label: 'Dividends Declared', statement: 'income', section: 'Below the line', sign: 'positive' },

  /* ---------------- Balance sheet: assets ---------------- */
  { key: 'cash', label: 'Cash & Cash Equivalents', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'shortTermInvestments', label: 'Short-Term Investments', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'accountsReceivable', label: 'Accounts Receivable', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'tradeReceivables', label: 'Trade Receivables (billed only)', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'unbilledRevenue', label: 'Unbilled Revenue / Contract Assets', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'inventory', label: 'Inventory', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'otherCurrentAssets', label: 'Other Current Assets', statement: 'balance', section: 'Current assets', sign: 'positive' },
  { key: 'totalCurrentAssets', label: 'Total Current Assets', statement: 'balance', section: 'Current assets', derivable: true },
  { key: 'ppe', label: 'Property, Plant & Equipment (net)', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'capitalWorkInProgress', label: 'Capital Work in Progress', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'intangibleAssetsUnderDevelopment', label: 'Intangible Assets under Development', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'intangibleAssets', label: 'Intangible Assets', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'goodwill', label: 'Goodwill', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'longTermInvestments', label: 'Long-Term Investments', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'otherNonCurrentAssets', label: 'Other Non-Current Assets', statement: 'balance', section: 'Non-current assets', sign: 'positive' },
  { key: 'totalNonCurrentAssets', label: 'Total Non-Current Assets', statement: 'balance', section: 'Non-current assets', derivable: true },
  { key: 'totalAssets', label: 'Total Assets', statement: 'balance', section: 'Totals', derivable: true },
  { key: 'interestEarningAssets', label: 'Average Interest-Earning Assets', statement: 'balance', section: 'Banking', sign: 'positive' },

  /* ---------------- Balance sheet: liabilities ---------------- */
  { key: 'accountsPayable', label: 'Accounts Payable', statement: 'balance', section: 'Current liabilities', sign: 'positive' },
  { key: 'shortTermDebt', label: 'Short-Term Debt', statement: 'balance', section: 'Current liabilities', sign: 'positive' },
  { key: 'customerAdvancesCurrent', label: 'Customer Advances / Contract Liabilities — current', statement: 'balance', section: 'Current liabilities', sign: 'positive' },
  { key: 'leaseLiabilitiesCurrent', label: 'Lease Liabilities — current', statement: 'balance', section: 'Current liabilities', sign: 'positive' },
  { key: 'otherCurrentLiabilities', label: 'Other Current Liabilities', statement: 'balance', section: 'Current liabilities', sign: 'positive' },
  { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities', statement: 'balance', section: 'Current liabilities', derivable: true },
  { key: 'longTermDebt', label: 'Long-Term Debt', statement: 'balance', section: 'Non-current liabilities', sign: 'positive' },
  { key: 'customerAdvancesNonCurrent', label: 'Customer Advances / Contract Liabilities — non-current', statement: 'balance', section: 'Non-current liabilities', sign: 'positive' },
  { key: 'leaseLiabilitiesNonCurrent', label: 'Lease Liabilities — non-current', statement: 'balance', section: 'Non-current liabilities', sign: 'positive' },
  { key: 'otherNonCurrentLiabilities', label: 'Other Non-Current Liabilities', statement: 'balance', section: 'Non-current liabilities', sign: 'positive' },
  { key: 'totalNonCurrentLiabilities', label: 'Total Non-Current Liabilities', statement: 'balance', section: 'Non-current liabilities', derivable: true },
  { key: 'totalLiabilities', label: 'Total Liabilities', statement: 'balance', section: 'Totals', derivable: true },

  /* ---------------- Balance sheet: equity ---------------- */
  { key: 'commonEquity', label: 'Common Equity / Share Capital', statement: 'balance', section: 'Equity', sign: 'any' },
  { key: 'preferredEquity', label: 'Preferred Equity', statement: 'balance', section: 'Equity', sign: 'positive' },
  { key: 'retainedEarnings', label: 'Retained Earnings / Reserves', statement: 'balance', section: 'Equity', sign: 'any' },
  { key: 'treasuryStock', label: 'Treasury Stock', statement: 'balance', section: 'Equity', sign: 'any', description: 'Enter as a negative number if it reduces equity.' },
  { key: 'otherEquity', label: 'Other Equity', statement: 'balance', section: 'Equity', sign: 'any' },
  { key: 'totalEquity', label: 'Total Equity', statement: 'balance', section: 'Totals', derivable: true },

  /* ---------------- Cash flow: operating ---------------- */
  { key: 'cfNetIncome', label: 'Net Income (per cash flow statement)', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'cfDepreciation', label: 'Depreciation (add back)', statement: 'cashFlow', section: 'Operating', sign: 'positive' },
  { key: 'cfAmortization', label: 'Amortisation (add back)', statement: 'cashFlow', section: 'Operating', sign: 'positive' },
  { key: 'changeInReceivables', label: 'Change in Accounts Receivable', statement: 'cashFlow', section: 'Operating', sign: 'any', description: 'Cash-flow impact. Negative when receivables increase.' },
  { key: 'changeInInventory', label: 'Change in Inventory', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'changeInPayables', label: 'Change in Accounts Payable', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'changeInOtherWorkingCapital', label: 'Change in Other Working Capital', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'otherNonCashExpenses', label: 'Other Non-Cash Expenses', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'otherOperatingAdjustments', label: 'Other Operating Adjustments', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'cfo', label: 'Cash Flow from Operations (CFO)', statement: 'cashFlow', section: 'Operating', derivable: true },

  /* ---------------- Cash flow: investing ---------------- */
  { key: 'capex', label: 'Capital Expenditure', statement: 'cashFlow', section: 'Investing', sign: 'positive', description: 'Enter as a positive amount of cash spent. The engine applies the sign.' },
  { key: 'purchaseOfIntangibles', label: 'Purchase of Intangibles', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'purchaseOfIntangibleDevelopment', label: 'Purchase of Intangible Assets under Development', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'incomeTaxesPaid', label: 'Income Taxes Paid', statement: 'cashFlow', section: 'Operating', sign: 'any' },
  { key: 'interestReceived', label: 'Interest Received', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'purchaseOfPPE', label: 'Purchase of PP&E', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'saleOfPPE', label: 'Sale of PP&E', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'purchaseOfInvestments', label: 'Purchase of Investments', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'saleOfInvestments', label: 'Sale of Investments', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'otherInvestingCashFlow', label: 'Other Investing Cash Flow', statement: 'cashFlow', section: 'Investing', sign: 'any' },
  { key: 'cfi', label: 'Cash Flow from Investing (CFI)', statement: 'cashFlow', section: 'Investing', derivable: true },

  /* ---------------- Cash flow: financing ---------------- */
  { key: 'debtIssued', label: 'Debt Issued', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'debtRepaid', label: 'Debt Repaid', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'equityIssued', label: 'Equity Issued', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'shareBuybacks', label: 'Share Buybacks', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'dividendsPaid', label: 'Dividends Paid', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'otherFinancingCashFlow', label: 'Other Financing Cash Flow', statement: 'cashFlow', section: 'Financing', sign: 'any' },
  { key: 'cff', label: 'Cash Flow from Financing (CFF)', statement: 'cashFlow', section: 'Financing', derivable: true },
  { key: 'netChangeInCash', label: 'Net Change in Cash', statement: 'cashFlow', section: 'Reconciliation', derivable: true },
  { key: 'openingCash', label: 'Opening Cash Balance', statement: 'cashFlow', section: 'Reconciliation', sign: 'any' },
  { key: 'closingCash', label: 'Closing Cash Balance', statement: 'cashFlow', section: 'Reconciliation', sign: 'any' },
  { key: 'fxEffectOnCash', label: 'FX Effect on Cash', statement: 'cashFlow', section: 'Reconciliation', sign: 'any' },

  /* ---------------- Share data ---------------- */
  { key: 'basicEPS', label: 'Basic EPS', statement: 'share', section: 'Per share', unit: 'per_share', sign: 'any' },
  { key: 'dilutedEPS', label: 'Diluted EPS', statement: 'share', section: 'Per share', unit: 'per_share', sign: 'any' },
  { key: 'sharesOutstanding', label: 'Shares Outstanding (weighted average)', statement: 'share', section: 'Per share', unit: 'number', sign: 'positive' },
  { key: 'dilutedShares', label: 'Diluted Shares Outstanding', statement: 'share', section: 'Per share', unit: 'number', sign: 'positive' },
  { key: 'sharePrice', label: 'Share Price (period end)', statement: 'share', section: 'Market', unit: 'per_share', sign: 'positive' },
  { key: 'marketCap', label: 'Market Capitalisation (period end)', statement: 'share', section: 'Market', sign: 'positive' },
  { key: 'dividendPerShare', label: 'Dividend Per Share', statement: 'share', section: 'Market', unit: 'per_share', sign: 'positive' },
];

export const LINE_ITEM_MAP: Record<string, LineItemDef> = Object.fromEntries(
  LINE_ITEMS.map((item) => [item.key, item]),
);

export const LINE_ITEM_KEYS = LINE_ITEMS.map((i) => i.key);

/**
 * Membership test for line-item keys.
 *
 * Use this rather than a truthiness check on LINE_ITEM_MAP. That object is built with
 * `Object.fromEntries`, so it inherits from `Object.prototype` and a bracket lookup returns a
 * truthy value for inherited names — `constructor`, `toString`, `__proto__` and the rest would
 * pass a `if (!LINE_ITEM_MAP[key])` guard and defeat the allowlist. A Set has no such chain.
 */
export const LINE_ITEM_KEY_SET: ReadonlySet<string> = new Set(LINE_ITEM_KEYS);

/** True only for a key that is genuinely in the canonical registry. */
export function isLineItemKey(key: string): boolean {
  return LINE_ITEM_KEY_SET.has(key);
}

export function lineItemsFor(statement: StatementKey): LineItemDef[] {
  return LINE_ITEMS.filter((i) => i.statement === statement);
}

export function labelFor(key: string): string {
  return LINE_ITEM_MAP[key]?.label ?? key;
}

/** Statement display order for tables and exports. */
export const STATEMENT_ORDER: { key: StatementKey; label: string }[] = [
  { key: 'income', label: 'Income Statement' },
  { key: 'balance', label: 'Balance Sheet' },
  { key: 'cashFlow', label: 'Cash Flow Statement' },
  { key: 'share', label: 'Share Data' },
];

/**
 * Line items considered essential for a meaningful analysis. Used by the data-quality
 * completeness score — missing items here materially reduce what can be calculated.
 */
export const CORE_LINE_ITEMS = [
  'revenue',
  'ebitda',
  'ebit',
  'netIncome',
  'totalAssets',
  'totalEquity',
  'totalCurrentAssets',
  'totalCurrentLiabilities',
  'cash',
  'accountsReceivable',
  'inventory',
  'accountsPayable',
  'shortTermDebt',
  'longTermDebt',
  'cfo',
  'capex',
];
