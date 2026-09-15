import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { FinancialChart } from '../components/charts/Charts';
import { AnalysisSection, EvidenceModal, KpiCard, usableSeries } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx, formatCurrency, formatMetric } from '../lib/display';
import { useState } from 'react';

export default function GrowthTrends() {
  const { analysis, current } = useWorkspace();
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  if (!analysis || !current) return null;

  const { metrics, company, cagr } = analysis;
  const ctx = fmtCtx(company);

  if (analysis.periods.length < 2) {
    return (
      <>
        <PageHeader title="Growth & Trends" />
        <EmptyState
          title="Growth cannot be calculated from a single period"
          message="At least two financial years are required to measure year-on-year growth, and three or more before a trend can be described with any confidence. Add another year on the Data Input screen."
          action={<a className="btn-primary" href="/data">Go to Data Input</a>}
        />
      </>
    );
  }

  const topLine = combineSeries([
    { key: 'revenue', series: metrics['revenue'] },
    { key: 'growth', series: metrics['revenueGrowth'] },
  ]);

  const growthRates = combineSeries([
    { key: 'revenue', series: metrics['revenueGrowth'] },
    { key: 'ebitda', series: metrics['ebitdaGrowth'] },
    { key: 'netIncome', series: metrics['netIncomeGrowth'] },
    { key: 'cfo', series: metrics['cfoGrowth'] },
  ]);

  const balanceGrowth = combineSeries([
    { key: 'assets', series: metrics['assetGrowth'] },
    { key: 'equity', series: metrics['equityGrowth'] },
    { key: 'debt', series: metrics['debtGrowth'] },
    { key: 'revenue', series: metrics['revenueGrowth'] },
  ]);

  const insights = analysis.insights.filter((i) => i.category === 'growth');
  const selected = cagr.find((c) => c.key === evidenceKey);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Growth & Trends"
        description="Year-on-year growth shows the most recent move; compound growth smooths the volatility to show the underlying rate. Comparing growth at different levels of the income statement is what reveals operating leverage — or its absence."
      />

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Revenue growth" series={metrics['revenueGrowth']} company={company} emphasise />
        <KpiCard label="EBITDA growth" series={metrics['ebitdaGrowth']} company={company} />
        <KpiCard label="EBIT growth" series={metrics['ebitGrowth']} company={company} />
        <KpiCard label="Net income growth" series={metrics['netIncomeGrowth']} company={company} />
        <KpiCard label="EPS growth" series={metrics['epsGrowth']} company={company} />
        <KpiCard label="FCF growth" series={metrics['fcfGrowth']} company={company} />
      </section>

      <Card
        title="Compound annual growth rates"
        description="Measured across the longest span where both endpoints are available and positive. A CAGR through a loss year has no real solution and is reported as unavailable rather than approximated."
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="fin-table">
            <thead>
              <tr>
                <th className="text-left">Measure</th>
                <th>CAGR</th>
                <th className="text-left">Period</th>
                <th className="text-left">Basis</th>
                <th className="text-center">Trace</th>
              </tr>
            </thead>
            <tbody>
              {cagr.map((item) => (
                <tr key={item.key}>
                  <th>{item.label}</th>
                  <td className={`tnum font-semibold ${item.status === 'ok' ? '' : 'text-ink-400'}`}>
                    {item.status === 'ok' ? formatMetric(item.value, 'percent') : 'n/a'}
                  </td>
                  <td className="text-left text-ink-600 dark:text-ink-300">{item.status === 'ok' ? item.period : '—'}</td>
                  <td className="max-w-lg whitespace-normal text-left text-[12px] leading-snug text-ink-600 dark:text-ink-400">
                    {item.note ?? item.formula}
                  </td>
                  <td className="text-center">
                    {item.status === 'ok' && (
                      <button
                        type="button"
                        className="text-2xs font-semibold text-accent-600 underline underline-offset-2 hover:text-accent-800"
                        onClick={() => setEvidenceKey(item.key)}
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Revenue trend" description="Absolute revenue with the year-on-year growth rate on the right axis.">
          <FinancialChart
            data={topLine}
            unit="currency"
            rightUnit="percent"
            ctx={ctx}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'bar' },
              { key: 'growth', label: 'Revenue growth', type: 'line', unit: 'percent', axis: 'right' },
            ]}
          />
        </Card>

        <Card title="Growth at each level" description="Where these diverge, the cost base is scaling differently from revenue.">
          <FinancialChart
            data={growthRates}
            unit="percent"
            ctx={ctx}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'line' },
              { key: 'ebitda', label: 'EBITDA', type: 'line' },
              { key: 'netIncome', label: 'Net income', type: 'line' },
              { key: 'cfo', label: 'CFO', type: 'line' },
            ]}
          />
        </Card>

        <Card
          title="Balance sheet growth against revenue"
          description={`Assets growing more than ${analysis.thresholds.assetsVsRevenueGapPp} percentage points faster than revenue triggers an asset-efficiency flag.`}
          className="xl:col-span-2"
        >
          <FinancialChart
            data={balanceGrowth}
            unit="percent"
            ctx={ctx}
            height={250}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'bar' },
              { key: 'assets', label: 'Total assets', type: 'bar' },
              { key: 'equity', label: 'Equity', type: 'bar' },
              { key: 'debt', label: 'Total debt', type: 'bar' },
            ]}
          />
        </Card>
      </div>

      <AnalysisSection
        title="Growth metrics"
        description="Growth is not reported off a zero or negative base, because the result would not be interpretable."
        series={usableSeries(analysis, 'growth')}
        company={company}
        insights={insights}
      />

      <EvidenceModal
        open={selected !== undefined}
        title={selected?.label ?? ''}
        evidence={
          selected
            ? {
                formula: selected.formula,
                lines: Object.entries(selected.inputs).map(([label, value]) => ({
                  label,
                  display: label === 'years' ? String(value) : formatCurrency(value, ctx),
                  value,
                })),
                conclusion:
                  selected.status === 'ok'
                    ? `${selected.label} = ${formatMetric(selected.value, 'percent')}.`
                    : selected.note,
              }
            : null
        }
        onClose={() => setEvidenceKey(null)}
      />

      {analysis.periods.length < 3 && (
        <Card>
          <p className="text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            <Badge tone="caution">Note</Badge>{' '}
            With only {analysis.periods.length} periods, trends are labelled as insufficient data rather than described as
            improving or deteriorating. Three or more years are needed before a direction can be distinguished from noise.
          </p>
        </Card>
      )}
    </div>
  );
}
