import { useMemo, useState } from 'react';
import type { MetricGroup } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { MetricTable } from '../components/analysis/MetricViews';

/**
 * The complete ratio glossary.
 *
 * Every metric the engine knows how to calculate appears here with its formula, plain-language
 * meaning, current and prior values, change, trend and a link to the calculation behind it.
 */
export default function Ratios() {
  const { analysis, current, meta } = useWorkspace();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<MetricGroup | 'all'>('all');
  const [onlyAvailable, setOnlyAvailable] = useState(true);

  const groups = useMemo(() => {
    if (!analysis) return [];
    return (Object.keys(analysis.metricsByGroup) as MetricGroup[])
      .map((key) => ({ key, label: meta?.metricGroups[key] ?? key, series: analysis.metricsByGroup[key] }))
      .filter((entry) => entry.series.length > 0);
  }, [analysis, meta?.metricGroups]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .filter((entry) => group === 'all' || entry.key === group)
      .map((entry) => ({
        ...entry,
        series: entry.series.filter((s) => {
          if (onlyAvailable && !s.points.some((p) => p.status === 'ok')) return false;
          if (!needle) return true;
          return (
            s.label.toLowerCase().includes(needle) ||
            s.formula.toLowerCase().includes(needle) ||
            (s.meaning ?? '').toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((entry) => entry.series.length > 0);
  }, [groups, group, query, onlyAvailable]);

  if (!analysis || !current) return null;

  const totalShown = filtered.reduce((acc, entry) => acc + entry.series.length, 0);
  const unavailable = groups.reduce(
    (acc, entry) => acc + entry.series.filter((s) => !s.points.some((p) => p.status === 'ok')).length,
    0,
  );

  return (
    <div className="stagger space-y-4">
      <PageHeader
        title="Ratio Analysis"
        description="Every ratio the engine calculates, with its formula, what it measures, and how it has moved. Use the info button on any metric for its definition, or “View” to see the exact inputs behind the latest figure."
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <input
            className="input max-w-xs"
            placeholder="Search metrics, formulas or definitions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search metrics"
          />
          <select className="input max-w-[16rem]" value={group} onChange={(e) => setGroup(e.target.value as MetricGroup | 'all')} aria-label="Filter by group">
            <option value="all">All groups</option>
            {groups.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-2xs text-ink-600 dark:text-ink-400">
            <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
            Only metrics that could be calculated
          </label>
          <span className="ml-auto text-2xs text-ink-500 dark:text-ink-400">
            {totalShown} shown{unavailable > 0 && onlyAvailable ? ` · ${unavailable} hidden for lack of data` : ''}
          </span>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title="No metrics match"
          message={
            onlyAvailable
              ? 'Nothing matches your search among the metrics that could be calculated. Clear the filter to see metrics that are unavailable, along with the reason each one could not be computed.'
              : 'No metric matches your search.'
          }
        />
      ) : (
        filtered.map((entry) => (
          <Card key={entry.key} title={entry.label} description={`${entry.series.length} metrics`} padded={false}>
            <MetricTable series={entry.series} company={current.company} />
          </Card>
        ))
      )}
    </div>
  );
}
