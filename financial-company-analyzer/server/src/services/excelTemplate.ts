import * as XLSX from 'xlsx';
import { LINE_ITEMS, STATEMENT_ORDER, type StatementKey } from '@fca/core';

/**
 * Generates the downloadable Excel template.
 *
 * The template is the happy path for import, but the importer does not require it: any workbook
 * is accepted and mapped through the synonym dictionary. Using the template simply means every
 * row maps at 100% confidence.
 */

const DEFAULT_YEARS = ['FY22', 'FY23', 'FY24', 'FY25', 'FY26'];

function sheetForStatement(statement: StatementKey, label: string, years: string[]): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [];

  rows.push([label]);
  rows.push(['Enter values in the units declared on the Company Information sheet. Leave a cell blank if the figure is not available — do not enter zero.']);
  rows.push([]);
  rows.push(['Line item', ...years]);

  let currentSection = '';
  for (const item of LINE_ITEMS.filter((i) => i.statement === statement)) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      rows.push([currentSection.toUpperCase()]);
    }
    rows.push([item.label, ...years.map(() => null)]);
  }

  rows.push([]);
  rows.push(['Notes']);
  rows.push(['Rows marked as totals can be left blank — the application derives them from their components and labels them as calculated.']);
  rows.push(['Costs (COGS, expenses, interest, tax, capex) are entered as positive amounts. The application applies the correct sign.']);
  rows.push(['Cash flow movements keep their natural sign: an increase in receivables is a cash outflow and is entered as a negative number.']);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 46 }, ...years.map(() => ({ wch: 14 }))];
  return sheet;
}

export function buildTemplateWorkbook(years: string[] = DEFAULT_YEARS): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const info = XLSX.utils.aoa_to_sheet([
    ['Financial Company Analyzer — Import Template'],
    ['Complete the fields below, then fill in the statement sheets. Upload the file on the Data Input screen.'],
    [],
    ['Field', 'Value', 'Guidance'],
    ['Company Name', '', 'Required.'],
    ['Industry', '', 'One of: banking, financial_services, manufacturing, fmcg, retail, technology, pharmaceuticals, automobile, infrastructure, energy, telecom, general.'],
    ['Sector', '', 'Optional, free text.'],
    ['Country', '', 'Optional.'],
    ['Currency', 'INR', 'INR, USD, EUR, GBP, JPY, AUD, CAD, SGD or OTHER.'],
    ['Units', 'crores', 'units, thousands, lakhs, millions, crores or billions. All figures in this workbook must use the same units.'],
    ['Financial Year End', '31 March', 'Optional.'],
    ['Reporting Period', 'annual', 'annual, half_yearly or quarterly.'],
    ['Ticker', '', 'Optional.'],
    ['Benchmark Index', '', 'Optional.'],
    ['Market Capitalisation', '', 'Optional, in the units above.'],
    ['Share Price', '', 'Optional.'],
    ['Shares Outstanding', '', 'Optional, in the units above where relevant.'],
    [],
    ['Period labels'],
    ['Enter the financial years you will report, in chronological order (oldest first).'],
    ['Periods', ...years],
  ]);
  info['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, info, 'Company Information');

  for (const statement of STATEMENT_ORDER) {
    XLSX.utils.book_append_sheet(
      workbook,
      sheetForStatement(statement.key, statement.label, years),
      statement.label.slice(0, 31),
    );
  }

  const segment = XLSX.utils.aoa_to_sheet([
    ['Segment Data (optional)'],
    ['Segment-level revenue and profit are not yet used by the analysis engine, but the sheet is read and preserved on import.'],
    [],
    ['Segment', 'Measure', ...years],
    ['', 'Revenue', ...years.map(() => null)],
    ['', 'EBIT', ...years.map(() => null)],
  ]);
  segment['!cols'] = [{ wch: 28 }, { wch: 18 }, ...years.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(workbook, segment, 'Segment Data');

  return workbook;
}

export function templateBuffer(years?: string[]): Buffer {
  return XLSX.write(buildTemplateWorkbook(years), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
