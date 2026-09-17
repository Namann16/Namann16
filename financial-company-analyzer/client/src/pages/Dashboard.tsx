import { Link } from 'react-router-dom';
import { unitsLabel } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { ChartPair, FinancialChart } from '../components/charts/Charts';
import { FlagCard, KpiCard } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx, SENTIMENT_TONE } from '../lib/display';

const HEALTH_TONE: Record<string, 'positive' | 'negative' | 'neutral' | 'caution'> = {
  Excellent: 'positive', Strong: 'positive', Healthy: 'positive',
  Watch: 'caution', Concern: 'negative', Critical: 'negative', 'Not rated': 'neutral',
};

export default function Dashboard() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const { metrics, company, health, redFlags, positiveSignals, executiveSummary } = analysis;
  const ctx = fmtCtx(company);

  if (analysis.periods.length === 0) {
    return (
      <EmptyState
        title="No financial data has been entered yet"
        message="Add at least one financial year through the input grid or by importing a spreadsheet. Once revenue and a balance sheet are present the dashboard fills in automatically."
        action={<Link className="btn-primary" to="/data">Go to Data Input</Link>}
      />
    );
  }

  const revenueEbitda = combineSeries([
    { key: 'revenue', series: metrics['revenue'] },
    { key: 'ebitda', series: metrics['ebitdaValue'] },
    { key: 'margin', series: metrics['ebitdaMargin'] },
  ]);

  const margins = combineSeries([
    { key: 'gross', series: metrics['grossMargin'] },
    { key: 'ebitda', series: metrics['ebitdaMargin'] },
    { key: 'net', series: metrics['netMargin'] },
  ]);

  const cashFlows = combineSeries([
    { key: 'cfo', series: metrics['cfo'] },
    { key: 'cfi', series: metrics['cfi'] },
    { key: 'cff', series: metrics['cff'] },
    { key: 'fcf', series: metrics['fcf'] },
  ]);

  const debt = combineSeries([
    { key: 'totalDebt', series: metrics['totalDebt'] },
    { key: 'netDebt', series: metrics['netDebt'] },
    { key: 'leverage', series: metrics['netDebtToEbitda'] },
  ]);

  const workingCapital = combineSeries([
    { key: 'dso', series: metrics['dso'] },
    { key: 'dio', series: metrics['dio'] },
    { key: 'dpo', series: metrics['dpo'] },
    { key: 'ccc', series: metrics['cashConversionCycle'] },
  ]);

  const returns = combineSeries([
    { key: 'roe', series: metrics['roe'] },
    { key: 'roic', series: metrics['roic'] },
    { key: 'roa', series: metrics['roa'] },
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={company.name}
        description={
          <>
            {company.sector ? `${company.sector} · ` : ''}
            {company.industry} · {unitsLabel(company.currency, company.units)} ·{' '}
            {analysis.latestPeriod ? `Latest financial year ${analysis.latestPeriod}` : 'No periods'}
            {company.isSample && <> · <span className="font-semibold text-caution-700">Fictional sample data</span></>}
          </>
        }
        actions={
          <>
            <Link className="btn-secondary" to="/data">Edit data</Link>
            <Link className="btn-primary" to="/report">Report</Link>
          </>
        }
      />

      {/* KPI row */}
      <section aria-label="Key performance indicators" className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Revenue" series={metrics['revenue']} company={company} emphasise />
        <KpiCard label="Revenue growth" series={metrics['revenueGrowth']} company={company} />
        <KpiCard label="EBITDA" series={metrics['ebitdaValue']} company={company} />
        <KpiCard label="EBITDA margin" series={metrics['ebitdaMargin']} company={company} />
        <KpiCard label="Net income" series={metrics['netIncomeValue']} company={company} />
        <KpiCard label="Net margin" series={metrics['netMargin']} company={company} />
        <KpiCard label="CFO" series={metrics['cfo']} company={company} />
        <KpiCard label="Free cash flow" series={metrics['fcf']} company={company} />
        <KpiCard label="ROE" series={metrics['roe']} company={company} />
        <KpiCard label="ROIC" series={metrics['roic']} company={company} />
        <KpiCard label="Net debt / EBITDA" series={metrics['netDebtToEbitda']} company={company} />
        <KpiCard label="Current ratio" series={metrics['currentRatio']} company={company} />
      </section>

      {/* Health pillars */}
      <Card
        title="Financial health"
        description={health.overall !== null ? `Overall ${health.overall}/100 — ${health.label}. Every pillar score is explained on the Financial Health screen.` : 'Not enough data to rate overall financial health.'}
        actions={<Link className="btn-ghost" to="/health">Breakdown</Link>}
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
          <div className="rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5 dark:border-accent-700/40 dark:bg-accent-700/15">
            <p className="label-caps">Overall</p>
            <p className="tnum text-xl font-semibold text-accent-800 dark:text-accent-100">{health.overall ?? '—'}</p>
            <Badge tone={HEALTH_TONE[health.label] ?? 'neutral'}>{health.label}</Badge>
          </div>
          {health.pillars.map((pillar) => (
            <div key={pillar.key} className="rounded-md border border-ink-200 px-3 py-2.5 dark:border-ink-800">
                <p className="label-caps leading-tight" title={pillar.label}>{pillar.label}</p>
              <p className="tnum text-xl font-semibold">{pillar.score ?? '—'}</p>
              <Badge tone={HEALTH_TONE[pillar.label_] ?? 'neutral'}>{pillar.label_}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Revenue and EBITDA" description="Absolute levels above, and the margin they imply below, over the same years.">
          <ChartPair
            ctx={ctx}
            primary={{
              data: revenueEbitda,
              unit: 'currency',
              series: [
                { key: 'revenue', label: 'Revenue', type: 'bar', slot: 0 },
                { key: 'ebitda', label: 'EBITDA', type: 'bar', slot: 1 },
              ],
            }}
            secondary={{
              caption: 'EBITDA margin',
              data: revenueEbitda,
              unit: 'percent',
              series: [{ key: 'margin', label: 'EBITDA margin', type: 'line', slot: 2 }],
            }}
          />
        </Card>

        <Card title="Profitability margins" description="Gross, EBITDA and net margin across the analysis period.">
          <FinancialChart
            data={margins}
            unit="percent"
            ctx={ctx}
            series={[
              { key: 'gross', label: 'Gross margin', type: 'line', slot: 0 },
              { key: 'ebitda', label: 'EBITDA margin', type: 'line', slot: 1 },
              { key: 'net', label: 'Net margin', type: 'line', slot: 2 },
            ]}
          />
        </Card>

        <Card title="Cash flow" description="Operating, investing and financing flows, with free cash flow overlaid.">
          <FinancialChart
            data={cashFlows}
            unit="currency"
            ctx={ctx}
            series={[
              { key: 'cfo', label: 'CFO', type: 'bar', slot: 0 },
              { key: 'cfi', label: 'CFI', type: 'bar', slot: 1 },
              { key: 'cff', label: 'CFF', type: 'bar', slot: 2 },
              { key: 'fcf', label: 'Free cash flow', type: 'line', slot: 3 },
            ]}
          />
        </Card>

        <Card title="Debt and leverage" description={`Borrowings above, and what they represent against earnings below. The line marks the ${analysis.thresholds.netDebtToEbitdaHigh.toFixed(1)}x level treated as elevated for this industry.`}>
          <ChartPair
            ctx={ctx}
            primary={{
              caption: 'Total and net debt',
              data: debt,
              unit: 'currency',
              series: [
                { key: 'totalDebt', label: 'Total debt', type: 'bar', slot: 0 },
                { key: 'netDebt', label: 'Net debt', type: 'bar', slot: 1 },
              ],
            }}
            secondary={{
              caption: 'Net debt / EBITDA',
              data: debt,
              unit: 'times',
              series: [{ key: 'leverage', label: 'Net debt / EBITDA', type: 'line', slot: 2 }],
              reference: { value: analysis.thresholds.netDebtToEbitdaHigh, label: `${analysis.thresholds.netDebtToEbitdaHigh.toFixed(1)}x elevated` },
            }}
          />
        </Card>

        <Card title="Working capital cycle" description="Days of receivables and inventory less days of payables.">
          <FinancialChart
            data={workingCapital}
            unit="days"
            ctx={ctx}
            series={[
              { key: 'dso', label: 'DSO', type: 'line', slot: 0 },
              { key: 'dio', label: 'DIO', type: 'line', slot: 1 },
              { key: 'dpo', label: 'DPO', type: 'line', slot: 2 },
              { key: 'ccc', label: 'Cash conversion cycle', type: 'line', slot: 3 },
            ]}
          />
        </Card>

        <Card title="Returns on capital" description="Return on equity, invested capital and assets.">
          <FinancialChart
            data={returns}
            unit="percent"
            ctx={ctx}
            series={[
              { key: 'roe', label: 'ROE', type: 'line', slot: 0 },
              { key: 'roic', label: 'ROIC', type: 'line', slot: 1 },
              { key: 'roa', label: 'ROA', type: 'line', slot: 2 },
            ]}
            reference={{ value: analysis.thresholds.roicHurdle, label: `Hurdle ${analysis.thresholds.roicHurdle}%` }}
          />
        </Card>
      </div>

      {/* Key findings */}
      <Card
        title="Key findings"
        description={`${positiveSignals.length} positive ${positiveSignals.length === 1 ? 'signal' : 'signals'} and ${redFlags.length} red ${redFlags.length === 1 ? 'flag' : 'flags'} were raised by the rule engine.`}
        actions={<Link className="btn-ghost" to="/insights">All insights</Link>}
      >
        {redFlags.length === 0 && positiveSignals.length === 0 ? (
          <p className="text-[12.5px] text-ink-500 dark:text-ink-400">
            No rule in the risk or positive-signal engine was triggered by this data. That is not the same as a clean bill of
            health — check the Data Quality panel for metrics that could not be calculated.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {[...redFlags.slice(0, 3), ...positiveSignals.slice(0, 3)].map((flag) => (
              <FlagCard key={flag.id} flag={flag} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Overall assessment" description="Generated from the calculated metrics above.">
        <p className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{executiveSummary.headline}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{executiveSummary.overallAssessment}</p>
        {executiveSummary.takeaways.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {executiveSummary.takeaways.map((takeaway, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
                <span className="text-accent-500" aria-hidden="true">▸</span>
                {takeaway}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {executiveSummary.sections.map((section) => (
            <Badge key={section.key} tone={SENTIMENT_TONE[section.sentiment]}>{section.label}</Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}
