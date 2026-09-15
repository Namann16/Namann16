/**
 * Builds a deliberately awkward workbook to exercise the importer: non-template sheet names,
 * alternative terminology, mixed number formats, a different column order and extra rows.
 */
import * as XLSX from 'xlsx';

const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Company Name', 'Meridian Industrial Ltd.'],
  ['Industry', 'manufacturing'],
  ['Currency', 'INR'],
  ['Units', 'crores'],
  ['Financial Year End', '31 March'],
]), 'Company Information');

// Note: years deliberately out of order, mixed label formats, and a stray column.
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Statement of Profit and Loss'],
  [],
  ['Particulars', '2023-24', "Mar'25", 'FY 2026', 'Notes'],
  ['INCOME'],
  ['Revenue from Operations', '1,20,000', '₹1,38,500', '1,55,200', 'ref 3'],
  ['Other Income', '2,400', '2,900', '3,100', ''],
  ['EXPENSES'],
  ['Cost of Materials Consumed', '78,000', '89,400', '1,01,900', ''],
  ['Employee Benefit Expenses', '12,500', '14,100', '15,800', ''],
  ['Other Expenses', '9,800', '11,000', '12,600', ''],
  ['Finance Costs', '3,200', '3,050', '2,880', ''],
  ['Depreciation and Amortisation', '5,600', '6,100', '6,700', ''],
  ['Profit Before Tax', '13,300', '17,750', '18,420', ''],
  ['Tax Expense', '3,458', '4,615', '4,789', ''],
  ['Profit After Tax', '9,842', '13,135', '13,631', ''],
  ['Basic EPS', '19.68', '26.27', '27.26', ''],
  ['Some unrecognised line', '(500)', '-', 'n/a', ''],
]), 'P&L');

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Balance Sheet as at 31 March'],
  [],
  ['Particulars', '2023-24', "Mar'25", 'FY 2026'],
  ['ASSETS'],
  ['Cash and Bank Balances', '6,200', '7,100', '5,900'],
  ['Trade Receivables', '18,400', '21,300', '27,800'],
  ['Inventories', '22,100', '24,600', '28,900'],
  ['Other Current Assets', '4,300', '4,800', '5,200'],
  ['Net Fixed Assets', '62,000', '68,400', '76,100'],
  ['Goodwill', '3,000', '3,000', '3,000'],
  ['Total Assets', '1,16,000', '1,29,200', '1,46,900'],
  ['LIABILITIES'],
  ['Trade Payables', '16,800', '18,900', '21,400'],
  ['Short Term Borrowings', '8,000', '7,200', '9,500'],
  ['Other Current Liabilities', '7,400', '8,100', '9,000'],
  ['Long Term Borrowings', '28,000', '26,500', '25,200'],
  ['Deferred Tax Liabilities', '3,100', '3,300', '3,500'],
  ['EQUITY'],
  ['Equity Share Capital', '5,000', '5,000', '5,000'],
  ['Reserves and Surplus', '47,700', '60,200', '73,300'],
]), 'Balance Sheet');

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Cash Flow Statement'],
  [],
  ['Particulars', '2023-24', "Mar'25", 'FY 2026'],
  ['Net cash from operating activities', '14,200', '16,900', '12,400'],
  ['Purchase of Fixed Assets', '(11,000)', '(12,500)', '(14,400)'],
  ['Net cash used in investing activities', '(11,000)', '(12,500)', '(14,400)'],
  ['Proceeds from Borrowings', '1,200', '0', '2,300'],
  ['Repayment of Borrowings', '(2,700)', '(3,300)', '(1,100)'],
  ['Dividend Paid', '(1,800)', '(2,100)', '(2,400)'],
  ['Net cash used in financing activities', '(3,300)', '(5,400)', '(1,200)'],
]), 'Cash Flow');

XLSX.writeFile(wb, '/tmp/claude-0/messy-workbook.xlsx');
console.log('written /tmp/claude-0/messy-workbook.xlsx');
