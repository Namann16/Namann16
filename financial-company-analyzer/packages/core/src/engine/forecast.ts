import type { AnalysisResult, MetricUnit, Num } from '../types.js';

export interface ForecastPoint {
  period: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastSeries {
  key: string;
  label: string;
  unit: MetricUnit;
  model: 'linear-trend';
  historicalPeriods: string[];
  points: ForecastPoint[];
  confidence: number;
  limitation: string;
}

const FORECASTS = [
  { key: 'revenue', label: 'Revenue', unit: 'currency' as const },
  { key: 'ebitda', label: 'EBITDA', unit: 'currency' as const },
  { key: 'freeCashFlow', label: 'Free cash flow', unit: 'currency' as const },
];

function regression(values: number[]) {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
  const slope = denominator === 0 ? 0 : values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const fitted = values.map((_, index) => intercept + slope * index);
  const residual = Math.sqrt(values.reduce((sum, value, index) => sum + (value - fitted[index]!) ** 2, 0) / n);
  return { slope, intercept, residual };
}

function periodLabel(last: string, offset: number): string {
  const match = last.match(/^(.*?)(\d{2,4})$/);
  if (!match) return `${last} +${offset}`;
  const yearText = match[2]!;
  const year = Number(yearText) + offset;
  const width = yearText.length;
  return `${match[1]!}${String(year).padStart(width, '0')}`;
}

export function buildForecasts(result: AnalysisResult, horizon = 3): ForecastSeries[] {
  const periods = result.periods.map((period) => period.label);
  if (periods.length < 3) return [];
  return FORECASTS.flatMap((definition) => {
    const metric = result.metrics[definition.key];
    if (!metric) return [];
    const values = metric.points.map((point) => point.value).filter((value): value is number => typeof value === 'number');
    if (values.length < 3) return [];
    const model = regression(values);
    const lastPeriod = periods[periods.length - 1]!;
    const points = Array.from({ length: horizon }, (_, index) => {
      const value = model.intercept + model.slope * (values.length + index);
      const margin = Math.max(model.residual * 1.96, Math.abs(value) * 0.03);
      return {
        period: periodLabel(lastPeriod, index + 1),
        value,
        lower: value - margin,
        upper: value + margin,
      };
    });
    return [{
      ...definition,
      model: 'linear-trend',
      historicalPeriods: metric.points.filter((point) => point.value !== null).map((point) => point.period),
      points,
      confidence: Math.min(0.95, 0.45 + values.length * 0.08),
      limitation: 'Trend extrapolation is directional, not a guarantee. Results are less reliable with fewer than five historical periods or structural business changes.',
    }];
  });
}
