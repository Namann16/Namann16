import { useWorkspace } from '../state/WorkspaceContext';
import { Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { FinancialChart } from '../components/charts/Charts';
import { AnalysisSection, FlagCard, KpiCard, usableSeries } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx, formatCurrency, formatMetric } from '../lib/display';

export default function WorkingCapital() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const { metrics, company } = analysis;
  const ctx = fmtCtx(company);

  const cycle = combineSeries([
    { key: 'dso', series: metrics['dso'] },
    { key: 'dio', series: metrics['dio'] },
    { key: 'dpo', series: metrics['dpo'] },
    { key: 'ccc', series: metrics['cashConversionCycle'] },
  ]);

  const balances = combineSeries([
    { key: 'receivables', series: metrics['receivablesGrowth'] },
    { key: 'inventory', series: metrics['inventoryGrowth'] },
    { key: 'revenue', series: metrics['revenueGrowth'] },
  ]);

  const intensity = combineSeries([
    { key: 'workingCapital', series: metrics['workingCapital'] },
    { key: 'intensity', series: metrics['workingCapitalToRevenue'] },
  ]);

  const flags = [...analysis.redFlags, ...analysis.positiveSignals].filter((f) => f.category === 'workingCapital');
  const insights = analysis.insights.filter((i) => i.category === 'workingCapital');
  const wcSeries = usableSeries(analysis, 'workingCapital');
  const efficiencySeries = usableSeries(analysis, 'efficiency');

  if (wcSeries.length === 0 && efficiencySeries.length === 0) {
    return (
      <>
        <PageHeader title="Working Capital" />
        <EmptyState
          title="No working-capital analysis is available"
          message="Receivables, inventory, payables, revenue and cost of goods sold are needed to measure the working-capital cycle. Add those line items on the Data Input screen to unlock this section."
        />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Working Capital"
        description="Working capital is the cash tied up in running the business day to day. A cycle that lengthens as a company grows quietly consumes the cash that profit appears to generate, which is why the balances are compared against revenue rather than read on their own."
      />

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="DSO" series={metrics['dso']} company={company} />
        <KpiCard label="DIO" series={metrics['dio']} company={company} />
        <KpiCard label="DPO" series={metrics['dpo']} company={company} />
        <KpiCard label="Cash conversion cycle" series={metrics['cashConversionCycle']} company={company} emphasise />
        <KpiCard label="Working capital" series={metrics['workingCapital']} company={company} />
        <KpiCard label="WC / revenue" series={metrics['workingCapitalToRevenue']} company={company} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Cash conversion cycle" description="Days of receivables plus days of inventory, less days of payables. A shorter cycle releases cash.">
          <FinancialChart
            data={cycle}
            unit="days"
            ctx={ctx}
            series={[
              { key: 'dso', label: 'DSO', type: 'line' },
              { key: 'dio', label: 'DIO', type: 'line' },
              { key: 'dpo', label: 'DPO', type: 'line' },
              { key: 'ccc', label: 'Cash conversion cycle', type: 'line' },
            ]}
          />
        </Card>

        <Card
          title="Working-capital growth versus revenue growth"
          description={`A gap above ${analysis.thresholds.receivablesVsRevenueGapPp} percentage points triggers a flag, on the configured threshold.`}
        >
          <FinancialChart
            data={balances}
            unit="percent"
            ctx={ctx}
            series={[
              { key: 'revenue', label: 'Revenue growth', type: 'bar' },
              { key: 'receivables', label: 'Receivables growth', type: 'bar' },
              { key: 'inventory', label: 'Inventory growth', type: 'bar' },
            ]}
          />
        </Card>

        <Card title="Working-capital intensity" description="Absolute working capital, and how much of each unit of revenue it absorbs." className="xl:col-span-2">
          <FinancialChart
            data={intensity}
            unit="currency"
            rightUnit="percent"
            ctx={ctx}
            height={240}
            series={[
              { key: 'workingCapital', label: 'Working capital', type: 'bar' },
              { key: 'intensity', label: 'Working capital / revenue', type: 'line', unit: 'percent', axis: 'right' },
            ]}
          />
        </Card>
      </div>

      <AnalysisSection
        title="Working-capital cycle"
        description="Days measures use average balances where a prior period is available; each metric states the basis it used."
        series={wcSeries}
        company={company}
      />

      <AnalysisSection
        title="Operating efficiency"
        description="Turnover measures: how many times each balance is cycled through the business in a year."
        series={efficiencySeries}
        company={company}
        insights={insights}
      />

      {flags.length > 0 && (
        <Card title="Working-capital findings" description="Raised by the rule engine from the data above.">
          <div className="grid gap-3 lg:grid-cols-2">
            {flags.map((flag) => <FlagCard key={flag.id} flag={flag} />)}
          </div>
        </Card>
      )}

      <Card title="Balances behind the cycle" description="The raw receivables, inventory and payables positions the days measures are calculated from.">
        <div className="overflow-x-auto">
          <table className="fin-table">
            <thead>
              <tr>
                <th className="text-left">Line item</th>
                {analysis.statements.map((p) => <th key={p.label}>{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ['accountsReceivable', 'Accounts receivable'],
                ['inventory', 'Inventory'],
                ['accountsPayable', 'Accounts payable'],
                ['revenue', 'Revenue'],
                ['cogs', 'Cost of goods sold'],
              ] as const).map(([key, label]) => (
                <tr key={key}>
                  <th>{label}</th>
                  {analysis.statements.map((period) => {
                    const value = period.values[key];
                    return (
                      <td key={period.label} className="tnum">
                        {typeof value === 'number' ? formatCurrency(value, ctx) : <span className="text-ink-400">n/a</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="row-total">
                <th>Cash conversion cycle</th>
                {analysis.statements.map((period) => {
                  const point = metrics['cashConversionCycle']?.points.find((p) => p.period === period.label);
                  return (
                    <td key={period.label} className="tnum">
                      {point?.status === 'ok' ? formatMetric(point.value, 'days', ctx) : <span className="text-ink-400">n/a</span>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
