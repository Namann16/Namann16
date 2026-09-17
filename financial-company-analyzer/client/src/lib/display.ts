import {
  formatChange,
  formatCurrency,
  formatMetric,
  unitsLabel,
  type CompanyProfile,
  type MetricSeries,
  type MetricUnit,
  type MetricValue,
  type Num,
  type Sentiment,
  type Severity,
  type Trend,
} from '@fca/core';

/**
 * Display helpers.
 *
 * Formatting is re-exported from the engine rather than reimplemented, so a number renders
 * identically in the UI, the Excel export and the PDF report.
 */
export { formatChange, formatCurrency, formatMetric, unitsLabel };

export function fmtCtx(company: CompanyProfile | undefined) {
  return { currency: company?.currency ?? 'INR', units: company?.units ?? 'units' };
}

/** Render a metric point, falling back to an explicit "n/a" when it could not be calculated. */
export function renderMetric(point: MetricValue | null | undefined, ctx: { currency?: string; units?: never | CompanyProfile['units'] }): string {
  if (!point || point.status !== 'ok' || point.value === null) return 'n/a';
  return formatMetric(point.value, point.unit, ctx);
}

export function renderValue(value: Num, unit: MetricUnit, ctx: { currency?: string; units?: CompanyProfile['units'] }): string {
  return formatMetric(value, unit, ctx);
}

/**
 * Whether a move in a metric is favourable. Used only for colour; the written interpretation
 * always comes from the engine, never from this heuristic.
 */
export function changeTone(series: Pick<MetricSeries, 'change' | 'higherIsBetter'>): 'positive' | 'negative' | 'neutral' {
  if (series.change === null || series.change === 0) return 'neutral';
  const better = series.higherIsBetter ?? true;
  const good = series.change > 0 ? better : !better;
  return good ? 'positive' : 'negative';
}

export const TREND_LABEL: Record<Trend, string> = {
  improving: 'Improving',
  deteriorating: 'Deteriorating',
  stable: 'Stable',
  volatile: 'Volatile',
  insufficient_data: 'Insufficient data',
};

export const TREND_TONE: Record<Trend, 'positive' | 'negative' | 'neutral' | 'caution'> = {
  improving: 'positive',
  deteriorating: 'negative',
  stable: 'neutral',
  volatile: 'caution',
  insufficient_data: 'neutral',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export const SENTIMENT_TONE: Record<Sentiment, 'positive' | 'negative' | 'neutral' | 'caution'> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
  investigate: 'caution',
};

/** Compact axis labels: 1,720 -> 1.7k, 1,250,000 -> 1.3M. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(0)}k`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (abs >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

/** Turn a metric series into chart-ready rows, dropping periods where the metric is unavailable. */
export function toChartData(
  series: MetricSeries | undefined,
  options: { includeGaps?: boolean } = {},
): { period: string; value: number | null }[] {
  if (!series) return [];
  return series.points
    .map((p) => ({ period: p.period, value: p.status === 'ok' ? p.value : null }))
    .filter((row) => options.includeGaps || row.value !== null);
}

/** Combine several metric series onto one period axis. */
export function combineSeries(
  entries: { key: string; series: MetricSeries | undefined }[],
): Record<string, string | number | null>[] {
  const periods: string[] = [];
  for (const entry of entries) {
    for (const point of entry.series?.points ?? []) {
      if (!periods.includes(point.period)) periods.push(point.period);
    }
  }
  return periods.map((period) => {
    const row: Record<string, string | number | null> = { period };
    for (const entry of entries) {
      const point = entry.series?.points.find((p) => p.period === period);
      row[entry.key] = point && point.status === 'ok' ? point.value : null;
    }
    return row;
  });
}
