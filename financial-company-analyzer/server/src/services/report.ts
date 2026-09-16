import {
  LINE_ITEMS,
  METRIC_GROUP_LABELS,
  STATEMENT_ORDER,
  formatChange,
  formatCurrency,
  formatMetric,
  trendLabel,
  unitsLabel,
  type AnalysisResult,
  type Evidence,
  type MetricGroup,
  type MetricSeries,
} from '@fca/core';

/**
 * Print-ready analysis report.
 *
 * The report is produced as self-contained HTML with a print stylesheet rather than a binary
 * PDF: the browser's own print-to-PDF renders fonts and tables correctly on every platform, the
 * output stays selectable and searchable, and the server needs no headless browser. The client
 * opens it and calls print(), which produces the PDF.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function evidenceTable(evidence: Evidence | undefined): string {
  if (!evidence || evidence.lines.length === 0) return '';
  return `
    <details class="evidence">
      <summary>View calculation</summary>
      ${evidence.formula ? `<p class="formula">${esc(evidence.formula)}</p>` : ''}
      <table class="evidence-table">
        <tbody>
          ${evidence.lines
            .map((line) => `<tr><th>${esc(line.label)}</th><td>${esc(line.display)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
      ${evidence.conclusion ? `<p class="conclusion">${esc(evidence.conclusion)}</p>` : ''}
    </details>`;
}

function statementTable(result: AnalysisResult, statement: (typeof STATEMENT_ORDER)[number]): string {
  const periods = result.statements;
  const ctx = { currency: result.company.currency, units: result.company.units };
  const items = LINE_ITEMS.filter((i) => i.statement === statement.key).filter((item) =>
    periods.some((p) => typeof p.values[item.key] === 'number'),
  );
  if (items.length === 0) {
    return `<h3>${esc(statement.label)}</h3><p class="empty">No ${statement.label.toLowerCase()} data has been entered.</p>`;
  }

  let section = '';
  const rows = items
    .map((item) => {
      let header = '';
      if (item.section !== section) {
        section = item.section;
        header = `<tr class="section"><td colspan="${periods.length + 1}">${esc(section)}</td></tr>`;
      }
      const cells = periods
        .map((p) => {
          const value = p.values[item.key];
          const derived = p.sources[item.key] === 'calculated';
          if (typeof value !== 'number') return '<td class="na">n/a</td>';
          return `<td class="${derived ? 'derived' : ''}">${esc(
            item.unit === 'per_share' ? formatMetric(value, 'per_share', ctx) : formatCurrency(value, ctx),
          )}</td>`;
        })
        .join('');
      return `${header}<tr><th>${esc(item.label)}</th>${cells}</tr>`;
    })
    .join('');

  return `
    <h3>${esc(statement.label)}</h3>
    <table class="statement">
      <thead><tr><th>Line item</th>${periods.map((p) => `<th>${esc(p.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legend"><span class="swatch derived-swatch"></span> Calculated by the engine &nbsp;•&nbsp; all other figures as entered &nbsp;•&nbsp; n/a = not available (not zero)</p>`;
}

function metricTable(result: AnalysisResult, group: MetricGroup): string {
  const series = result.metricsByGroup[group].filter((s) => s.points.some((p) => p.status === 'ok'));
  if (series.length === 0) {
    return `<p class="empty">No ${METRIC_GROUP_LABELS[group].toLowerCase()} metrics could be calculated from the data supplied.</p>`;
  }
  const ctx = { currency: result.company.currency, units: result.company.units };

  const rows = series
    .map((s: MetricSeries) => `
      <tr>
        <th>${esc(s.label)}</th>
        <td>${esc(formatMetric(s.latest?.value ?? null, s.unit, ctx))}</td>
        <td>${esc(formatMetric(s.previous?.value ?? null, s.unit, ctx))}</td>
        <td>${esc(formatChange(s.change, s.unit, ctx))}</td>
        <td>${esc(trendLabel(s.trend))}</td>
        <td class="formula-cell">${esc(s.formula)}</td>
      </tr>`)
    .join('');

  return `
    <table class="ratios">
      <thead>
        <tr><th>Metric</th><th>Latest</th><th>Prior</th><th>Change</th><th>Trend</th><th>Formula</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function buildReportHtml(result: AnalysisResult): string {
  const ctx = { currency: result.company.currency, units: result.company.units };
  const summary = result.executiveSummary;
  const generated = new Date(result.generatedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  const kpis: { label: string; value: string }[] = [
    { label: 'Revenue', value: formatCurrency(result.metrics['revenue']?.latest?.value ?? null, ctx) },
    { label: 'Revenue growth', value: formatMetric(result.metrics['revenueGrowth']?.latest?.value ?? null, 'percent') },
    { label: 'EBITDA margin', value: formatMetric(result.metrics['ebitdaMargin']?.latest?.value ?? null, 'percent') },
    { label: 'Net margin', value: formatMetric(result.metrics['netMargin']?.latest?.value ?? null, 'percent') },
    { label: 'ROE', value: formatMetric(result.metrics['roe']?.latest?.value ?? null, 'percent') },
    { label: 'ROIC', value: formatMetric(result.metrics['roic']?.latest?.value ?? null, 'percent') },
    { label: 'Net debt / EBITDA', value: formatMetric(result.metrics['netDebtToEbitda']?.latest?.value ?? null, 'times') },
    { label: 'Free cash flow', value: formatCurrency(result.metrics['fcf']?.latest?.value ?? null, ctx) },
  ];

  const duPontRows = result.duPont.periods
    .map((row) => `
      <tr>
        <th>${esc(row.period)}</th>
        <td>${esc(formatMetric(row.roe, 'percent'))}</td>
        <td>${esc(formatMetric(row.netMargin, 'percent'))}</td>
        <td>${esc(formatMetric(row.assetTurnover, 'times'))}</td>
        <td>${esc(formatMetric(row.equityMultiplier, 'times'))}</td>
        <td>${esc(formatMetric(row.reconstructedRoe, 'percent'))}</td>
      </tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(result.company.name)} — Financial Analysis</title>
<style>
  :root {
    --ink: #101828; --muted: #667085; --line: #e4e7ec; --bg: #ffffff;
    --accent: #14304f; --positive: #067647; --negative: #b42318; --warn: #b54708; --soft: #f9fafb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 10.5pt/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  }
  .page { max-width: 210mm; margin: 0 auto; padding: 18mm 16mm; }
  h1, h2, h3, h4 { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--accent); }
  h1 { font-size: 24pt; margin: 0 0 4px; letter-spacing: -0.4px; }
  h2 { font-size: 13pt; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); text-transform: uppercase; letter-spacing: 0.6px; }
  h3 { font-size: 11pt; margin: 18px 0 8px; }
  p { margin: 0 0 9px; }
  .subtitle { color: var(--muted); font-size: 10pt; margin-bottom: 2px; }
  .sample-note { margin: 12px 0; padding: 8px 12px; border-left: 3px solid var(--warn); background: #fffaeb; font-size: 9.5pt; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 6px; }
  .kpi { border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; background: var(--soft); }
  .kpi .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
  .kpi .value { font-size: 13pt; font-weight: 600; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9pt; }
  th, td { text-align: right; padding: 4px 7px; border-bottom: 1px solid var(--line); }
  thead th { text-align: right; background: var(--soft); font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
             font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); border-bottom: 1.5px solid var(--accent); }
  tbody th, thead th:first-child { text-align: left; font-weight: 500; }
  tr.section td { text-align: left; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 7.5pt;
                  text-transform: uppercase; letter-spacing: 0.7px; color: var(--muted); background: var(--soft); padding-top: 7px; }
  td.na { color: #98a2b3; }
  td.derived { color: var(--accent); font-style: italic; }
  .formula-cell { text-align: left; color: var(--muted); font-size: 8pt; max-width: 240px; }
  .legend { font-size: 8pt; color: var(--muted); margin-top: -4px; }
  .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; vertical-align: middle; }
  .derived-swatch { background: var(--accent); }
  ul { margin: 0 0 10px; padding-left: 18px; }
  li { margin-bottom: 6px; }
  .finding { border-left: 3px solid var(--line); padding: 2px 0 2px 11px; margin-bottom: 12px; }
  .finding.negative { border-color: var(--negative); }
  .finding.positive { border-color: var(--positive); }
  .finding.investigate { border-color: var(--warn); }
  .finding .title { font-weight: 600; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; }
  .finding .meta { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
  .evidence { margin-top: 6px; font-size: 8.5pt; }
  .evidence summary { cursor: pointer; color: var(--accent); font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 8pt; }
  .evidence-table { margin: 6px 0; }
  .evidence-table th { font-weight: 400; color: var(--muted); }
  .formula { font-size: 8.5pt; color: var(--muted); font-style: italic; }
  .conclusion { font-size: 8.5pt; font-weight: 600; }
  .health-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .pillar { border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; }
  .pillar .score { font-size: 15pt; font-weight: 600; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
  .pillar .name { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; font-size: 9.5pt; }
  .status-fail { color: var(--negative); font-weight: 600; }
  .status-warn { color: var(--warn); }
  .status-pass { color: var(--positive); }
  .status-skipped { color: var(--muted); }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--muted); }
  @media print {
    .page { padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    table, .finding, .kpi, .pillar { break-inside: avoid; }
    .evidence { display: block; }
    .evidence[open] summary { display: none; }
    details { open: true; }
    .no-print { display: none; }
  }
  .toolbar { position: sticky; top: 0; background: var(--accent); color: white; padding: 10px 16px;
             font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; display: flex;
             justify-content: space-between; align-items: center; }
  .toolbar button { font: inherit; background: white; color: var(--accent); border: 0; border-radius: 4px;
                    padding: 6px 14px; cursor: pointer; font-weight: 600; }
</style>
</head>
<body>
<div class="toolbar no-print">
  <span>Use your browser's print dialog and choose "Save as PDF" to export this report.</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="page">

  <header>
    <p class="subtitle">Financial Analysis Report</p>
    <h1>${esc(result.company.name)}</h1>
    <p class="subtitle">
      ${esc(result.company.sector ? `${result.company.sector} · ` : '')}${esc(result.company.industry)}
      · ${esc(unitsLabel(result.company.currency, result.company.units))}
      · Periods ${esc(result.periods.map((p) => p.label).join(', ') || 'none')}
      · Generated ${esc(generated)}
    </p>
  </header>

  ${result.company.isSample
    ? '<div class="sample-note"><strong>Fictional sample data.</strong> This report is based on the demonstration dataset supplied with the application. Apex Consumer Products Ltd. is not a real company and these figures do not describe any real business.</div>'
    : ''}

  <h2>1. Company Overview</h2>
  <table>
    <tbody>
      <tr><th>Industry</th><td style="text-align:left">${esc(result.company.industry)}</td><th>Currency</th><td style="text-align:left">${esc(result.company.currency)}</td></tr>
      <tr><th>Sector</th><td style="text-align:left">${esc(result.company.sector ?? 'n/a')}</td><th>Units</th><td style="text-align:left">${esc(result.company.units)}</td></tr>
      <tr><th>Country</th><td style="text-align:left">${esc(result.company.country ?? 'n/a')}</td><th>Financial year end</th><td style="text-align:left">${esc(result.company.fiscalYearEnd ?? 'n/a')}</td></tr>
      <tr><th>Ticker</th><td style="text-align:left">${esc(result.company.ticker ?? 'n/a')}</td><th>Latest period</th><td style="text-align:left">${esc(result.latestPeriod ?? 'n/a')}</td></tr>
    </tbody>
  </table>

  <div class="kpis">
    ${kpis.map((k) => `<div class="kpi"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div></div>`).join('')}
  </div>

  <h2>2. Executive Summary</h2>
  <p><strong>${esc(summary.headline)}</strong></p>
  <p>${esc(summary.overallAssessment)}</p>

  <h3>Key strengths</h3>
  ${summary.strengths.length
    ? summary.strengths.map((s) => `<div class="finding positive"><div class="title">${esc(s.title)}</div><p>${esc(s.narrative)}</p>${evidenceTable(s.evidence)}</div>`).join('')
    : '<p class="empty">No positive signal was identified from the data supplied.</p>'}

  <h3>Key concerns</h3>
  ${summary.concerns.length
    ? summary.concerns.map((s) => `<div class="finding ${esc(s.sentiment)}"><div class="title">${esc(s.title)}</div><p>${esc(s.narrative)}</p>${evidenceTable(s.evidence)}</div>`).join('')
    : '<p class="empty">No rule in the risk engine was triggered by the data supplied.</p>'}

  <h3>Most important takeaways</h3>
  ${summary.takeaways.length ? `<ul>${summary.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="empty">Insufficient data to draw takeaways.</p>'}

  <h2>3. Financial Statements</h2>
  ${STATEMENT_ORDER.map((s) => statementTable(result, s)).join('')}

  <h2>4. Growth Analysis</h2>
  ${metricTable(result, 'growth')}
  <h3>Compound growth rates</h3>
  <table>
    <thead><tr><th>Measure</th><th>Value</th><th style="text-align:left">Basis</th></tr></thead>
    <tbody>
      ${result.cagr
        .map((c) => `<tr><th>${esc(c.label)}</th><td>${esc(c.status === 'ok' ? formatMetric(c.value, 'percent') : 'n/a')}</td><td style="text-align:left;color:var(--muted);font-size:8pt">${esc(c.note ?? c.formula)}</td></tr>`)
        .join('')}
    </tbody>
  </table>

  <h2>5. Profitability Analysis</h2>
  ${metricTable(result, 'profitability')}
  ${metricTable(result, 'returns')}

  <h2>6. Liquidity</h2>
  ${metricTable(result, 'liquidity')}

  <h2>7. Solvency & Leverage</h2>
  ${metricTable(result, 'solvency')}

  <h2>8. Working Capital</h2>
  ${metricTable(result, 'workingCapital')}
  ${metricTable(result, 'efficiency')}

  <h2>9. Cash Flow</h2>
  ${metricTable(result, 'cashFlow')}

  <h2>10. DuPont Analysis</h2>
  <p>ROE is decomposed as Net Profit Margin × Asset Turnover × Equity Multiplier. The reconstructed column is the product of the three components and is shown alongside directly calculated ROE as a consistency check.</p>
  <table>
    <thead><tr><th>Period</th><th>ROE</th><th>Net margin</th><th>Asset turnover</th><th>Equity multiplier</th><th>Reconstructed ROE</th></tr></thead>
    <tbody>${duPontRows || '<tr><td colspan="6" class="empty">Insufficient data to decompose return on equity.</td></tr>'}</tbody>
  </table>
  ${result.duPont.attribution
    ? `<div class="finding"><div class="title">What is driving ROE</div><p>${esc(result.duPont.attribution.narrative)}</p>${evidenceTable(result.duPont.attribution.evidence)}</div>`
    : '<p class="empty">Insufficient data to attribute the change in ROE to its drivers. Two periods with complete margin, turnover and leverage data are required.</p>'}

  <h2>11. Red Flags</h2>
  ${result.redFlags.length
    ? result.redFlags.map((f) => `
        <div class="finding ${esc(f.sentiment === 'investigate' ? 'investigate' : 'negative')}">
          <div class="meta">${esc(f.severity)} · ${esc(f.rule)} · ${esc(f.period)}</div>
          <div class="title">${esc(f.title)}</div>
          <p>${esc(f.detail)}</p>
          ${evidenceTable(f.evidence)}
        </div>`).join('')
    : '<p class="empty">No rule in the risk engine was triggered by this data.</p>'}

  <h3>Positive signals</h3>
  ${result.positiveSignals.length
    ? result.positiveSignals.map((f) => `
        <div class="finding positive">
          <div class="meta">${esc(f.rule)} · ${esc(f.period)}</div>
          <div class="title">${esc(f.title)}</div>
          <p>${esc(f.detail)}</p>
          ${evidenceTable(f.evidence)}
        </div>`).join('')
    : '<p class="empty">No positive-signal rule was triggered by this data.</p>'}

  <h2>12. Key Insights</h2>
  ${result.insights.map((i) => `
    <div class="finding ${esc(i.sentiment)}">
      <div class="title">${esc(i.title)}</div>
      <p>${esc(i.narrative)}</p>
      ${evidenceTable(i.evidence)}
    </div>`).join('')}

  <h2>13. Overall Assessment</h2>
  <p>Overall financial health: <strong>${esc(result.health.label)}</strong>${result.health.overall !== null ? ` (${result.health.overall}/100)` : ''}.</p>
  <div class="health-grid">
    ${result.health.pillars
      .map((p) => `<div class="pillar"><div class="name">${esc(p.label)}</div><div class="score">${p.score ?? '—'}</div><div class="name">${esc(p.label_)} · ${Math.round(p.coverage * 100)}% covered</div></div>`)
      .join('')}
  </div>
  ${result.health.pillars
    .map((p) => `
      <h3>${esc(p.label)} — ${esc(p.label_)}${p.score !== null ? ` (${p.score}/100)` : ''}</h3>
      <ul>${p.factors.map((factor) => `<li><strong>${factor.direction === 'supports' ? '✓' : factor.direction === 'offsets' ? '⚠' : '·'} ${esc(factor.label)}:</strong> ${esc(factor.detail)}</li>`).join('')}</ul>`)
    .join('')}
  <p class="empty">${esc(result.health.methodology)}</p>

  <h2>14. Data Quality</h2>
  <table>
    <thead><tr><th style="text-align:left">Check</th><th style="text-align:left">Status</th><th style="text-align:left">Detail</th></tr></thead>
    <tbody>
      ${result.dataQuality.checks
        .map((c) => `<tr><th>${esc(c.label)}</th><td style="text-align:left" class="status-${esc(c.status)}">${esc(c.status)}</td><td style="text-align:left;font-size:8.5pt">${esc(c.detail)}</td></tr>`)
        .join('')}
    </tbody>
  </table>
  <p class="empty">Core data completeness: ${result.dataQuality.completeness}%. ${result.dataQuality.passed} checks passed, ${result.dataQuality.warnings} warnings, ${result.dataQuality.failures} failures, ${result.dataQuality.skipped} skipped for lack of data.</p>

  <footer>
    Generated by the Financial Company Analyzer, engine version ${esc(result.engineVersion)}, on ${esc(generated)}.
    All metrics were calculated deterministically from the data shown in section 3. Figures marked n/a could not be calculated and are not zero.
    Thresholds in force: net debt / EBITDA elevated above ${result.thresholds.netDebtToEbitdaHigh}x, interest coverage weak below ${result.thresholds.interestCoverageLow}x, ROIC hurdle ${result.thresholds.roicHurdle}%.
  </footer>
</div>
</body>
</html>`;
}
