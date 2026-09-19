import { useWorkspace } from '../state/WorkspaceContext';
import { Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { ChartPair, FinancialChart } from '../components/charts/Charts';
import { AnalysisSection, FlagCard, KpiCard, usableSeries } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx, formatCurrency } from '../lib/display';

export default function CashFlow() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const { metrics, company } = analysis;
  const ctx = fmtCtx(company);
  const series = usableSeries(analysis, 'cashFlow');

  const hasCashFlow = metrics['cfo']?.points.some((p) => p.status === 'ok');

  if (!hasCashFlow) {
    return (
      <>
        <PageHeader title="Cash Flow Analysis" />
        <EmptyState
          title="No cash flow data has been entered yet"
          message="Add CFO, CFI and CFF — or the operating components the engine can derive CFO from — to unlock cash-flow analysis, free cash flow and the earnings-quality checks."
          action={<a className="btn-primary" href="/data">Go to Data Input</a>}
        />
      </>
    );
  }

  const flows = combineSeries([
    { key: 'cfo', series: metrics['cfo'] },
    { key: 'cfi', series: metrics['cfi'] },
    { key: 'cff', series: metrics['cff'] },
    { key: 'netChange', series: metrics['netChangeInCash'] },
  ]);

  const freeCashFlow = combineSeries([
    { key: 'cfo', series: metrics['cfo'] },
    { key: 'fcf', series: metrics['fcf'] },
    { key: 'fcfMargin', series: metrics['fcfMargin'] },
  ]);

  const quality = combineSeries([
    { key: 'netIncome', series: metrics['netIncomeValue'] },
    { key: 'cfo', series: metrics['cfo'] },
    { key: 'ebitda', series: metrics['ebitdaValue'] },
    { key: 'conversion', series: metrics['cfoToNetIncome'] },
  ]);

  const flags = [...analysis.redFlags, ...analysis.positiveSignals].filter((f) => f.category === 'cashFlow');
  const insights = analysis.insights.filter((i) => i.category === 'cashFlow');

  const fcfSeries = metrics['fcf'];
  const latestFcf = fcfSeries?.latest;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash Flow Analysis"
        description="Profit is an opinion shaped by accounting policy; cash is a fact. This section tests whether reported earnings are arriving as cash, what the business is spending to sustain itself, and what is genuinely left over."
      />

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="CFO" series={metrics['cfo']} company={company} emphasise />
        <KpiCard label="Free cash flow" series={metrics['fcf']} company={company} emphasise />
        <KpiCard label="CFO margin" series={metrics['cfoMargin']} company={company} />
        <KpiCard label="FCF margin" series={metrics['fcfMargin']} company={company} />
        <KpiCard label="CFO / net income" series={metrics['cfoToNetIncome']} company={company} />
        <KpiCard label="Capex / CFO" series={metrics['capexToCfo']} company={company} />
      </section>

      <Card title="Free cash flow" description="The formula, shown explicitly, with the inputs for the latest period.">
        <div className="flex flex-wrap items-center gap-6">
          <div className="rounded-xl bg-accent-600/[0.10] px-4 py-3 dark:bg-accent-500/[0.16]">
            <p className="font-mono text-[13px] font-semibold text-accent-800 dark:text-accent-100">
              FCF = CFO − Capital Expenditure
            </p>
            {latestFcf?.status === 'ok' && (
              <p className="mt-1.5 font-mono text-[12.5px] text-accent-700 dark:text-accent-200">
                {formatCurrency(latestFcf.inputs['cfo'] ?? null, ctx)} − {formatCurrency(
                  typeof latestFcf.inputs['capex'] === 'number' ? Math.abs(latestFcf.inputs['capex']) : null, ctx,
                )} = <strong>{formatCurrency(latestFcf.value, ctx)}</strong>
                <span className="ml-1 text-2xs">({latestFcf.period})</span>
              </p>
            )}
          </div>
          <p className="max-w-lg text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
            Free cash flow is what remains after the business has paid to maintain and expand its asset base. It is the cash
            genuinely available to repay lenders, pay dividends or fund acquisitions. Sustained negative free cash flow has to be
            funded from somewhere — existing balances, new debt or new equity.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cash flow by activity" description="Operating, investing and financing flows, and the net movement in cash.">
          <FinancialChart
            data={flows}
            unit="currency"
            ctx={ctx}
            series={[
              { key: 'cfo', label: 'CFO', type: 'bar', slot: 0 },
              { key: 'cfi', label: 'CFI', type: 'bar', slot: 1 },
              { key: 'cff', label: 'CFF', type: 'bar', slot: 2 },
              { key: 'netChange', label: 'Net change in cash', type: 'line', slot: 3 },
            ]}
          />
        </Card>

        <Card title="Free cash flow" description="Operating cash before and after capital expenditure, and the share of revenue it represents.">
          <ChartPair
            ctx={ctx}
            primary={{
              caption: 'CFO and free cash flow',
              data: freeCashFlow,
              unit: 'currency',
              series: [
                { key: 'cfo', label: 'CFO', type: 'bar', slot: 0 },
                { key: 'fcf', label: 'Free cash flow', type: 'bar', slot: 1 },
              ],
            }}
            secondary={{
              caption: 'FCF margin',
              data: freeCashFlow,
              unit: 'percent',
              series: [{ key: 'fcfMargin', label: 'FCF margin', type: 'line', slot: 2 }],
            }}
          />
        </Card>

        <Card
          title="Earnings quality: profit versus cash"
          description="A persistent gap between profit and operating cash is the single most useful earnings-quality signal. The conversion ratio below restates the same relationship; 1.0x means profit arrived in full as cash."
          className="xl:col-span-2"
        >
          <ChartPair
            ctx={ctx}
            height={200}
            primary={{
              caption: 'Net income, EBITDA and CFO',
              data: quality,
              unit: 'currency',
              series: [
                { key: 'netIncome', label: 'Net income', type: 'bar', slot: 0 },
                { key: 'ebitda', label: 'EBITDA', type: 'bar', slot: 1 },
                { key: 'cfo', label: 'CFO', type: 'bar', slot: 2 },
              ],
            }}
            secondary={{
              caption: 'CFO / net income',
              data: quality,
              unit: 'times',
              series: [{ key: 'conversion', label: 'CFO / net income', type: 'line', slot: 3 }],
              reference: { value: 1, label: '1.0x — profit fully converted' },
            }}
          />
        </Card>
      </div>

      <AnalysisSection
        title="Cash flow metrics"
        description="Conversion, margin and capital-intensity measures derived from the cash flow statement."
        series={series}
        company={company}
        insights={insights}
      />

      {flags.length > 0 && (
        <Card title="Cash flow findings" description="Raised by the rule engine from the figures above.">
          <div className="grid gap-3 lg:grid-cols-2">
            {flags.map((flag) => <FlagCard key={flag.id} flag={flag} />)}
          </div>
        </Card>
      )}

      <Card title="Cash reconciliation" description="Whether the cash flow statement agrees with the movement in balance-sheet cash.">
        <ul className="space-y-2">
          {analysis.dataQuality.checks
            .filter((c) => c.id.startsWith('cashflow.'))
            .map((check) => (
              <li key={check.id} className="flex gap-2 text-[12.5px] leading-relaxed">
                <span
                  className={
                    check.status === 'pass' ? 'text-positive-600' : check.status === 'warn' ? 'text-caution-600' : 'text-ink-400'
                  }
                  aria-hidden="true"
                >
                  {check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '·'}
                </span>
                <span className="text-ink-700 dark:text-ink-300">
                  <strong className="font-medium">{check.period ?? ''}</strong> {check.detail}
                </span>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
