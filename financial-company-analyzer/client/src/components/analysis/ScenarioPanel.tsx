import { useMemo, useRef, useState } from 'react';
import type { Num, ScenarioDiff } from '@fca/core';
import { api } from '../../api/client';
import { fmtCtx, formatMetric } from '../../lib/display';
import { Badge, Card, Field } from '../ui/primitives';

interface ScenarioRow {
  id: number;
  period: string;
  key: string;
  mode: 'percent' | 'absolute';
  value: string;
}

export function ScenarioPanel({
  companyId,
  company,
  periods,
  lineItems,
}: {
  companyId: string;
  company: Parameters<typeof fmtCtx>[0];
  periods: { label: string; values: Record<string, Num> }[];
  lineItems: { key: string; label: string }[];
}) {
  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => a.label.localeCompare(b.label)), [periods]);
  const [rows, setRows] = useState<ScenarioRow[]>([
    { id: 1, period: sortedPeriods[sortedPeriods.length - 1]?.label ?? '', key: lineItems[0]?.key ?? '', mode: 'percent', value: '10' },
  ]);
  const [result, setResult] = useState<ScenarioDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRowId = useRef(2);
  const ctx = fmtCtx(company);

  const updateRow = (id: number, patch: Partial<ScenarioRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const runScenario = async () => {
    setError(null);
    const modifications = new Map<string, Record<string, number | null>>();
    for (const row of rows) {
      const amount = Number(row.value);
      const period = periods.find((candidate) => candidate.label === row.period);
      const base = period?.values[row.key] ?? null;
      if (!period || !Number.isFinite(amount)) {
        setError('Choose a valid period and enter a finite adjustment for every row.');
        return;
      }
      if (row.mode === 'percent' && base === null) {
        setError(`${row.key} has no base value in ${row.period}; use an absolute value instead.`);
        return;
      }
      const nextValue = row.mode === 'percent' ? (base as number) * (1 + amount / 100) : amount;
      const values = modifications.get(row.period) ?? {};
      values[row.key] = nextValue;
      modifications.set(row.period, values);
    }
    setBusy(true);
    try {
      const response = await api.scenario(companyId, [...modifications.entries()].map(([period, values]) => ({ period, values })));
      setResult(response.scenario);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scenario could not be calculated.');
    } finally {
      setBusy(false);
    }
  };

  const changedMetrics = result
    ? [...result.metricChanges]
      .filter((change) => change.period === result.scenario.latestPeriod)
      .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
      .slice(0, 8)
    : [];
  const healthTone = (result?.healthDelta ?? 0) > 0 ? 'positive' : (result?.healthDelta ?? 0) < 0 ? 'negative' : 'neutral';

  return (
    <Card
      title="Scenario analysis"
      description="Temporary what-if overlay — it never changes the saved company data."
      actions={result ? <button type="button" className="btn-secondary" onClick={() => setResult(null)}>Clear result</button> : undefined}
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-caution-500/[0.12] px-3 py-2 text-subheadline leading-relaxed text-caution-600 dark:bg-caution-400/[0.14] dark:text-caution-300">
          <strong>Held-constant assumption:</strong> every line item you do not adjust remains
          unchanged. For example, increasing revenue while leaving COGS, operating expenses, and
          tax unchanged implies those costs do not scale with revenue. Adjust the related cost
          lines too when you want a margin or tax-rate scenario rather than a pure sensitivity test.
        </div>
        {rows.map((row) => (
          <div key={row.id} className="grid items-end gap-2 sm:grid-cols-[1fr_1.3fr_auto_1fr_auto]">
            <Field label="Period">
              <select className="input" value={row.period} onChange={(event) => updateRow(row.id, { period: event.target.value })}>
                {sortedPeriods.map((period) => <option key={period.label} value={period.label}>{period.label}</option>)}
              </select>
            </Field>
            <Field label="Line item">
              <select className="input" value={row.key} onChange={(event) => updateRow(row.id, { key: event.target.value })}>
                {lineItems.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Change type">
              <select className="input" value={row.mode} onChange={(event) => updateRow(row.id, { mode: event.target.value as ScenarioRow['mode'] })}>
                <option value="percent">%</option>
                <option value="absolute">Absolute</option>
              </select>
            </Field>
            <Field label={row.mode === 'percent' ? 'Adjustment' : 'New value'}>
              <input className="input tnum" type="number" value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} />
            </Field>
            <button
              type="button"
              className="btn-secondary"
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((candidate) => candidate.id !== row.id))}
              aria-label="Remove scenario adjustment"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setRows((current) => [
            ...current,
            { id: nextRowId.current++, period: sortedPeriods[sortedPeriods.length - 1]?.label ?? '', key: lineItems[0]?.key ?? '', mode: 'percent', value: '10' },
          ])}>
            Add adjustment
          </button>
          <button type="button" className="btn-primary" disabled={busy || !periods.length || !lineItems.length} onClick={() => void runScenario()}>
            {busy ? 'Calculating…' : 'Run scenario'}
          </button>
        </div>

        {error && <p className="text-[12px] text-negative-600">{error}</p>}

        {result && (
          <div className="scenario-result animate-in hairline-t pt-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="surface px-3 py-2">
                <p className="label-caps">Health score change</p>
                <p className="mt-1 text-lg font-semibold tnum">
                  {result.healthDelta === null ? 'n/a' : `${result.healthDelta > 0 ? '+' : ''}${result.healthDelta.toFixed(1)}`}
                </p>
              </div>
              <div className="surface px-3 py-2">
                <p className="label-caps">Added red flags</p>
                <p className="mt-1 text-lg font-semibold tnum">{result.addedRedFlags.length}</p>
              </div>
              <div className="surface px-3 py-2">
                <p className="label-caps">Removed red flags</p>
                <p className="mt-1 text-lg font-semibold tnum">{result.removedRedFlags.length}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone={healthTone}>Scenario is temporary</Badge>
              {result.addedRedFlags.map((flag) => <Badge key={`added-${flag}`} tone="negative">Added: {flag}</Badge>)}
              {result.removedRedFlags.map((flag) => <Badge key={`removed-${flag}`} tone="positive">Removed: {flag}</Badge>)}
            </div>

            {changedMetrics.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="fin-table">
                  <thead><tr><th className="text-left">Metric</th><th>Base</th><th>Scenario</th><th>Change</th></tr></thead>
                  <tbody>
                    {changedMetrics.map((change) => (
                      <tr key={`${change.key}-${change.period}`}>
                        <th className="text-left">{change.label}</th>
                        <td className="tnum">{change.base === null ? 'n/a' : formatMetric(change.base, change.unit, ctx)}</td>
                        <td className="tnum">{change.scenario === null ? 'n/a' : formatMetric(change.scenario, change.unit, ctx)}</td>
                        <td className="tnum">{change.delta === null ? 'n/a' : formatMetric(change.delta, change.unit, ctx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
