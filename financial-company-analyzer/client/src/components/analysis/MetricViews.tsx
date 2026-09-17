import { useMemo, useState } from 'react';
import type {
  AnalysisResult, CompanyProfile, Evidence, Flag, Insight, MetricSeries, MetricValue, Num,
} from '@fca/core';
import {
  changeTone, fmtCtx, formatChange, formatMetric, SENTIMENT_TONE, SEVERITY_LABEL, TREND_LABEL, TREND_TONE,
} from '../../lib/display';
import { Badge, Card, EmptyState, InfoTip, Modal } from '../ui/primitives';
import { Sparkline } from '../charts/Charts';

const TONE_TEXT = {
  positive: 'text-positive-600 dark:text-positive-500',
  negative: 'text-negative-600 dark:text-negative-500',
  neutral: 'text-ink-500 dark:text-ink-400',
  caution: 'text-caution-700 dark:text-caution-500',
};

/* ------------------------------------------------------------------ */
/* KPI card                                                           */
/* ------------------------------------------------------------------ */

export function KpiCard({
  label, series, company, hint, emphasise,
}: { label: string; series: MetricSeries | undefined; company: CompanyProfile; hint?: string; emphasise?: boolean }) {
  const ctx = fmtCtx(company);
  const latest = series?.latest;
  const available = latest && latest.status === 'ok' && latest.value !== null;
  const tone = series ? changeTone(series) : 'neutral';

  return (
    <div
      className={`surface px-3 py-2.5 transition-colors ${
        emphasise ? 'border-accent-200 bg-accent-50/30 dark:border-accent-700/50 dark:bg-accent-700/10' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="label-caps leading-tight">{label}</span>
        {(series?.meaning || hint) && (
          <InfoTip label={`About ${label}`}>
            <span className="block font-semibold text-ink-900 dark:text-ink-100">{series?.label ?? label}</span>
            {series?.formula && <span className="mt-1 block font-mono text-[11px] text-ink-500 dark:text-ink-400">{series.formula}</span>}
            <span className="mt-1.5 block">{hint ?? series?.meaning}</span>
          </InfoTip>
        )}
      </div>

      <p className={`mt-1.5 ${available ? 'kpi-value' : 'kpi-value-muted'}`}>
        {available ? formatMetric(latest.value, latest.unit, ctx) : 'n/a'}
      </p>

      <div className="mt-1 flex items-baseline gap-1 text-2xs">
        {available && series?.change !== null && series?.previous ? (
          <>
            {/* An arrow alongside the colour, so direction is never carried by hue alone. */}
            <span className={`font-semibold tnum ${TONE_TEXT[tone]}`}>
              {tone !== 'neutral' && (
                <span aria-hidden="true">{(series.change ?? 0) > 0 ? '▲' : '▼'} </span>
              )}
              {formatChange(series.change, series.unit, ctx)}
            </span>
            <span className="text-ink-500 dark:text-ink-400">vs {series.previous.period}</span>
          </>
        ) : (
          <span className="text-ink-400 dark:text-ink-500">
            {!available ? (latest?.note ? 'Not available' : 'Not available from the data supplied') : 'No prior period'}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence drawer                                                    */
/* ------------------------------------------------------------------ */

export function EvidenceModal({ open, title, evidence, onClose }: { open: boolean; title: string; evidence: Evidence | null; onClose: () => void }) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {!evidence ? (
        <p className="text-[12.5px] text-ink-500">No calculation detail is recorded for this item.</p>
      ) : (
        <div className="space-y-3">
          {evidence.formula && (
            <div>
              <p className="label-caps mb-1">Formula</p>
              <p className="rounded bg-ink-100 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                {evidence.formula}
              </p>
            </div>
          )}
          <div>
            <p className="label-caps mb-1">Inputs used</p>
            <table className="fin-table">
              <tbody>
                {evidence.lines.map((line, i) => (
                  <tr key={`${line.label}-${i}`}>
                    <th className="font-normal text-ink-600 dark:text-ink-300">{line.label}</th>
                    <td className="tnum font-medium">{line.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {evidence.conclusion && (
            <div className="rounded border border-accent-100 bg-accent-50 px-3 py-2 text-[12.5px] leading-relaxed text-accent-800 dark:border-accent-700/40 dark:bg-accent-700/15 dark:text-accent-100">
              {evidence.conclusion}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Metric table                                                       */
/* ------------------------------------------------------------------ */

type SortKey = 'label' | 'latest' | 'change' | 'trend';

export function MetricTable({
  series, company, caption, showSparkline = true,
}: { series: MetricSeries[]; company: CompanyProfile; caption?: string; showSparkline?: boolean }) {
  const ctx = fmtCtx(company);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'label', dir: 'asc' });
  const [evidence, setEvidence] = useState<{ title: string; evidence: Evidence } | null>(null);

  const rows = useMemo(() => {
    const copy = [...series];
    const direction = sort.dir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case 'latest': {
          const av = a.latest?.status === 'ok' ? a.latest.value ?? -Infinity : -Infinity;
          const bv = b.latest?.status === 'ok' ? b.latest.value ?? -Infinity : -Infinity;
          return (av - bv) * direction;
        }
        case 'change':
          return ((a.change ?? -Infinity) - (b.change ?? -Infinity)) * direction;
        case 'trend':
          return a.trend.localeCompare(b.trend) * direction;
        default:
          return a.label.localeCompare(b.label) * direction;
      }
    });
    return copy;
  }, [series, sort]);

  if (series.length === 0) {
    return <EmptyState title="No metrics available" message="None of the metrics in this group could be calculated from the data supplied." />;
  }

  const header = (key: SortKey, label: string, align = 'text-right') => (
    <th className={align}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-accent-600"
        onClick={() => setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }))}
        aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span aria-hidden="true" className="text-[8px]">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  );

  return (
    <>
      <div className="overflow-x-auto">
        <table className="fin-table">
          {caption && <caption className="px-3 py-2 text-left text-2xs text-ink-500">{caption}</caption>}
          <thead>
            <tr>
              {header('label', 'Metric', 'text-left')}
              {header('latest', 'Latest')}
              {header('change', 'Prior')}
              <th>Change</th>
              {showSparkline && <th className="text-center">History</th>}
              {header('trend', 'Trend')}
              <th className="text-left">Interpretation</th>
              <th className="text-center">Trace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const available = s.latest?.status === 'ok' && s.latest.value !== null;
              const tone = changeTone(s);
              return (
                <tr key={s.key}>
                  <th>
                    <span className="inline-flex items-center gap-1">
                      {s.label}
                      <InfoTip label={`About ${s.label}`}>
                        <span className="block font-semibold text-ink-900 dark:text-ink-100">{s.label}</span>
                        <span className="mt-1 block font-mono text-[11px] text-ink-500 dark:text-ink-400">{s.formula}</span>
                        <span className="mt-1.5 block">{s.meaning}</span>
                      </InfoTip>
                    </span>
                  </th>
                  <td className={`tnum font-semibold ${available ? '' : 'text-ink-400'}`}>
                    {available ? formatMetric(s.latest!.value, s.unit, ctx) : 'n/a'}
                  </td>
                  <td className="tnum text-ink-600 dark:text-ink-300">
                    {s.previous?.status === 'ok' ? formatMetric(s.previous.value, s.unit, ctx) : 'n/a'}
                  </td>
                  <td className={`tnum ${TONE_TEXT[tone]}`}>{s.change !== null ? formatChange(s.change, s.unit, ctx) : '—'}</td>
                  {showSparkline && (
                    <td className="text-center">
                      <Sparkline
                        values={s.points.map((p) => (p.status === 'ok' ? p.value : null))}
                        tone={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : 'accent'}
                      />
                    </td>
                  )}
                  <td>
                    <Badge tone={TREND_TONE[s.trend]}>{TREND_LABEL[s.trend]}</Badge>
                  </td>
                  <td className="max-w-md whitespace-normal text-left text-[12px] leading-snug text-ink-600 dark:text-ink-300">
                    {available ? s.meaning : (s.latest?.note ?? 'Not enough data to calculate this metric.')}
                  </td>
                  <td className="text-center">
                    {s.latest && (
                      <button
                        type="button"
                        className="text-2xs font-semibold text-accent-600 underline underline-offset-2 hover:text-accent-800"
                        onClick={() =>
                          setEvidence({
                            title: `${s.label} — ${s.latest!.period}`,
                            evidence: {
                              formula: s.formula,
                              lines: Object.entries(s.latest!.inputs).map(([label, value]) => ({
                                label,
                                display: value === null ? 'n/a' : formatMetric(value as Num, label.toLowerCase().includes('rate') ? 'percent' : s.unit === 'currency' || s.unit === 'times' || s.unit === 'days' ? 'currency' : s.unit, ctx),
                                value: value as Num,
                              })),
                              conclusion: s.latest!.status === 'ok'
                                ? `${s.label} for ${s.latest!.period} = ${formatMetric(s.latest!.value, s.unit, ctx)}.`
                                : s.latest!.note,
                            },
                          })
                        }
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EvidenceModal open={evidence !== null} title={evidence?.title ?? ''} evidence={evidence?.evidence ?? null} onClose={() => setEvidence(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Findings                                                           */
/* ------------------------------------------------------------------ */

export function FlagCard({ flag }: { flag: Flag }) {
  const [open, setOpen] = useState(false);
  const tone = SENTIMENT_TONE[flag.sentiment];
  const border = tone === 'negative' ? 'border-l-negative-500' : tone === 'positive' ? 'border-l-positive-500' : tone === 'caution' ? 'border-l-caution-500' : 'border-l-ink-300';

  return (
    <>
      <article className={`surface border-l-4 px-4 py-3 ${border}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{flag.sentiment === 'positive' ? 'Positive' : SEVERITY_LABEL[flag.severity]}</Badge>
          <span className="text-2xs uppercase tracking-wider text-ink-500 dark:text-ink-400">{flag.rule}</span>
          <span className="text-2xs text-ink-400">· {flag.period}</span>
        </div>
        <h3 className="mt-1.5 text-[13px] font-semibold text-ink-900 dark:text-ink-50">{flag.title}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{flag.detail}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="text-2xs font-semibold text-accent-600 underline underline-offset-2 hover:text-accent-800" onClick={() => setOpen(true)}>
            View calculation
          </button>
          {flag.thresholdUsed && (
            <span className="text-2xs text-ink-500 dark:text-ink-400">
              Threshold: {Object.entries(flag.thresholdUsed).map(([k, v]) => `${k} = ${v}`).join(', ')}
            </span>
          )}
        </div>
      </article>
      <EvidenceModal open={open} title={flag.title} evidence={flag.evidence} onClose={() => setOpen(false)} />
    </>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false);
  const tone = SENTIMENT_TONE[insight.sentiment];
  const border = tone === 'negative' ? 'border-l-negative-500' : tone === 'positive' ? 'border-l-positive-500' : tone === 'caution' ? 'border-l-caution-500' : 'border-l-accent-300';

  return (
    <>
      <article className={`surface border-l-4 px-4 py-3 ${border}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{insight.title}</h3>
          <Badge tone={tone}>{insight.sentiment === 'investigate' ? 'Investigate' : insight.sentiment}</Badge>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{insight.narrative}</p>
        {insight.evidence.lines.length > 0 && (
          <button type="button" className="mt-2 text-2xs font-semibold text-accent-600 underline underline-offset-2 hover:text-accent-800" onClick={() => setOpen(true)}>
            View calculation
          </button>
        )}
      </article>
      <EvidenceModal open={open} title={insight.title} evidence={insight.evidence} onClose={() => setOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Section scaffolding                                                */
/* ------------------------------------------------------------------ */

/** Wraps a group of metrics with a consistent heading, table and related insights. */
export function AnalysisSection({
  title, description, series, company, insights, children,
}: {
  title: string; description?: string; series: MetricSeries[]; company: CompanyProfile;
  insights?: Insight[]; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Card title={title} description={description} padded={false}>
        <MetricTable series={series} company={company} />
      </Card>
      {children}
      {insights && insights.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)}
        </div>
      )}
    </div>
  );
}

/** Metrics from a group, excluding those suppressed for the industry or never calculable. */
export function usableSeries(analysis: AnalysisResult, group: keyof AnalysisResult['metricsByGroup'], keys?: string[]): MetricSeries[] {
  const all = analysis.metricsByGroup[group] ?? [];
  const filtered = keys ? all.filter((s) => keys.includes(s.key)) : all;
  return filtered.filter((s) => !s.points.every((p: MetricValue) => p.status === 'not_applicable'));
}
