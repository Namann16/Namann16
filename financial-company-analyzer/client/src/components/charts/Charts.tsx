import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { MetricUnit } from '@fca/core';
import { CHART_COLORS, compactNumber, formatMetric } from '../../lib/display';
import { EmptyState } from '../ui/primitives';

/**
 * Chart primitives.
 *
 * Every chart takes a unit so the axis, tooltip and labels agree with the metric being shown.
 * Periods that could not be calculated are dropped rather than plotted as zero, which would
 * misrepresent missing data as a real collapse in a value.
 */

export interface ChartContext {
  currency?: string;
  units?: 'units' | 'thousands' | 'lakhs' | 'millions' | 'crores' | 'billions';
}

interface SeriesSpec {
  key: string;
  label: string;
  color?: string;
  unit?: MetricUnit;
  /** Render this series on the right-hand axis. */
  axis?: 'left' | 'right';
  type?: 'line' | 'bar' | 'area';
}

interface BaseProps {
  data: Record<string, string | number | null>[];
  series: SeriesSpec[];
  unit: MetricUnit;
  ctx?: ChartContext;
  height?: number;
  /** Unit for the right-hand axis, when a second axis is in use. */
  rightUnit?: MetricUnit;
  emptyMessage?: string;
  stacked?: boolean;
  /** Draw a reference line at this value on the left axis, e.g. a threshold. */
  reference?: { value: number; label: string };
}

const axisStyle = { fontSize: 11, fill: 'currentColor' } as const;
const gridStroke = 'currentColor';

function tickFormatter(unit: MetricUnit) {
  return (value: number) => {
    if (!Number.isFinite(value)) return '';
    switch (unit) {
      case 'percent': return `${compactNumber(value)}%`;
      case 'times': return `${compactNumber(value)}x`;
      case 'days': return `${Math.round(value)}d`;
      default: return compactNumber(value);
    }
  };
}

function ChartTooltip({ active, payload, label, ctx, unit, rightUnit, series }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] shadow-raised dark:border-ink-700 dark:bg-ink-900">
      <p className="mb-1 font-semibold text-ink-900 dark:text-ink-100">{label}</p>
      {payload.map((entry: any) => {
        const spec = series.find((s: SeriesSpec) => s.key === entry.dataKey);
        const entryUnit: MetricUnit = spec?.unit ?? (spec?.axis === 'right' ? (rightUnit ?? unit) : unit);
        return (
          <p key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: entry.color }} />
              {spec?.label ?? entry.dataKey}
            </span>
            <span className="tnum font-semibold text-ink-900 dark:text-ink-100">
              {entry.value === null || entry.value === undefined ? 'n/a' : formatMetric(entry.value, entryUnit, ctx ?? {})}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function hasData(data: BaseProps['data'], series: SeriesSpec[]): boolean {
  return data.some((row) => series.some((s) => typeof row[s.key] === 'number'));
}

function commonAxes(unit: MetricUnit, rightUnit: MetricUnit | undefined, needsRight: boolean) {
  return (
    <>
      <CartesianGrid strokeDasharray="2 4" stroke={gridStroke} className="text-ink-200 dark:text-ink-800" vertical={false} />
      <XAxis dataKey="period" tick={axisStyle} tickLine={false} axisLine={{ stroke: 'currentColor', strokeOpacity: 0.2 }} className="text-ink-500 dark:text-ink-400" />
      <YAxis yAxisId="left" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={tickFormatter(unit)} width={52} className="text-ink-500 dark:text-ink-400" />
      {needsRight && (
        <YAxis yAxisId="right" orientation="right" tick={axisStyle} tickLine={false} axisLine={false}
               tickFormatter={tickFormatter(rightUnit ?? unit)} width={52} className="text-ink-500 dark:text-ink-400" />
      )}
    </>
  );
}

export function FinancialChart({
  data, series, unit, ctx, height = 240, rightUnit, emptyMessage, stacked, reference,
}: BaseProps) {
  if (!hasData(data, series)) {
    return (
      <EmptyState
        title="No data to chart"
        message={emptyMessage ?? 'The figures needed for this chart have not been entered, so nothing is shown rather than plotting zeros.'}
      />
    );
  }

  const needsRight = series.some((s) => s.axis === 'right');
  const tooltip = <Tooltip content={<ChartTooltip ctx={ctx} unit={unit} rightUnit={rightUnit} series={series} />} cursor={{ fill: 'currentColor', fillOpacity: 0.04 }} />;
  const legend = series.length > 1
    ? <Legend verticalAlign="top" align="right" iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} formatter={(value) => series.find((s) => s.key === value)?.label ?? value} />
    : null;

  const allBars = series.every((s) => s.type === 'bar');
  const allLines = series.every((s) => !s.type || s.type === 'line');
  const allAreas = series.every((s) => s.type === 'area');

  if (allBars) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: needsRight ? 4 : 8, left: 0, bottom: 0 }}>
          {commonAxes(unit, rightUnit, needsRight)}
          {tooltip}{legend}
          {reference && <ReferenceLine yAxisId="left" y={reference.value} stroke={CHART_COLORS.caution} strokeDasharray="4 4"
                                       label={{ value: reference.label, fontSize: 10, fill: CHART_COLORS.caution, position: 'insideTopRight' }} />}
          {series.map((s, i) => (
            <Bar key={s.key} yAxisId={s.axis ?? 'left'} dataKey={s.key} name={s.key} radius={[2, 2, 0, 0]}
                 stackId={stacked ? 'stack' : undefined} fill={s.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (allAreas) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: needsRight ? 4 : 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => {
              const color = s.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length]!;
              return (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          {commonAxes(unit, rightUnit, needsRight)}
          {tooltip}{legend}
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length]!;
            return (
              <Area key={s.key} yAxisId={s.axis ?? 'left'} dataKey={s.key} name={s.key} type="monotone"
                    stroke={color} strokeWidth={2} fill={`url(#grad-${s.key})`} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: color }} />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (allLines) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: needsRight ? 4 : 8, left: 0, bottom: 0 }}>
          {commonAxes(unit, rightUnit, needsRight)}
          {tooltip}{legend}
          {reference && <ReferenceLine yAxisId="left" y={reference.value} stroke={CHART_COLORS.caution} strokeDasharray="4 4"
                                       label={{ value: reference.label, fontSize: 10, fill: CHART_COLORS.caution, position: 'insideTopRight' }} />}
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length]!;
            return (
              <Line key={s.key} yAxisId={s.axis ?? 'left'} dataKey={s.key} name={s.key} type="monotone"
                    stroke={color} strokeWidth={2} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: color }} activeDot={{ r: 4 }} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Mixed chart: bars for levels, lines for rates laid over them.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: needsRight ? 4 : 8, left: 0, bottom: 0 }}>
        {commonAxes(unit, rightUnit, needsRight)}
        {tooltip}{legend}
        {reference && <ReferenceLine yAxisId="left" y={reference.value} stroke={CHART_COLORS.caution} strokeDasharray="4 4"
                                     label={{ value: reference.label, fontSize: 10, fill: CHART_COLORS.caution, position: 'insideTopRight' }} />}
        {series.map((s, i) => {
          const color = s.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length]!;
          if (s.type === 'bar') {
            return <Bar key={s.key} yAxisId={s.axis ?? 'left'} dataKey={s.key} name={s.key} fill={color} radius={[2, 2, 0, 0]} stackId={stacked ? 'stack' : undefined} />;
          }
          return (
            <Line key={s.key} yAxisId={s.axis ?? 'left'} dataKey={s.key} name={s.key} type="monotone"
                  stroke={color} strokeWidth={2} connectNulls dot={{ r: 2.5, strokeWidth: 0, fill: color }} />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** A compact inline trend line for use inside table rows. */
export function Sparkline({ values, tone = 'accent' }: { values: (number | null)[]; tone?: 'accent' | 'positive' | 'negative' }) {
  const points = values.filter((v): v is number => typeof v === 'number');
  if (points.length < 2) return <span className="text-2xs text-ink-400">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const width = 64;
  const height = 18;
  const step = width / (points.length - 1);
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');

  const stroke = tone === 'positive' ? CHART_COLORS.positive : tone === 'negative' ? CHART_COLORS.negative : CHART_COLORS.secondary;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle" aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
