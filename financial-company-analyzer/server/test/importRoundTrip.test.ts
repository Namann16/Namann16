import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyze } from '@fca/core';
import { commitImport, parseWorkbook } from '../src/services/excelImport.js';
import { buildTemplateWorkbook, templateBuffer } from '../src/services/excelTemplate.js';
import { exportMetricsCsv, exportStatementsCsv, exportWorkbookBuffer } from '../src/services/exportData.js';
import { buildReportHtml } from '../src/services/report.js';
import { buildSampleDataset } from '@fca/core';

function workbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Excel template', () => {
  it('contains a sheet for each statement plus company information', () => {
    const names = buildTemplateWorkbook().SheetNames;
    expect(names).toContain('Company Information');
    expect(names).toContain('Income Statement');
    expect(names).toContain('Balance Sheet');
    expect(names).toContain('Cash Flow Statement');
    expect(names).toContain('Share Data');
    expect(names).toContain('Segment Data');
  });

  it('produces a readable workbook', () => {
    const parsed = XLSX.read(templateBuffer(), { type: 'buffer' });
    expect(parsed.SheetNames.length).toBeGreaterThan(4);
  });
});

describe('import of a non-template workbook', () => {
  const buffer = workbookBuffer({
    'Company Information': [
      ['Company Name', 'Meridian Industrial Ltd.'],
      ['Industry', 'manufacturing'],
      ['Currency', 'INR'],
      ['Units', 'crores'],
    ],
    'P&L': [
      ['Statement of Profit and Loss'],
      [],
      ['Particulars', '2023-24', "Mar'25", 'FY 2026'],
      ['INCOME'],
      ['Revenue from Operations', '1,20,000', '₹1,38,500', '1,55,200'],
      ['Cost of Materials Consumed', '78,000', '89,400', '1,01,900'],
      ['Finance Costs', '3,200', '3,050', '2,880'],
      ['Profit After Tax', '9,842', '13,135', '13,631'],
      ['Unrecognisable row', '(500)', '-', 'n/a'],
    ],
    'Balance Sheet': [
      ['Particulars', '2023-24', "Mar'25", 'FY 2026'],
      ['ASSETS'],
      ['Trade Receivables', '18,400', '21,300', '27,800'],
      ['Purchase of Fixed Assets', '(11,000)', '(12,500)', '(14,400)'],
    ],
  });

  const parsed = parseWorkbook(buffer, { fileName: 'meridian.xlsx' });

  it('reads the company information sheet', () => {
    expect(parsed.detectedCompany.name).toBe('Meridian Industrial Ltd.');
    expect(parsed.detectedCompany.industry).toBe('manufacturing');
    expect(parsed.detectedCompany.units).toBe('crores');
  });

  it('normalises mixed period header formats to consistent labels', () => {
    expect(parsed.periods.map((p) => p.label)).toEqual(['FY24', 'FY25', 'FY26']);
  });

  it('maps recognised terminology at full confidence', () => {
    const byLabel = new Map(parsed.mappings.map((m) => [m.sourceLabel, m]));
    expect(byLabel.get('Revenue from Operations')!.selected).toBe('revenue');
    expect(byLabel.get('Cost of Materials Consumed')!.selected).toBe('cogs');
    expect(byLabel.get('Finance Costs')!.selected).toBe('interestExpense');
    expect(byLabel.get('Profit After Tax')!.selected).toBe('netIncome');
  });

  it('treats bare banners as section headers rather than data', () => {
    const income = parsed.mappings.find((m) => m.sourceLabel === 'INCOME')!;
    expect(income.isSectionHeader).toBe(true);
    expect(income.selected).toBeNull();
  });

  it('asks for confirmation rather than guessing an unfamiliar row', () => {
    const unknown = parsed.mappings.find((m) => m.sourceLabel === 'Unrecognisable row')!;
    expect(unknown.selected).toBeNull();
    expect(unknown.requiresConfirmation).toBe(true);
  });

  it('parses Indian grouping, currency symbols and blanks correctly', () => {
    const revenue = parsed.rows.find((r) => r.label === 'Revenue from Operations')!;
    expect(revenue.cells['FY24']!.value).toBe(120000);
    expect(revenue.cells['FY25']!.value).toBe(138500);
    const unknown = parsed.rows.find((r) => r.label === 'Unrecognisable row')!;
    expect(unknown.cells['FY24']!.value).toBe(-500);
    expect(unknown.cells['FY25']!.value).toBeNull();
    expect(unknown.cells['FY26']!.value).toBeNull();
  });

  it('commits only the confirmed mappings and reports what it skipped', () => {
    const decisions = Object.fromEntries(
      parsed.rows.map((row) => {
        const mapping = parsed.mappings.find((m) => m.sheet === row.sheet && m.sourceRow === row.row);
        return [row.key, mapping?.selected ?? null];
      }),
    );
    const result = commitImport(parsed, decisions, ['FY24', 'FY25', 'FY26']);

    expect(result.periods).toHaveLength(3);
    expect(result.periods[2]!.values['revenue']).toBe(155200);
    expect(result.applied.some((a) => a.target === 'revenue' && a.periodsFilled === 3)).toBe(true);
    expect(result.skipped.some((s) => s.label === 'Unrecognisable row')).toBe(true);
    // Everything imported is recorded as entered data; the engine derives the rest itself.
    expect(result.periods[0]!.sources['revenue']).toBe('entered');
  });

  it('normalises an inverted sign convention and says that it did', () => {
    const decisions = Object.fromEntries(parsed.rows.map((row) => [row.key, row.label === 'Purchase of Fixed Assets' ? 'capex' : null]));
    const result = commitImport(parsed, decisions, ['FY24']);
    expect(result.periods[0]!.values['capex']).toBe(11000);
    expect(result.warnings.some((w) => /sign convention/i.test(w.message))).toBe(true);
  });
});

describe('import rejects a workbook it cannot read', () => {
  it('rejects a workbook with no recognisable year columns, naming the sheets it examined', () => {
    expect(() =>
      parseWorkbook(workbookBuffer({ Data: [['Particulars', 'Column A', 'Column B'], ['Revenue', 100, 200]] }), {
        fileName: 'bad.xlsx',
      }),
    ).toThrow(/No financial years could be identified in "bad.xlsx"[\s\S]*Sheets examined: Data/);
  });

  it('rejects a file that is not a usable spreadsheet', () => {
    expect(() => parseWorkbook(Buffer.from('this is not a spreadsheet'), { fileName: 'notes.txt' })).toThrow();
  });

  it('keeps a banner label that carries numbers as a data row', () => {
    // "Income" above a block of revenue lines is a heading, but "Income" with figures beside it
    // is the total income line and must not be discarded as a heading.
    const withValues = parseWorkbook(
      workbookBuffer({ PL: [['Particulars', 'FY24', 'FY25'], ['Income', 1000, 1200], ['EXPENSES'], ['Other Expenses', 300, 340]] }),
      { fileName: 'banner.xlsx' },
    );
    const income = withValues.mappings.find((m) => m.sourceLabel === 'Income')!;
    const expenses = withValues.mappings.find((m) => m.sourceLabel === 'EXPENSES')!;
    expect(income.isSectionHeader).toBe(false);
    expect(expenses.isSectionHeader).toBe(true);
  });
});

describe('exports', () => {
  const analysis = analyze(buildSampleDataset());

  it('produces a workbook with data, metrics and analysis sheets', () => {
    const parsed = XLSX.read(exportWorkbookBuffer(analysis), { type: 'buffer' });
    expect(parsed.SheetNames).toContain('Metrics');
    expect(parsed.SheetNames).toContain('Analysis');
    expect(parsed.SheetNames).toContain('Income Statement');
  });

  it('marks every exported value as entered or calculated', () => {
    const parsed = XLSX.read(exportWorkbookBuffer(analysis), { type: 'buffer' });
    const csv = XLSX.utils.sheet_to_csv(parsed.Sheets['Income Statement']!);
    expect(csv).toMatch(/Entered|Calculated/);
  });

  it('escapes CSV fields and neutralises formula injection', () => {
    const csv = exportStatementsCsv(analysis);
    expect(csv.split('\r\n').length).toBeGreaterThan(10);
    const injected = analyze({
      ...buildSampleDataset(),
      company: { ...buildSampleDataset().company, name: '=cmd|calc' },
    });
    expect(exportStatementsCsv(injected)).toContain("'=cmd|calc");
  });

  it('leaves unavailable metrics blank rather than writing zero', () => {
    const sparse = analyze({
      company: { name: 'Sparse Co', industry: 'general', currency: 'INR', units: 'crores' },
      periods: [{ label: 'FY24', order: 0, values: { revenue: 100 }, sources: { revenue: 'entered' } }],
    });
    const csv = exportMetricsCsv(sparse);
    expect(csv).not.toMatch(/,0\r?\n/);
  });
});

describe('report generation', () => {
  const html = buildReportHtml(analyze(buildSampleDataset()));

  it('includes every required report section', () => {
    for (const heading of [
      'Company Overview', 'Executive Summary', 'Financial Statements', 'Growth Analysis',
      'Profitability Analysis', 'Liquidity', 'Solvency', 'Working Capital', 'Cash Flow',
      'DuPont Analysis', 'Red Flags', 'Key Insights', 'Overall Assessment', 'Data Quality',
    ]) {
      expect(html, `report must contain "${heading}"`).toContain(heading);
    }
  });

  it('labels the sample data as fictional', () => {
    expect(html).toMatch(/Fictional sample data/);
  });

  it('escapes company-supplied text', () => {
    const hostile = buildSampleDataset();
    hostile.company.name = '<script>alert(1)</script>';
    const output = buildReportHtml(analyze(hostile));
    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('carries a print stylesheet so the browser can produce the PDF', () => {
    expect(html).toContain('@media print');
    expect(html).toContain('window.print()');
  });
});
