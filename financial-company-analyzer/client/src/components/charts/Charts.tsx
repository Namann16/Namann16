import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { MetricUnit } from '@fca/core';
import { CHROME, seriesColor, STATUS_COLORS, currentMode, type ChartMode } from '../../lib/chartTheme';
import { compactNumber, formatMetric } from '../../lib/display';
import { EmptyState } from '../ui/primitives';

/**
 * Chart primitives.
 *
 * Deliberately there is no second y-axis. Plotting two different scales on one plot invents a
 * correlation the data does not contain: the alignment of the two axes is arbitrary, so the reader
 * sees a relationship that is an artefact of the chosen scales. Where a level and a rate belong
 * together — revenue and its growth rate, debt and its leverage multiple — they are drawn as a
 * pair of charts sharing an x-axis (`ChartPair`), which shows the same relationship honestly.
 *
 * Periods where a metric could not be calculated are dropped rather than plotted as zero, so a gap
 * in the data never reads as a collapse in the value.
 */

/** Re-renders charts when the light/dark class changes, so colours follow the theme. */
export function useChartMode(): ChartMode {
  const [mode, setMode] = useState<ChartMode>(currentMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

export interface ChartContext {
  currency?: string;
  units?: 'units' | 'thousands' | 'lakhs' | 'millions' | 'crores' | 'billions';
}

export interface SeriesSpec {
  key: string;
  label: string;
  /** Fixed slot index. Pass it explicitly so a series keeps its colour when others are removed. */
  slot?: number;
  color?: string;
  type?: 'line' | 'bar' | 'area';
}

interface ChartProps {
  data: Record<string, string | number | null>[];
  series: SeriesSpec[];
  /** Every series on a chart shares one unit — that is what makes a single axis correct. */
  unit: MetricUnit;
  ctx?: ChartContext;
  height?: number;
  emptyMessage?: string;
  stacked?: boolean;
  /** A threshold line, e.g. a configured leverage limit. Drawn in the warning status colour. */
  reference?: { value: number; label: string };
}

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

function hasData(data: ChartProps['data'], series: SeriesSpec[]): boolean {
  return data.some((row) => series.some((s) => typeof row[s.key] === 'number'));
}

function colourFor(spec: SeriesSpec, index: number, mode: ChartMode): string {
  return spec.color ?? seriesColor(mode, spec.slot ?? index);
}

function ChartTooltip({ active, payload, label, ctx, unit, series, mode }: any) {
  if (!active || !payload?.length) return null;
  const chrome = CHROME[mode as ChartMode];
  return (
    <div
      className="rounded-lg border px-3 py-2 text-[12px] shadow-raised"
      style={{ background: chrome.surface, borderColor: chrome.grid }}
    >
      <p className="mb-1.5 font-semibold" style={{ color: chrome.label }}>{label}</p>
      {payload.map((entry: any) => {
        const spec = series.find((s: SeriesSpec) => s.key === entry.dataKey);
        return (
          <p key={entry.dataKey} className="flex items-center justify-between gap-5 leading-relaxed">
            <span className="flex items-center gap-1.5" style={{ color: chrome.tick }}>
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: entry.color }} />
              {spec?.label ?? entry.dataKey}
            </span>
            <span className="tnum font-semibold" style={{ color: chrome.label }}>
              {entry.value === null || entry.value === undefined ? 'n/a' : formatMetric(entry.value, unit, ctx ?? {})}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function FinancialChart({
  data, series, unit, ctx, height = 240, emptyMessage, stacked, reference,
}: ChartProps) {
  const mode = useChartMode();
  const chrome = CHROME[mode];
  const [showTable, setShowTable] = useState(false);
  const chartId = useId().replace(/:/g, '');

  if (!hasData(data, series)) {
    return (
      <EmptyState
        title="No data to chart"
        message={emptyMessage ?? 'The figures needed for this chart have not been entered, so nothing is shown rather than plotting zeros.'}
      />
    );
  }

  const axisTick = { fontSize: 11, fill: chrome.tick };

  const axes = (
    <>
      {/* Solid hairlines, one shade off the surface: recessive, never dashed. */}
      <CartesianGrid stroke={chrome.grid} strokeWidth={1} vertical={false} />
      <XAxis
        dataKey="period" tick={axisTick} tickLine={false}
        axisLine={{ stroke: chrome.axis, strokeWidth: 1 }} dy={4}
        padding={{ left: 8, right: 8 }}
      />
      <YAxis
        tick={axisTick} tickLine={false} axisLine={false}
        tickFormatter={tickFormatter(unit)} width={54}
        // Keep a threshold inside the plot: a reference line beyond the data range would be
        // clipped away, leaving the caption promising a line the reader cannot see.
        domain={reference
          ? [(min: number) => Math.min(min, reference.value), (max: number) => Math.max(max, reference.value)]
          : undefined}
      />
    </>
  );

  const tooltip = (
    <Tooltip
      content={<ChartTooltip ctx={ctx} unit={unit} series={series} mode={mode} />}
      cursor={{ fill: chrome.grid, fillOpacity: 0.45 }}
    />
  );

  // A legend is present whenever identity matters — two or more series — so colour is never the
  // only thing distinguishing them. A single series is named by the card title instead.
  const legend = series.length > 1 ? (
    <Legend
      verticalAlign="top" align="right" iconType="square" iconSize={8}
      wrapperStyle={{ fontSize: 11, paddingBottom: 10, color: chrome.tick }}
      formatter={(value) => <span style={{ color: chrome.tick }}>{series.find((s) => s.key === value)?.label ?? value}</span>}
    />
  ) : null;

  const referenceLine = reference ? (
    <ReferenceLine
      y={reference.value} stroke={STATUS_COLORS.warning} strokeWidth={1.5}
      label={{ value: reference.label, fontSize: 10, fill: STATUS_COLORS.warning, position: 'insideTopRight' }}
    />
  ) : null;

  const margin = { top: 4, right: 10, left: 0, bottom: 0 };
  const allBars = series.every((s) => s.type === 'bar');
  const allAreas = series.every((s) => s.type === 'area');
  const allLines = series.every((s) => !s.type || s.type === 'line');

  const chart = allBars ? (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={margin} barGap={2} barCategoryGap="22%">
          {axes}{tooltip}{legend}{referenceLine}
          {series.map((s, i) => (
            <Bar
                key={s.key} dataKey={s.key} name={s.key} radius={[5, 5, 1, 1]}
              stackId={stacked ? 'stack' : undefined} fill={colourFor(s, i, mode)}
                minPointSize={2} animationDuration={500}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    ) : allAreas ? (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={margin}>
          <defs>
            {series.map((s, i) => {
              const colour = colourFor(s, i, mode);
              return (
                <linearGradient key={s.key} id={`fca-grad-${chartId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colour} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={colour} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          {axes}{tooltip}{legend}{referenceLine}
          {series.map((s, i) => {
            const colour = colourFor(s, i, mode);
            return (
              <Area
                key={s.key} dataKey={s.key} name={s.key} type="monotone"
                stroke={colour} strokeWidth={2.5} fill={`url(#fca-grad-${chartId}-${s.key})`}
                connectNulls dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: chrome.surface }}
                animationDuration={650}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    ) : allLines ? (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin}>
          {axes}{tooltip}{legend}{referenceLine}
          {series.map((s, i) => {
            const colour = colourFor(s, i, mode);
            return (
              <Line
                key={s.key} dataKey={s.key} name={s.key} type="monotone"
                stroke={colour} strokeWidth={2.5} connectNulls
                dot={{ r: 3, strokeWidth: 2, stroke: chrome.surface, fill: colour }}
                // A 2px surface ring keeps overlapping points readable where series cross.
                activeDot={{ r: 5, strokeWidth: 2, stroke: chrome.surface }}
                animationDuration={650}
                animationEasing="ease-out"
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    ) : (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={margin} barGap={2} barCategoryGap="22%">
        {axes}{tooltip}{legend}{referenceLine}
        {series.map((s, i) => {
          const colour = colourFor(s, i, mode);
          if (s.type === 'bar') {
            return (
              <Bar key={s.key} dataKey={s.key} name={s.key} fill={colour} radius={[3, 3, 0, 0]}
                     stackId={stacked ? 'stack' : undefined} minPointSize={2} animationDuration={500} />
            );
          }
          return (
            <Line key={s.key} dataKey={s.key} name={s.key} type="monotone" stroke={colour}
                  strokeWidth={2.5} connectNulls dot={{ r: 3, strokeWidth: 2, stroke: chrome.surface, fill: colour }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: chrome.surface }} animationDuration={650}
                  animationEasing="ease-out" />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );

  return (
    <div className="chart-frame">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          className="btn-ghost text-2xs"
          onClick={() => setShowTable((current) => !current)}
          aria-expanded={showTable}
        >
          {showTable ? 'Hide data table' : 'Show data table'}
        </button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto rounded bg-ink-500/[0.06] dark:bg-ink-400/[0.08]">
          <table className="fin-table text-[11px]">
            <caption className="sr-only">Data table for {series.map((item) => item.label).join(', ')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">Period</th>
                {series.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.period)}>
                  <th scope="row" className="text-left">{String(row.period)}</th>
                  {series.map((item) => {
                    const value = row[item.key];
                    return (
                      <td key={item.key} className="tnum">
                        {typeof value === 'number' ? formatMetric(value, unit, ctx ?? {}) : 'n/a'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : chart}
    </div>
  );
}

/**
 * Two charts over the same periods, stacked.
 *
 * This is the honest replacement for a dual-axis plot: a level and the rate derived from it keep
 * their own scales and their own axes, and the reader compares them by reading down the shared
 * x-axis rather than by trusting an arbitrary alignment of two y-scales.
 */
export function ChartPair({
  primary, secondary, ctx, height = 190,
}: {
  primary: { caption?: string; data: ChartProps['data']; series: SeriesSpec[]; unit: MetricUnit; stacked?: boolean };
  secondary: { caption?: string; data: ChartProps['data']; series: SeriesSpec[]; unit: MetricUnit; reference?: ChartProps['reference'] };
  ctx?: ChartContext;
  height?: number;
}) {
  return (
    <div className="space-y-3">
      <div>
        {primary.caption && <p className="label-caps mb-1">{primary.caption}</p>}
        <FinancialChart
          data={primary.data} series={primary.series} unit={primary.unit}
          ctx={ctx} height={height} {...(primary.stacked ? { stacked: true } : {})}
        />
      </div>
      <div className="border-t border-ink-100 pt-3 dark:border-ink-800/60">
        {secondary.caption && <p className="label-caps mb-1">{secondary.caption}</p>}
        <FinancialChart
          data={secondary.data} series={secondary.series} unit={secondary.unit}
          ctx={ctx} height={height} {...(secondary.reference ? { reference: secondary.reference } : {})}
        />
      </div>
    </div>
  );
}

/** A compact inline trend line for table rows. Decorative context, not a substitute for the value. */
export function Sparkline({
  values, tone = 'accent', redrawKey = 0,
}: {
  values: (number | null)[];
  tone?: 'accent' | 'positive' | 'negative';
  redrawKey?: number;
}) {
  const mode = useChartMode();
  const [hoverRedraw, setHoverRedraw] = useState(0);
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

  const stroke = tone === 'positive' ? STATUS_COLORS.good : tone === 'negative' ? STATUS_COLORS.critical : seriesColor(mode, 0);

  // A rough upper bound on the path length, used to seed the draw-in dash offset. It only has to
  // be at least as long as the path, so the line finishes drawing rather than stopping short.
  const dashLength = Math.ceil(width + height * points.length);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
      aria-hidden="true"
      onMouseEnter={() => setHoverRedraw((current) => current + 1)}
    >
      {/* The line draws itself left to right, which is the direction it is read in. */}
      <path
        key={`${redrawKey}-${hoverRedraw}`}
        className="draw-in"
        style={{ '--dash-length': dashLength } as CSSProperties}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChartNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-2xs leading-relaxed text-ink-500 dark:text-ink-400">{children}</p>;
}
