import * as XLSX from 'xlsx';
import {
  LINE_ITEMS,
  METRIC_GROUP_LABELS,
  STATEMENT_ORDER,
  formatMetric,
  unitsLabel,
  type AnalysisResult,
  type MetricGroup,
} from '@fca/core';

/**
 * Export the normalized data and the calculated analysis.
 *
 * Exports keep the raw/calculated distinction visible: the statement sheets mark every value as
 * Entered or Calculated, and metrics carry their formula and status so a reader of the file can
 * see how each figure was produced and which ones were unavailable.
 */

function statementSheet(result: AnalysisResult, statement: (typeof STATEMENT_ORDER)[number]): XLSX.WorkSheet {
  const periods = result.statements;
  const rows: (string | number | null)[][] = [];

  rows.push([statement.label]);
  rows.push([`${result.company.name} — ${unitsLabel(result.company.currency, result.company.units)}`]);
  rows.push([]);
  rows.push(['Line item', ...periods.map((p) => p.label), 'Source (latest period)']);

  let section = '';
  for (const item of LINE_ITEMS.filter((i) => i.statement === statement.key)) {
    const values = periods.map((p) => (typeof p.values[item.key] === 'number' ? (p.values[item.key] as number) : null));
    if (values.every((v) => v === null)) continue;

    if (item.section !== section) {
      section = item.section;
      rows.push([section.toUpperCase()]);
    }

    const latest = periods[periods.length - 1];
    const source = latest && typeof latest.values[item.key] === 'number'
      ? latest.sources[item.key] === 'calculated' ? 'Calculated' : 'Entered'
      : 'Not available';

    rows.push([item.label, ...values, source]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 44 }, ...periods.map(() => ({ wch: 14 })), { wch: 20 }];
  return sheet;
}

function metricsSheet(result: AnalysisResult): XLSX.WorkSheet {
  const periods = result.periods.map((p) => p.label);
  const rows: (string | number | null)[][] = [];

  rows.push(['Calculated Metrics']);
  rows.push(['Values are calculated by the analysis engine from the data on the statement sheets. "n/a" means the metric could not be calculated, not zero.']);
  rows.push([]);
  rows.push(['Group', 'Metric', 'Unit', ...periods, 'Trend', 'Formula', 'Note']);

  const groups = Object.keys(result.metricsByGroup) as MetricGroup[];
  for (const group of groups) {
    for (const series of result.metricsByGroup[group]) {
      const values = periods.map((label) => {
        const point = series.points.find((p) => p.period === label);
        return point && point.status === 'ok' && point.value !== null ? point.value : null;
      });
      if (values.every((v) => v === null)) continue;
      rows.push([
        METRIC_GROUP_LABELS[group],
        series.label,
        series.unit,
        ...values,
        series.trend,
        series.formula,
        series.latest?.note ?? '',
      ]);
    }
  }

  rows.push([]);
  rows.push(['Compound growth rates']);
  rows.push(['Measure', 'Value (%)', 'Status', 'Note']);
  for (const item of result.cagr) {
    rows.push([item.label, item.status === 'ok' ? item.value : null, item.status, item.note ?? '']);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 10 }, ...periods.map(() => ({ wch: 14 })), { wch: 16 }, { wch: 60 }, { wch: 50 }];
  return sheet;
}

function analysisSheet(result: AnalysisResult): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [];

  rows.push(['Analysis Summary']);
  rows.push([result.executiveSummary.headline]);
  rows.push([]);
  rows.push(['Overall assessment']);
  rows.push([result.executiveSummary.overallAssessment]);
  rows.push([]);

  rows.push(['Financial health']);
  rows.push(['Pillar', 'Score (0-100)', 'Assessment', 'Coverage']);
  rows.push(['Overall', result.health.overall, result.health.label, '']);
  for (const pillar of result.health.pillars) {
    rows.push([pillar.label, pillar.score, pillar.label_, `${Math.round(pillar.coverage * 100)}%`]);
  }
  rows.push([]);

  rows.push(['Red flags']);
  rows.push(['Severity', 'Title', 'Detail', 'Period']);
  if (result.redFlags.length === 0) rows.push(['', 'No rule in the risk engine was triggered by this data.', '', '']);
  for (const flag of result.redFlags) rows.push([flag.severity, flag.title, flag.detail, flag.period]);
  rows.push([]);

  rows.push(['Positive signals']);
  rows.push(['Title', 'Detail', 'Period']);
  if (result.positiveSignals.length === 0) rows.push(['No positive-signal rule was triggered by this data.', '', '']);
  for (const signal of result.positiveSignals) rows.push([signal.title, signal.detail, signal.period]);
  rows.push([]);

  rows.push(['Key insights']);
  rows.push(['Title', 'Narrative', 'Assessment']);
  for (const insight of result.insights) rows.push([insight.title, insight.narrative, insight.sentiment]);
  rows.push([]);

  rows.push(['Data quality']);
  rows.push(['Status', 'Check', 'Detail']);
  for (const check of result.dataQuality.checks) rows.push([check.status, check.label, check.detail]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 22 }, { wch: 46 }, { wch: 110 }, { wch: 14 }];
  return sheet;
}

export function buildExportWorkbook(result: AnalysisResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const cover = XLSX.utils.aoa_to_sheet([
    ['Financial Company Analyzer — Export'],
    [],
    ['Company', result.company.name],
    ['Industry', result.company.industry],
    ['Currency', result.company.currency],
    ['Units', unitsLabel(result.company.currency, result.company.units)],
    ['Periods', result.periods.map((p) => p.label).join(', ')],
    ['Latest period', result.latestPeriod ?? 'n/a'],
    ['Generated', result.generatedAt],
    ['Engine version', result.engineVersion],
    ...(result.company.isSample ? [[], ['NOTE', 'This export is based on fictional sample data supplied with the application. It does not describe a real company.']] : []),
    [],
    ['This workbook contains the normalized raw data (marked Entered or Calculated), the metrics derived from it, and the written analysis.'],
  ]);
  cover['!cols'] = [{ wch: 22 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, cover, 'Overview');

  for (const statement of STATEMENT_ORDER) {
    XLSX.utils.book_append_sheet(workbook, statementSheet(result, statement), statement.label.slice(0, 31));
  }
  XLSX.utils.book_append_sheet(workbook, metricsSheet(result), 'Metrics');
  XLSX.utils.book_append_sheet(workbook, analysisSheet(result), 'Analysis');

  if (result.peerComparison.some((r) => r.peerValues.length > 0)) {
    const rows: (string | number | null)[][] = [['Peer Comparison'], [], ['Metric', 'Company', 'Peer average', 'Best peer', 'Worst peer', 'Note']];
    for (const row of result.peerComparison) {
      rows.push([
        row.label,
        row.company,
        row.peerAverage,
        row.bestPeer ? `${row.bestPeer.name}: ${formatMetric(row.bestPeer.value, row.unit)}` : '',
        row.worstPeer ? `${row.worstPeer.name}: ${formatMetric(row.worstPeer.value, row.unit)}` : '',
        row.note ?? '',
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Peer Comparison');
  }

  return workbook;
}

export function exportWorkbookBuffer(result: AnalysisResult): Buffer {
  return XLSX.write(buildExportWorkbook(result), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Escape a CSV field, guarding against spreadsheet formula injection on open. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A leading =, +, - or @ would be evaluated as a formula by Excel; prefix it so it stays text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function exportStatementsCsv(result: AnalysisResult): string {
  const periods = result.statements;
  const rows: unknown[][] = [
    [`${result.company.name} — financial data`, ...periods.map(() => '')],
    [`Units: ${unitsLabel(result.company.currency, result.company.units)}`],
    [],
    ['Statement', 'Line item', ...periods.map((p) => p.label), 'Source (latest)'],
  ];

  for (const statement of STATEMENT_ORDER) {
    for (const item of LINE_ITEMS.filter((i) => i.statement === statement.key)) {
      const values = periods.map((p) => (typeof p.values[item.key] === 'number' ? p.values[item.key] : ''));
      if (values.every((v) => v === '')) continue;
      const latest = periods[periods.length - 1];
      const source = latest && typeof latest.values[item.key] === 'number'
        ? latest.sources[item.key] === 'calculated' ? 'Calculated' : 'Entered'
        : 'Not available';
      rows.push([statement.label, item.label, ...values, source]);
    }
  }
  return toCsv(rows);
}

export function exportMetricsCsv(result: AnalysisResult): string {
  const periods = result.periods.map((p) => p.label);
  const rows: unknown[][] = [
    [`${result.company.name} — calculated metrics`],
    ['Blank cells mean the metric could not be calculated for that period, not zero.'],
    [],
    ['Group', 'Metric', 'Unit', ...periods, 'Trend', 'Formula'],
  ];

  for (const group of Object.keys(result.metricsByGroup) as MetricGroup[]) {
    for (const series of result.metricsByGroup[group]) {
      const values = periods.map((label) => {
        const point = series.points.find((p) => p.period === label);
        return point && point.status === 'ok' && point.value !== null ? point.value : '';
      });
      if (values.every((v) => v === '')) continue;
      rows.push([METRIC_GROUP_LABELS[group], series.label, series.unit, ...values, series.trend, series.formula]);
    }
  }
  return toCsv(rows);
}
