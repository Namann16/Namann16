import { useState } from 'react';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { FinancialChart } from '../components/charts/Charts';
import { EvidenceModal, KpiCard } from '../components/analysis/MetricViews';
import { fmtCtx, formatMetric } from '../lib/display';

const DRIVER_LABEL: Record<string, string> = {
  margin: 'net profit margin',
  turnover: 'asset turnover',
  leverage: 'financial leverage',
  none: 'no single component',
};

export default function DuPont() {
  const { analysis, current } = useWorkspace();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  if (!analysis || !current) return null;

  const { duPont, metrics, company } = analysis;
  const ctx = fmtCtx(company);
  const complete = duPont.periods.filter((p) => p.status === 'ok');

  if (complete.length === 0) {
    return (
      <>
        <PageHeader title="DuPont Analysis" />
        <EmptyState
          title="Return on equity cannot be decomposed"
          message="The three-step decomposition needs net income, revenue, total assets and total equity for at least one period. Add the missing line items on the Data Input screen — the Data Quality panel lists exactly which ones are absent."
          action={<a className="btn-primary" href="/data">Go to Data Input</a>}
        />
      </>
    );
  }

  const chartData = duPont.periods.map((row) => ({
    period: row.period,
    roe: row.roe,
    netMargin: row.netMargin,
    assetTurnover: row.assetTurnover,
    equityMultiplier: row.equityMultiplier,
  }));

  const attribution = duPont.attribution;
  const effects = attribution
    ? [
        { key: 'margin', label: 'Net profit margin', value: attribution.marginEffect },
        { key: 'turnover', label: 'Asset turnover', value: attribution.turnoverEffect },
        { key: 'leverage', label: 'Financial leverage', value: attribution.leverageEffect },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="DuPont Analysis"
        description="Return on equity is decomposed into the three things that can move it: how much profit each sale generates, how hard the asset base works, and how much of that asset base is funded by borrowing rather than shareholders. Two companies can report identical ROE for entirely different reasons."
      />

      <Card title="The identity">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[13px]">
          <span className="rounded bg-accent-700 px-3 py-2 font-semibold text-white">ROE</span>
          <span className="text-ink-400">=</span>
          <span className="rounded border border-ink-300 px-3 py-2 dark:border-ink-700">Net Profit Margin</span>
          <span className="text-ink-400">×</span>
          <span className="rounded border border-ink-300 px-3 py-2 dark:border-ink-700">Asset Turnover</span>
          <span className="text-ink-400">×</span>
          <span className="rounded border border-ink-300 px-3 py-2 dark:border-ink-700">Equity Multiplier</span>
        </div>
        <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
          The identity holds because (Net Income / Revenue) × (Revenue / Assets) × (Assets / Equity) cancels down to
          Net Income / Equity. Because the components use average balance-sheet values, the product is shown alongside directly
          calculated ROE as a consistency check rather than being assumed to match exactly.
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard label="ROE" series={metrics['roe']} company={company} emphasise />
        <KpiCard label="Net profit margin" series={metrics['netMargin']} company={company} />
        <KpiCard label="Asset turnover" series={metrics['assetTurnover']} company={company} />
        <KpiCard label="Equity multiplier" series={metrics['equityMultiplier']} company={company} />
      </section>

      {attribution && (
        <Card
          title="What is driving the change in ROE"
          description={`Attribution between ${attribution.from} and ${attribution.to}.`}
          actions={
            <button type="button" className="btn-ghost" onClick={() => setEvidenceOpen(true)}>View calculation</button>
          }
        >
          <p className="text-[12.5px] leading-relaxed text-ink-800 dark:text-ink-200">{attribution.narrative}</p>

          <div className="mt-4 grid gap-2.5 md:grid-cols-4">
            <div className="rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5 dark:border-accent-700/40 dark:bg-accent-700/15">
              <p className="label-caps">Total ROE change</p>
              <p className="tnum text-xl font-semibold text-accent-800 dark:text-accent-100">
                {attribution.roeChange !== null ? `${attribution.roeChange >= 0 ? '+' : ''}${attribution.roeChange.toFixed(2)} pp` : 'n/a'}
              </p>
            </div>
            {effects.map((effect) => (
              <div key={effect.key} className="rounded-md border border-ink-200 px-3 py-2.5 dark:border-ink-800">
                <p className="label-caps">{effect.label}</p>
                <p className={`tnum text-xl font-semibold ${
                  effect.value === null ? 'text-ink-400'
                    : effect.value > 0 ? 'text-positive-600' : effect.value < 0 ? 'text-negative-600' : ''
                }`}>
                  {effect.value !== null ? `${effect.value >= 0 ? '+' : ''}${effect.value.toFixed(2)} pp` : 'n/a'}
                </p>
                {attribution.primaryDriver === effect.key && <Badge tone="accent">Primary driver</Badge>}
              </div>
            ))}
          </div>

          <p className="mt-3 text-2xs text-ink-500 dark:text-ink-400">
            Each component is moved from its prior-period value to its current value in turn, holding the remaining components at
            prior values, so the three effects sum exactly to the total change and nothing is left unexplained. The primary driver is
            calculated from the data, not assumed: this period it is {DRIVER_LABEL[attribution.primaryDriver]}.
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="ROE and its components" description="Margin and ROE on the left axis in percent; turnover and leverage on the right in multiples.">
          <FinancialChart
            data={chartData}
            unit="percent"
            rightUnit="times"
            ctx={ctx}
            height={260}
            series={[
              { key: 'roe', label: 'ROE', type: 'bar', unit: 'percent' },
              { key: 'netMargin', label: 'Net margin', type: 'line', unit: 'percent' },
              { key: 'assetTurnover', label: 'Asset turnover', type: 'line', unit: 'times', axis: 'right' },
              { key: 'equityMultiplier', label: 'Equity multiplier', type: 'line', unit: 'times', axis: 'right' },
            ]}
          />
        </Card>

        <Card title="Decomposition by period" padded={false}>
          <div className="overflow-x-auto">
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="text-left">Period</th>
                  <th>ROE</th>
                  <th>Net margin</th>
                  <th>Asset turnover</th>
                  <th>Equity multiplier</th>
                  <th>Reconstructed</th>
                </tr>
              </thead>
              <tbody>
                {duPont.periods.map((row) => (
                  <tr key={row.period}>
                    <th>{row.period}</th>
                    <td className="tnum font-semibold">{formatMetric(row.roe, 'percent')}</td>
                    <td className="tnum">{formatMetric(row.netMargin, 'percent')}</td>
                    <td className="tnum">{formatMetric(row.assetTurnover, 'times')}</td>
                    <td className="tnum">{formatMetric(row.equityMultiplier, 'times')}</td>
                    <td className="tnum text-ink-600 dark:text-ink-300" title={row.note}>
                      {row.status === 'ok' ? formatMetric(row.reconstructedRoe, 'percent') : <span className="text-ink-400">n/a</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-2xs text-ink-500 dark:text-ink-400">
            “Reconstructed” is the product of the three components. A small difference from directly calculated ROE is expected
            where average balances are used; a large one points to an inconsistency in the underlying data.
          </p>
        </Card>
      </div>

      {duPont.periods.some((p) => p.status !== 'ok') && (
        <Card title="Periods that could not be decomposed">
          <ul className="space-y-1.5">
            {duPont.periods
              .filter((p) => p.status !== 'ok')
              .map((row) => (
                <li key={row.period} className="text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
                  <strong className="font-medium text-ink-800 dark:text-ink-200">{row.period}:</strong> {row.note}
                </li>
              ))}
          </ul>
        </Card>
      )}

      <EvidenceModal
        open={evidenceOpen}
        title="ROE attribution"
        evidence={attribution?.evidence ?? null}
        onClose={() => setEvidenceOpen(false)}
      />
    </div>
  );
}
