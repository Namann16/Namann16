import { LINE_ITEMS, LINE_ITEM_MAP } from '../engine/lineItems.js';

/**
 * Synonym dictionary for Excel import.
 *
 * Financial statements use wildly inconsistent terminology across jurisdictions and formats;
 * "Sales", "Net Sales", "Turnover", "Revenue from Operations" and "Total Income" can all mean
 * the same line. This dictionary drives the suggested mapping, but a low-confidence suggestion
 * is never applied silently — the import workflow asks the user to confirm.
 */
export const SYNONYMS: Record<string, string[]> = {
  revenue: [
    'revenue', 'net sales', 'sales', 'total revenue', 'turnover', 'revenue from operations',
    'net revenue', 'total income', 'operating revenue', 'gross sales', 'income from operations',
    'sales revenue', 'net turnover', 'revenue net',
  ],
  cogs: [
    'cogs', 'cost of goods sold', 'cost of sales', 'cost of revenue', 'cost of materials consumed',
    'material cost', 'direct costs', 'cost of goods', 'raw material cost', 'cost of products sold',
  ],
  grossProfit: ['gross profit', 'gross margin', 'gross income', 'gross profit loss'],
  operatingExpenses: [
    'operating expenses', 'opex', 'total operating expenses', 'operating costs', 'other expenses',
    'total expenses', 'sg&a', 'sga', 'selling general and administrative',
  ],
  employeeExpenses: ['employee expenses', 'employee benefit expenses', 'staff costs', 'personnel expenses', 'salaries and wages', 'employee cost', 'payroll'],
  sellingMarketingExpenses: ['selling and marketing', 'selling expenses', 'marketing expenses', 'advertising and promotion', 'sales and marketing', 'distribution expenses', 's&m'],
  generalAdminExpenses: ['general and administrative', 'administrative expenses', 'g&a', 'admin expenses', 'general administrative'],
  otherOperatingExpenses: ['other operating expenses', 'other operating costs', 'miscellaneous expenses'],
  ebitda: ['ebitda', 'operating profit before depreciation', 'operating ebitda', 'earnings before interest tax depreciation and amortisation', 'pbdit', 'ebidta', 'operating profit bdit'],
  depreciation: ['depreciation', 'depreciation expense', 'depreciation and amortisation', 'depreciation & amortization', 'd&a', 'depreciation amortisation'],
  amortization: ['amortisation', 'amortization', 'amortisation expense', 'amortisation of intangibles'],
  ebit: ['ebit', 'operating profit', 'operating income', 'profit from operations', 'pbit', 'operating profit loss', 'earnings before interest and tax'],
  interestExpense: ['interest expense', 'finance cost', 'finance costs', 'interest', 'interest and finance charges', 'borrowing costs', 'interest cost'],
  otherIncome: ['other income', 'non operating income', 'other operating income', 'miscellaneous income', 'other revenue'],
  exceptionalItems: ['exceptional items', 'extraordinary items', 'one off items', 'exceptional item', 'non recurring items'],
  pbt: ['profit before tax', 'pbt', 'pre tax profit', 'income before tax', 'earnings before tax', 'ebt', 'profit loss before tax'],
  taxExpense: ['tax expense', 'income tax', 'tax', 'provision for tax', 'total tax expense', 'taxation', 'current tax'],
  netIncome: ['net income', 'net profit', 'pat', 'profit after tax', 'profit for the year', 'net earnings', 'net profit loss', 'profit attributable to shareholders', 'bottom line', 'net profit for the period'],
  preferredDividends: ['preferred dividends', 'preference dividend', 'preferred dividend'],
  minorityInterest: ['minority interest', 'non controlling interest', 'nci'],

  cash: ['cash', 'cash and cash equivalents', 'cash & cash equivalents', 'cash and bank balances', 'cash equivalents', 'bank balances', 'cash in hand and at bank'],
  shortTermInvestments: ['short term investments', 'current investments', 'marketable securities', 'liquid investments'],
  accountsReceivable: ['accounts receivable', 'trade receivables', 'receivables', 'debtors', 'sundry debtors', 'trade debtors', 'net receivables', 'accounts receivables'],
  inventory: ['inventory', 'inventories', 'stock', 'stock in trade', 'closing stock', 'total inventories'],
  otherCurrentAssets: ['other current assets', 'other current asset', 'loans and advances current'],
  totalCurrentAssets: ['total current assets', 'current assets', 'total current asset'],
  ppe: ['property plant and equipment', 'ppe', 'net fixed assets', 'fixed assets', 'tangible assets', 'net block', 'property plant equipment'],
  intangibleAssets: ['intangible assets', 'intangibles', 'other intangible assets'],
  goodwill: ['goodwill', 'goodwill on consolidation'],
  longTermInvestments: ['long term investments', 'non current investments', 'investments non current'],
  otherNonCurrentAssets: ['other non current assets', 'other noncurrent assets', 'other assets'],
  totalNonCurrentAssets: ['total non current assets', 'non current assets', 'total noncurrent assets'],
  totalAssets: ['total assets', 'total asset', 'balance sheet total'],

  accountsPayable: ['accounts payable', 'trade payables', 'payables', 'creditors', 'sundry creditors', 'trade creditors'],
  shortTermDebt: ['short term debt', 'short term borrowings', 'current borrowings', 'current portion of long term debt', 'bank overdraft', 'short term loans'],
  otherCurrentLiabilities: ['other current liabilities', 'other current liability', 'provisions current'],
  totalCurrentLiabilities: ['total current liabilities', 'current liabilities', 'total current liability'],
  longTermDebt: ['long term debt', 'long term borrowings', 'non current borrowings', 'term loans', 'debentures', 'long term loans'],
  otherNonCurrentLiabilities: ['other non current liabilities', 'other noncurrent liabilities', 'deferred tax liabilities', 'provisions non current'],
  totalNonCurrentLiabilities: ['total non current liabilities', 'non current liabilities', 'total noncurrent liabilities'],
  totalLiabilities: ['total liabilities', 'total liability'],
  commonEquity: ['common equity', 'share capital', 'equity share capital', 'paid up capital', 'ordinary shares', 'common stock'],
  preferredEquity: ['preferred equity', 'preference share capital', 'preferred stock'],
  retainedEarnings: ['retained earnings', 'reserves and surplus', 'reserves & surplus', 'other equity', 'accumulated profits', 'general reserve'],
  treasuryStock: ['treasury stock', 'treasury shares', 'own shares held'],
  otherEquity: ['other equity components', 'other comprehensive income', 'capital reserve'],
  totalEquity: ['total equity', 'shareholders funds', 'shareholders equity', 'total shareholders equity', 'net worth', 'total equity and reserves', 'shareholder funds'],

  cfNetIncome: ['net income cash flow', 'profit before working capital changes', 'net profit cash flow'],
  cfDepreciation: ['depreciation add back', 'depreciation cash flow'],
  cfAmortization: ['amortisation add back', 'amortisation cash flow'],
  changeInReceivables: ['change in receivables', 'increase decrease in receivables', 'changes in trade receivables', 'movement in debtors'],
  changeInInventory: ['change in inventory', 'increase decrease in inventories', 'changes in inventories', 'movement in stock'],
  changeInPayables: ['change in payables', 'increase decrease in payables', 'changes in trade payables', 'movement in creditors'],
  changeInOtherWorkingCapital: ['change in other working capital', 'other working capital changes', 'changes in other current assets and liabilities'],
  otherNonCashExpenses: ['other non cash expenses', 'non cash adjustments', 'other non cash items'],
  otherOperatingAdjustments: ['other operating adjustments', 'other operating activities', 'taxes paid'],
  cfo: ['cfo', 'cash flow from operations', 'net cash from operating activities', 'operating cash flow', 'cash generated from operations', 'net cash flow from operating activities', 'cash from operations'],
  capex: ['capex', 'capital expenditure', 'additions to fixed assets', 'purchase of fixed assets', 'capital expenditures'],
  purchaseOfPPE: ['purchase of ppe', 'purchase of property plant and equipment', 'acquisition of fixed assets'],
  saleOfPPE: ['sale of ppe', 'proceeds from sale of fixed assets', 'disposal of fixed assets'],
  purchaseOfInvestments: ['purchase of investments', 'investments made'],
  saleOfInvestments: ['sale of investments', 'proceeds from sale of investments', 'redemption of investments'],
  otherInvestingCashFlow: ['other investing activities', 'other investing cash flow', 'interest received'],
  cfi: ['cfi', 'cash flow from investing', 'net cash used in investing activities', 'investing cash flow', 'net cash flow from investing activities'],
  debtIssued: ['debt issued', 'proceeds from borrowings', 'borrowings raised', 'proceeds from long term borrowings'],
  debtRepaid: ['debt repaid', 'repayment of borrowings', 'repayment of long term borrowings'],
  equityIssued: ['equity issued', 'proceeds from issue of shares', 'share issue proceeds'],
  shareBuybacks: ['share buybacks', 'buyback of shares', 'repurchase of shares', 'treasury stock purchased'],
  dividendsPaid: ['dividends paid', 'dividend paid', 'dividend distribution', 'dividends including dividend tax'],
  otherFinancingCashFlow: ['other financing activities', 'other financing cash flow', 'interest paid'],
  cff: ['cff', 'cash flow from financing', 'net cash used in financing activities', 'financing cash flow', 'net cash flow from financing activities'],
  netChangeInCash: ['net change in cash', 'net increase decrease in cash', 'net increase in cash and cash equivalents'],
  openingCash: ['opening cash', 'cash at beginning of year', 'opening balance of cash'],
  closingCash: ['closing cash', 'cash at end of year', 'closing balance of cash'],
  fxEffectOnCash: ['effect of exchange rate', 'foreign exchange effect on cash', 'fx effect'],

  basicEPS: ['basic eps', 'eps', 'earnings per share', 'basic earnings per share', 'eps basic'],
  dilutedEPS: ['diluted eps', 'diluted earnings per share', 'eps diluted'],
  sharesOutstanding: ['shares outstanding', 'number of shares', 'weighted average shares', 'equity shares outstanding', 'no of shares', 'share count'],
  dilutedShares: ['diluted shares', 'diluted shares outstanding', 'weighted average diluted shares'],
  sharePrice: ['share price', 'stock price', 'market price', 'closing price', 'price per share'],
  marketCap: ['market capitalisation', 'market capitalization', 'market cap', 'mcap'],
  dividendPerShare: ['dividend per share', 'dps'],
};

/**
 * Labels that are never a data row, whatever the sheet contains. A statement may have a row
 * called "Total Assets", but a row called simply "ASSETS" is always a banner.
 */
const ALWAYS_HEADERS = new Set([
  'assets', 'liabilities', 'equity', 'income statement', 'balance sheet', 'cash flow statement',
  'profit and loss', 'statement of profit and loss', 'particulars', 'description',
  'operating activities', 'investing activities', 'financing activities',
  'cash flows from operating activities', 'cash flows from investing activities',
  'cash flows from financing activities',
  'current assets', 'non current assets', 'current liabilities', 'non current liabilities',
  'equity and liabilities', 'shareholders funds', 'sources of funds', 'application of funds',
  'notes', 'note',
]);

/**
 * Labels that are a banner only when the row carries no numbers. "Income" above a block of
 * revenue lines is a heading; "Income" with figures beside it is the total income line, and
 * treating it as a heading would silently drop real data.
 */
const BANNER_HEADERS = new Set([
  'income', 'incomes', 'expenses', 'expenditure', 'revenue', 'revenues', 'earnings',
  'total', 'totals', 'operating', 'investing', 'financing',
]);

export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\b(rs|inr|usd|eur|gbp|cr|crore|crores|lakhs?|mn|million|bn|billion|thousands?|in)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, used as the fallback similarity measure for unrecognised labels. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function tokenOverlap(a: string, b: string): number {
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared += 1;
  return shared / Math.max(at.size, bt.size);
}

export interface MappingSuggestion {
  targetKey: string;
  targetLabel: string;
  /** 0-100. 100 is an exact synonym match. */
  confidence: number;
  reason: string;
}

export interface MappingCandidate {
  sourceLabel: string;
  /** Row index in the source sheet, for round-tripping back to the file. */
  sourceRow: number;
  sheet: string;
  suggestions: MappingSuggestion[];
  /** The suggestion the workflow will apply unless the user changes it. */
  selected: string | null;
  /** True when the confidence is too low to apply without the user confirming. */
  requiresConfirmation: boolean;
  isSectionHeader: boolean;
}

/** Confidence at or above which a mapping is pre-selected. Below this the user must confirm. */
export const AUTO_MAP_CONFIDENCE = 80;
/** Confidence below which no suggestion is offered at all. */
export const MIN_SUGGESTION_CONFIDENCE = 45;

/**
 * Score how well a source label matches a canonical line item.
 *
 * Exact synonym matches score 100; substring and token-overlap matches score in the 60-95 band;
 * edit-distance similarity fills the gap below that. Nothing below MIN_SUGGESTION_CONFIDENCE is offered.
 */
export function scoreMatch(sourceLabel: string, targetKey: string): { confidence: number; reason: string } {
  const source = normalizeLabel(sourceLabel);
  const synonyms = SYNONYMS[targetKey] ?? [];
  const canonical = normalizeLabel(LINE_ITEM_MAP[targetKey]?.label ?? targetKey);
  const candidates = [canonical, ...synonyms.map(normalizeLabel)];

  let best = 0;
  let reason = '';

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (source === candidate) return { confidence: 100, reason: `Exact match with the recognised term "${candidate}".` };

    if (source.includes(candidate) || candidate.includes(source)) {
      const ratio = Math.min(source.length, candidate.length) / Math.max(source.length, candidate.length);
      const score = 70 + ratio * 25;
      if (score > best) { best = score; reason = `"${sourceLabel}" contains the recognised term "${candidate}".`; }
    }

    const overlap = tokenOverlap(source, candidate);
    if (overlap > 0) {
      const score = 45 + overlap * 45;
      if (score > best) { best = score; reason = `${Math.round(overlap * 100)}% of the words match the recognised term "${candidate}".`; }
    }

    const distance = levenshtein(source, candidate);
    const similarity = 1 - distance / Math.max(source.length, candidate.length, 1);
    if (similarity > 0.7) {
      const score = similarity * 90;
      if (score > best) { best = score; reason = `Closely resembles the recognised term "${candidate}" (${Math.round(similarity * 100)}% similar).`; }
    }
  }

  return { confidence: Math.round(Math.min(best, 99)), reason };
}

/** Rank every canonical line item against a source label and return the plausible ones. */
export function suggestMappings(sourceLabel: string, restrictTo?: string[]): MappingSuggestion[] {
  const pool = restrictTo ?? LINE_ITEMS.map((i) => i.key);
  return pool
    .map((key) => {
      const { confidence, reason } = scoreMatch(sourceLabel, key);
      return { targetKey: key, targetLabel: LINE_ITEM_MAP[key]?.label ?? key, confidence, reason };
    })
    .filter((s) => s.confidence >= MIN_SUGGESTION_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Decide whether a source row is a section banner rather than a financial line item.
 *
 * `hasValues` says whether the row carried any readable numbers. It defaults to true so that a
 * caller with no value information errs towards treating the row as data — dropping a real line
 * item is a worse failure than offering a mapping for a heading the user can ignore.
 */
export function isSectionHeader(label: string, options: { hasValues?: boolean } = {}): boolean {
  const normalized = normalizeLabel(label);
  if (ALWAYS_HEADERS.has(normalized)) return true;
  const hasValues = options.hasValues ?? true;
  return !hasValues && BANNER_HEADERS.has(normalized);
}

/**
 * Build the mapping proposal for a list of source labels.
 *
 * Each canonical target is claimed by at most one source row — the highest-confidence one —
 * so a workbook that lists "Revenue" twice does not overwrite itself silently.
 */
export function buildMappingPlan(
  rows: { label: string; row: number; sheet: string; hasValues?: boolean }[],
  restrictTo?: string[],
): MappingCandidate[] {
  const candidates: MappingCandidate[] = rows.map((row) => {
    const header = isSectionHeader(row.label, { hasValues: row.hasValues ?? true });
    const suggestions = header ? [] : suggestMappings(row.label, restrictTo);
    const top = suggestions[0];
    return {
      sourceLabel: row.label,
      sourceRow: row.row,
      sheet: row.sheet,
      suggestions,
      selected: top && top.confidence >= AUTO_MAP_CONFIDENCE ? top.targetKey : null,
      requiresConfirmation: !header && (!top || top.confidence < AUTO_MAP_CONFIDENCE),
      isSectionHeader: header,
    };
  });

  // Resolve collisions: if two rows both auto-selected the same target, keep the stronger match
  // and ask the user to confirm the weaker one rather than picking arbitrarily.
  const claimed = new Map<string, MappingCandidate>();
  for (const candidate of candidates) {
    if (!candidate.selected) continue;
    const existing = claimed.get(candidate.selected);
    if (!existing) { claimed.set(candidate.selected, candidate); continue; }
    const existingScore = existing.suggestions[0]?.confidence ?? 0;
    const score = candidate.suggestions[0]?.confidence ?? 0;
    const loser = score > existingScore ? existing : candidate;
    const winner = score > existingScore ? candidate : existing;
    loser.selected = null;
    loser.requiresConfirmation = true;
    claimed.set(winner.selected!, winner);
  }

  return candidates;
}
