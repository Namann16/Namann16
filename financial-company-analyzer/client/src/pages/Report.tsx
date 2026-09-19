import { useWorkspace } from '../state/WorkspaceContext';
import { api } from '../api/client';
import { Badge, Card, PageHeader } from '../components/ui/primitives';
import { fmtCtx, formatCurrency, formatMetric, SENTIMENT_TONE } from '../lib/display';

const REPORT_SECTIONS = [
  'Company overview',
  'Executive summary',
  'Financial statements, marked entered or calculated',
  'Growth analysis and compound growth rates',
  'Profitability analysis',
  'Liquidity',
  'Solvency and leverage',
  'Working capital',
  'Cash flow',
  'DuPont analysis with ROE attribution',
  'Red flags and positive signals, each with its evidence',
  'Key insights',
  'Overall assessment and health breakdown',
  'Data quality',
];

export default function Report() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const ctx = fmtCtx(current.company);
  const { executiveSummary, metrics, health } = analysis;

  const headline = [
    { label: 'Revenue', series: metrics['revenue'] },
    { label: 'EBITDA margin', series: metrics['ebitdaMargin'] },
    { label: 'Net margin', series: metrics['netMargin'] },
    { label: 'ROE', series: metrics['roe'] },
    { label: 'ROIC', series: metrics['roic'] },
    { label: 'Net debt / EBITDA', series: metrics['netDebtToEbitda'] },
    { label: 'Free cash flow', series: metrics['fcf'] },
  ];

  return (
    <div className="stagger space-y-5">
      <PageHeader
        title="Report"
        description="Export the analysis for circulation. The PDF report opens in a new tab formatted for print — use your browser's print dialog and choose “Save as PDF”. Producing it this way keeps the text selectable and searchable rather than rasterised."
        actions={
          <>
            <a className="btn-primary" href={api.urls.report(current.id)} target="_blank" rel="noreferrer">
              Open PDF report
            </a>
            <a className="btn-secondary" href={api.urls.excel(current.id)} download>Excel</a>
            <a className="btn-secondary" href={api.urls.csv(current.id, 'statements')} download>CSV</a>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="PDF report" description="Print-ready, 14 sections.">
          <p className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
            A full analyst-style report covering the statements, every ratio group, the DuPont decomposition, all findings with
            the calculations behind them, and the data-quality register.
          </p>
          <a className="btn-primary mt-3" href={api.urls.report(current.id)} target="_blank" rel="noreferrer">
            Open report
          </a>
          <ul className="mt-3 space-y-0.5">
            {REPORT_SECTIONS.map((section, i) => (
              <li key={section} className="text-2xs text-ink-500 dark:text-ink-400">{i + 1}. {section}</li>
            ))}
          </ul>
        </Card>

        <Card title="Excel export" description="Data and analysis in one workbook.">
          <p className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
            Contains the normalized statements with each value marked Entered or Calculated, every metric with its formula and
            trend, the compound growth rates, the written analysis, and the data-quality register.
          </p>
          <a className="btn-secondary mt-3" href={api.urls.excel(current.id)} download>Download workbook</a>
          <p className="mt-3 text-2xs text-ink-500 dark:text-ink-400">
            Sheets: Overview · Income Statement · Balance Sheet · Cash Flow Statement · Share Data · Metrics · Analysis
            {analysis.peerComparison.some((r) => r.peerValues.length > 0) ? ' · Peer Comparison' : ''}
          </p>
        </Card>

        <Card title="CSV export" description="For onward analysis in another tool.">
          <p className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
            Flat files suitable for loading elsewhere. Cells that could not be calculated are left empty rather than written as
            zero, so a downstream tool cannot mistake missing data for a real value.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="btn-secondary" href={api.urls.csv(current.id, 'statements')} download>Financial data</a>
            <a className="btn-secondary" href={api.urls.csv(current.id, 'metrics')} download>Calculated metrics</a>
          </div>
        </Card>
      </div>

      <Card title="Report preview" description="What the executive summary section of the report will contain.">
        {current.company.isSample && (
          <div className="mb-3 rounded-xl border-l-[3px] border-caution-500 bg-caution-500/[0.10] px-3 py-2 text-callout dark:bg-caution-400/[0.14]">
            <strong>Fictional sample data.</strong> Apex Consumer Products Ltd. is not a real company. The exported report carries
            the same notice.
          </div>
        )}

        <p className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{executiveSummary.headline}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{executiveSummary.overallAssessment}</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
          {headline.map((item) => {
            const latest = item.series?.latest;
            const available = latest?.status === 'ok' && latest.value !== null;
            return (
              <div key={item.label} className="rounded-lg bg-ink-500/[0.06] px-2.5 py-1.5 dark:bg-ink-400/[0.08]">
                <p className="label-caps truncate">{item.label}</p>
                <p className={`tnum text-base font-semibold ${available ? '' : 'text-ink-400'}`}>
                  {available
                    ? item.series!.unit === 'currency'
                      ? formatCurrency(latest!.value, ctx)
                      : formatMetric(latest!.value, item.series!.unit, ctx)
                    : 'n/a'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="label-caps text-positive-700 dark:text-positive-500">Key strengths</p>
            {executiveSummary.strengths.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">None identified from the data supplied.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {executiveSummary.strengths.map((item) => (
                  <li key={item.id} className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
                    <strong className="font-medium">{item.title}.</strong> {item.narrative}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="label-caps text-negative-700 dark:text-negative-500">Key concerns</p>
            {executiveSummary.concerns.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">No rule in the risk engine was triggered by this data.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {executiveSummary.concerns.map((item) => (
                  <li key={item.id} className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
                    <strong className="font-medium">{item.title}.</strong> {item.narrative}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={health.overall !== null && health.overall >= 58 ? 'positive' : health.overall !== null && health.overall >= 44 ? 'caution' : 'negative'}>
            Health {health.overall ?? '—'}/100 · {health.label}
          </Badge>
          {executiveSummary.sections.map((section) => (
            <Badge key={section.key} tone={SENTIMENT_TONE[section.sentiment]}>{section.label}</Badge>
          ))}
        </div>
      </Card>

      <Card>
        <p className="text-2xs leading-relaxed text-ink-500 dark:text-ink-400">
          Generated {new Date(analysis.generatedAt).toLocaleString()} · engine version {analysis.engineVersion} ·
          {' '}{analysis.periods.length} periods · core data completeness {analysis.dataQuality.completeness}%.
          Exports are produced from the same analysis shown on screen, so a report can never disagree with the dashboard.
        </p>
      </Card>
    </div>
  );
}
