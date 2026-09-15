import { describe, expect, it } from 'vitest';
import {
  AUTO_MAP_CONFIDENCE,
  buildMappingPlan,
  parseCellValue,
  parsePeriodLabel,
  scoreMatch,
  suggestMappings,
} from '../src/index.js';

describe('cell value parsing', () => {
  it('reads plain and formatted numbers', () => {
    expect(parseCellValue(1234.5).value).toBe(1234.5);
    expect(parseCellValue('1,234.50').value).toBe(1234.5);
    expect(parseCellValue('1,23,456').value).toBe(123456);     // Indian grouping
    expect(parseCellValue(' 42 ').value).toBe(42);
  });

  it('strips currency symbols', () => {
    expect(parseCellValue('₹1,720').value).toBe(1720);
    expect(parseCellValue('$1,234.56').value).toBe(1234.56);
    expect(parseCellValue('Rs. 500').value).toBe(500);
  });

  it('reads parentheses and trailing minus as negative', () => {
    const paren = parseCellValue('(1,234)');
    expect(paren.value).toBe(-1234);
    expect(paren.interpretation).toBe('negative_parentheses');
    expect(parseCellValue('(₹90.5)').value).toBe(-90.5);
    expect(parseCellValue('1,234-').value).toBe(-1234);
  });

  it('converts percentages to their decimal form', () => {
    const pct = parseCellValue('18.4%');
    expect(pct.value).toBeCloseTo(0.184, 6);
    expect(pct.interpretation).toBe('percentage');
  });

  it('applies magnitude suffixes and reports the conversion', () => {
    const cr = parseCellValue('1,720 Cr', 'crores');
    expect(cr.value).toBe(1720);
    expect(cr.warning).toMatch(/crores/);
    // A value stated in crores inside a workbook declared in millions is rescaled.
    expect(parseCellValue('2 Cr', 'millions').value).toBe(20);
  });

  it('returns null — never zero — for blanks and unreadable text', () => {
    for (const blank of [null, undefined, '', '-', '—', 'N/A', 'nil', '#DIV/0!']) {
      const parsed = parseCellValue(blank);
      expect(parsed.value, `"${String(blank)}" must not become a number`).toBeNull();
    }
    const text = parseCellValue('see note 14');
    expect(text.value).toBeNull();
    expect(text.interpretation).toBe('text');
    expect(text.warning).toMatch(/rather than treated as zero/);
  });
});

describe('period label recognition', () => {
  const cases: [unknown, string][] = [
    ['FY24', 'FY24'],
    ['FY2024', 'FY24'],
    ['FY 2023-24', 'FY24'],
    ['F.Y. 2026', 'FY26'],
    ['2023-2024', 'FY24'],
    ['2024', 'FY24'],
    ['Mar-24', 'FY24'],
    ['31 March 2024', 'FY24'],
    ["Mar'26", 'FY26'],
    ['Year ended 31 March 2025', 'FY25'],
  ];

  it.each(cases)('reads %s as %s', (input, expected) => {
    expect(parsePeriodLabel(input)?.label).toBe(expected);
  });

  it('returns null for a header that is not a period', () => {
    expect(parsePeriodLabel('Particulars')).toBeNull();
    expect(parsePeriodLabel('')).toBeNull();
  });
});

describe('field mapping', () => {
  it('scores exact synonym matches at full confidence', () => {
    expect(scoreMatch('Net Sales', 'revenue').confidence).toBe(100);
    expect(scoreMatch('PAT', 'netIncome').confidence).toBe(100);
    expect(scoreMatch('Trade Receivables', 'accountsReceivable').confidence).toBe(100);
  });

  it('recognises common variants with high confidence', () => {
    for (const [label, key] of [
      ['Revenue from Operations', 'revenue'],
      ['Profit After Tax', 'netIncome'],
      ['Finance Costs', 'interestExpense'],
      ['Cash and Cash Equivalents', 'cash'],
      ['Net cash from operating activities', 'cfo'],
    ] as const) {
      const top = suggestMappings(label)[0]!;
      expect(top.targetKey, `${label} should map to ${key}`).toBe(key);
      expect(top.confidence).toBeGreaterThanOrEqual(AUTO_MAP_CONFIDENCE);
    }
  });

  it('gives every suggestion a stated reason', () => {
    for (const suggestion of suggestMappings('Turnover')) {
      expect(suggestion.reason.length).toBeGreaterThan(10);
    }
  });

  it('asks for confirmation instead of guessing on an unfamiliar label', () => {
    const plan = buildMappingPlan([{ label: 'Segment 3 allocation basis', row: 5, sheet: 'Sheet1' }]);
    expect(plan[0]!.selected).toBeNull();
    expect(plan[0]!.requiresConfirmation).toBe(true);
  });

  it('never maps two rows onto the same field silently', () => {
    const plan = buildMappingPlan([
      { label: 'Revenue', row: 1, sheet: 'P&L' },
      { label: 'Net Sales', row: 2, sheet: 'P&L' },
    ]);
    const claimed = plan.filter((c) => c.selected === 'revenue');
    expect(claimed).toHaveLength(1);
    const unclaimed = plan.find((c) => c.selected === null)!;
    expect(unclaimed.requiresConfirmation).toBe(true);
  });

  it('identifies section headers so they are not treated as data rows', () => {
    const plan = buildMappingPlan([
      { label: 'ASSETS', row: 1, sheet: 'BS' },
      { label: 'Total Assets', row: 2, sheet: 'BS' },
    ]);
    expect(plan[0]!.isSectionHeader).toBe(true);
    expect(plan[0]!.selected).toBeNull();
    expect(plan[1]!.selected).toBe('totalAssets');
  });
});
