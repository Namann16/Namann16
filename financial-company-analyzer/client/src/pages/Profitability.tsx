import { useWorkspace } from '../state/WorkspaceContext';
import { Card, PageHeader } from '../components/ui/primitives';
import { FinancialChart } from '../components/charts/Charts';
import { AnalysisSection, KpiCard, usableSeries } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx } from '../lib/display';

export default function Profitability() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const { metrics, company } = analysis;
  const ctx = fmtCtx(company);

  const margins = combineSeries([
    { key: 'gross', series: metrics['grossMargin'] },
    { key: 'ebitda', series: metrics['ebitdaMargin'] },
    { key: 'ebit', series: metrics['ebitMargin'] },
    { key: 'net', series: metrics['netMargin'] },
  ]);

  const profits = combineSeries([
    { key: 'revenue', series: metrics['revenue'] },
    { key: 'ebitda', series: metrics['ebitdaValue'] },
    { key: 'ebit', series: metrics['ebitValue'] },
    { key: 'netIncome', series: metrics['netIncomeValue'] },
  ]);

  const returns = combineSeries([
    { key: 'roe', series: metrics['roe'] },
    { key: 'roic', series: metrics['roic'] },
    { key: 'roa', series: metrics['roa'] },
    { key: 'roce', series: metrics['roce'] },
  ]);

  const insights = analysis.insights.filter((i) => i.category === 'profitability' || i.category === 'returns');

  return (
    <div className="stagger space-y-5">
      <PageHeader
        title="Profitability"
        description="Margins measure how much of each unit of revenue survives at each level of the income statement. Returns measure what the capital tied up in the business earns. Read them together: a high margin on a very large asset base can still be a poor return."
      />

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Gross margin" series={metrics['grossMargin']} company={company} />
        <KpiCard label="EBITDA margin" series={metrics['ebitdaMargin']} company={company} emphasise />
        <KpiCard label="EBIT margin" series={metrics['ebitMargin']} company={company} />
        <KpiCard label="Net margin" series={metrics['netMargin']} company={company} />
        <KpiCard label="ROE" series={metrics['roe']} company={company} />
        <KpiCard label="ROIC" series={metrics['roic']} company={company} emphasise />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Margin structure" description="Each margin level across the analysis period. Widening gaps between levels show where costs are growing.">
          <FinancialChart
            data={margins}
            unit="percent"
            ctx={ctx}
            series={[
              { key: 'gross', label: 'Gross margin', type: 'line' },
              { key: 'ebitda', label: 'EBITDA margin', type: 'line' },
              { key: 'ebit', label: 'EBIT margin', type: 'line' },
              { key: 'net', label: 'Net margin', type: 'line' },
            ]}
          />
        </Card>

        <Card title="Absolute profit" description="Revenue against profit at each level, in reporting currency.">
          <FinancialChart
            data={profits}
            unit="currency"
            ctx={ctx}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'bar' },
              { key: 'ebitda', label: 'EBITDA', type: 'bar' },
              { key: 'ebit', label: 'EBIT', type: 'bar' },
              { key: 'netIncome', label: 'Net income', type: 'bar' },
            ]}
          />
        </Card>

        <Card
          title="Returns on capital"
          description={`Measured against the ${analysis.thresholds.roicHurdle}% cost-of-capital hurdle configured in Settings. The hurdle is an assumption, not a measured figure.`}
          className="xl:col-span-2"
        >
          <FinancialChart
            data={returns}
            unit="percent"
            ctx={ctx}
            height={260}
            series={[
              { key: 'roe', label: 'ROE', type: 'line' },
              { key: 'roic', label: 'ROIC', type: 'line' },
              { key: 'roa', label: 'ROA', type: 'line' },
              { key: 'roce', label: 'ROCE', type: 'line' },
            ]}
            reference={{ value: analysis.thresholds.roicHurdle, label: `Hurdle ${analysis.thresholds.roicHurdle}%` }}
          />
        </Card>
      </div>

      <AnalysisSection
        title="Profitability metrics"
        description="Current value, prior year, change, multi-year trend and what each measure means."
        series={usableSeries(analysis, 'profitability')}
        company={company}
      />

      <AnalysisSection
        title="Returns on capital"
        description="Returns are calculated on average balance-sheet values where a prior period is available; each metric records which basis it used."
        series={usableSeries(analysis, 'returns')}
        company={company}
        insights={insights}
      />
    </div>
  );
}
