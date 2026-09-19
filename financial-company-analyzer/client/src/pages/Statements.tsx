import { useMemo, useState } from 'react';
import type { LineItemDef, Num, StatementKey } from '@fca/core';
import { percentChange, safeDiv, toPercent } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Card, EmptyState, PageHeader, SourceDot } from '../components/ui/primitives';
import { fmtCtx, formatCurrency, formatMetric } from '../lib/display';

/**
 * Financial statement viewer.
 *
 * Shows the normalized statements with every figure marked as entered or calculated, and lets
 * the reader switch between absolute values, year-on-year growth, and common-size percentages.
 * The derived views are computed from the statement values the engine already produced.
 */

type View = 'absolute' | 'growth' | 'commonSize';

/** The denominator used for common-size presentation, per statement. */
const COMMON_SIZE_BASE: Record<StatementKey, { key: string; label: string }> = {
  income: { key: 'revenue', label: 'revenue' },
  balance: { key: 'totalAssets', label: 'total assets' },
  cashFlow: { key: 'revenue', label: 'revenue' },
  share: { key: 'revenue', label: 'revenue' },
};

export default function Statements() {
  const { analysis, current, meta } = useWorkspace();
  const [statement, setStatement] = useState<StatementKey>('income');
  const [view, setView] = useState<View>('absolute');
  const [hideEmpty, setHideEmpty] = useState(true);

  const periods = analysis?.statements ?? [];
  const lineItems = useMemo(
    () => (meta?.lineItems ?? []).filter((item) => item.statement === statement),
    [meta?.lineItems, statement],
  );

  if (!analysis || !current) return null;
  const ctx = fmtCtx(current.company);

  if (periods.length === 0) {
    return (
      <EmptyState
        title="No financial statements to display"
        message="No periods have been entered. Add financial data to see the statements."
      />
    );
  }

  const base = COMMON_SIZE_BASE[statement];

  /** The cell value for the active view, or null when it cannot be computed. */
  const cellValue = (item: LineItemDef, periodIndex: number): { value: Num; unit: 'currency' | 'percent' } => {
    const period = periods[periodIndex]!;
    const raw = period.values[item.key];
    const value = typeof raw === 'number' ? raw : null;

    if (view === 'absolute') return { value, unit: 'currency' };

    if (view === 'growth') {
      const prior = periodIndex > 0 ? periods[periodIndex - 1]!.values[item.key] : undefined;
      return { value: percentChange(typeof prior === 'number' ? prior : null, value), unit: 'percent' };
    }

    const denominator = period.values[base.key];
    return { value: toPercent(safeDiv(value, typeof denominator === 'number' ? denominator : null)), unit: 'percent' };
  };

  /** Highlight a materially large move so the eye lands on it without colouring everything. */
  const emphasis = (item: LineItemDef, periodIndex: number): string => {
    if (view !== 'growth' || periodIndex === 0) return '';
    const { value } = cellValue(item, periodIndex);
    if (value === null) return '';
    if (Math.abs(value) < 20) return '';
    return value > 0 ? 'text-positive-700 dark:text-positive-500' : 'text-negative-700 dark:text-negative-500';
  };

  const visibleItems = hideEmpty
    ? lineItems.filter((item) => periods.some((p) => typeof p.values[item.key] === 'number'))
    : lineItems;

  let section = '';

  return (
    <div className="stagger space-y-4">
      <PageHeader
        title="Financial Statements"
        description={
          <>
            Normalized statements for {current.company.name}. A dot marks a figure the engine derived rather than one you
            entered; “n/a” means the figure was not supplied and has not been assumed to be zero.
          </>
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-3 py-2 dark:border-ink-800">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Statement">
            {(meta?.statements ?? []).map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={statement === s.key}
                onClick={() => setStatement(s.key as StatementKey)}
                className={`rounded px-2.5 py-1 text-[12.5px] transition-colors ${
                  statement === s.key ? 'bg-accent-700 font-medium text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1" role="group" aria-label="Presentation">
              {([
                { key: 'absolute', label: 'Values' },
                { key: 'growth', label: 'YoY growth' },
                { key: 'commonSize', label: `% of ${base.label}` },
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setView(option.key)}
                  aria-pressed={view === option.key}
                  className={`rounded border px-2 py-0.5 text-2xs transition-colors ${
                    view === option.key
                      ? 'border-accent-600 bg-accent-600/[0.08] font-semibold text-accent-700 dark:bg-accent-700/20 dark:text-accent-100'
                      : 'border-ink-300 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-2xs text-ink-600 dark:text-ink-400">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              Hide empty rows
            </label>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={`No ${meta?.statements.find((s) => s.key === statement)?.label.toLowerCase() ?? 'statement'} data`}
              message="Nothing has been entered for this statement yet. Add the figures on the Data Input screen to unlock the related analysis."
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="fin-table sticky-labels">
              <thead>
                <tr>
                  <th className="text-left" style={{ minWidth: 280 }}>Line item</th>
                  {periods.map((period) => <th key={period.label} style={{ minWidth: 110 }}>{period.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const rows = [];
                  if (item.section !== section) {
                    section = item.section;
                    rows.push(
                      <tr key={`section-${item.section}-${statement}`} className="row-section">
                        <td colSpan={periods.length + 1}>
                          <span className="sticky left-3 inline-block">{item.section}</span>
                        </td>
                      </tr>,
                    );
                  }
                  rows.push(
                    <tr key={item.key} className={item.derivable ? 'row-total' : undefined}>
                      <th title={item.description}>{item.label}</th>
                      {periods.map((period, index) => {
                        const { value, unit } = cellValue(item, index);
                        const source = typeof period.values[item.key] === 'number'
                          ? (period.sources[item.key] === 'calculated' ? 'calculated' : 'entered')
                          : 'missing';
                        return (
                          <td key={period.label} className={`tnum ${emphasis(item, index)}`}>
                            {value === null
                              ? <span className="text-ink-400">{view === 'absolute' ? 'n/a' : '—'}</span>
                              : unit === 'currency'
                                ? formatCurrency(value, ctx)
                                : formatMetric(value, 'percent', ctx)}
                            {view === 'absolute' && <SourceDot source={source} />}
                          </td>
                        );
                      })}
                    </tr>,
                  );
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 border-t border-ink-200 px-3 py-2 text-2xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          <span className="flex items-center gap-1"><SourceDot source="entered" /> entered or imported</span>
          <span className="flex items-center gap-1"><SourceDot source="calculated" /> calculated by the engine</span>
          <span>Amounts in {ctx.currency} {current.company.units}.</span>
        </div>
      </Card>

      {statement === 'balance' && <BalanceCheck />}
    </div>
  );
}

/** Surfaces the accounting identity for every period. A difference is stated, never hidden. */
function BalanceCheck() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;
  const ctx = fmtCtx(current.company);

  const checks = analysis.dataQuality.checks.filter((c) => c.id.startsWith('balance.'));
  if (checks.length === 0) return null;

  return (
    <Card title="Accounting identity" description="Total assets must equal total liabilities plus total equity in every period.">
      <div className="overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th className="text-left">Period</th>
              <th>Total assets</th>
              <th>Liabilities + equity</th>
              <th>Difference</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {analysis.statements.map((period) => {
              const assets = period.values['totalAssets'];
              const liabilities = period.values['totalLiabilities'];
              const equity = period.values['totalEquity'];
              const check = checks.find((c) => c.period === period.label);
              const computable = typeof assets === 'number' && typeof liabilities === 'number' && typeof equity === 'number';
              const sum = computable ? (liabilities as number) + (equity as number) : null;
              const difference = computable ? (assets as number) - sum! : null;
              return (
                <tr key={period.label}>
                  <th>{period.label}</th>
                  <td className="tnum">{typeof assets === 'number' ? formatCurrency(assets, ctx) : 'n/a'}</td>
                  <td className="tnum">{sum !== null ? formatCurrency(sum, ctx) : 'n/a'}</td>
                  <td className={`tnum ${difference !== null && Math.abs(difference) > 0.01 ? 'font-semibold text-negative-700 dark:text-negative-500' : ''}`}>
                    {difference !== null ? formatCurrency(difference, ctx) : 'n/a'}
                  </td>
                  <td className="text-left">
                    <Badge tone={check?.status === 'pass' ? 'positive' : check?.status === 'fail' ? 'negative' : 'neutral'}>
                      {check?.status === 'pass' ? 'Balanced' : check?.status === 'fail' ? 'Does not balance' : 'Cannot be tested'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {checks.some((c) => c.status === 'fail') && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-negative-700 dark:text-negative-500">
          The balance sheet does not balance in at least one period. Ratios that depend on total assets or equity — return on
          equity, asset turnover, leverage — should be treated with caution until the difference is explained.
        </p>
      )}
    </Card>
  );
}
