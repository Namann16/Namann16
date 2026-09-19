import type {
  FinancialPeriod,
  IndustryKey,
  MetricGroup,
  MetricSeries,
  MetricValue,
  Num,
  MetricConfig,
} from '../types.js';
import { cagr, isNum, percentChange, round, subtract } from '../utils/number.js';
import { classifyTrend, makeMetric, notApplicable } from '../utils/metric.js';
import { METRIC_DEFINITIONS, METRIC_MAP, freeCashFlow } from './metricDefs.js';
import { industryProfile, suppressedMetricsFor } from './thresholds.js';
import { val } from './normalize.js';

/**
 * Compute every registered metric for every period and assemble them into series
 * with the derived change and trend. This is the only place metrics are produced —
 * no formula lives anywhere else in the application.
 */
export function calculateMetrics(
  periods: FinancialPeriod[],
  industry: IndustryKey | undefined,
  options: { reportingPeriod?: 'annual' | 'half_yearly' | 'quarterly'; annualizeInterimMetrics?: boolean; metricConfig?: MetricConfig } = {},
): Record<string, MetricSeries> {
  const suppressed = suppressedMetricsFor(industry);
  const industryNote = industryProfile(industry).label;
  const result: Record<string, MetricSeries> = {};

  for (const def of METRIC_DEFINITIONS) {
    const points: MetricValue[] = periods.map((period, index) => {
      const spec = {
        key: def.key,
        label: def.label,
        unit: def.unit,
        formula: def.formula,
        meaning: def.meaning,
        ...(def.higherIsBetter !== undefined ? { higherIsBetter: def.higherIsBetter } : {}),
        ...(def.polarity ? { polarity: def.polarity } : {}),
        ...(def.saturationThreshold !== undefined ? { saturationThreshold: def.saturationThreshold } : {}),
      };

      if (suppressed.has(def.key) || (def.supportedIndustries && !def.supportedIndustries.includes(industry ?? 'general'))) {
        return notApplicable(
          spec,
          period.label,
          def.supportedIndustries
            ? `This industry-specific metric is only supported for ${def.supportedIndustries.join(', ')} businesses.`
            : `This metric is not meaningful for a ${industryNote} business and has been suppressed by the industry configuration.`,
        );
      }

      const ctx = {
        current: period,
        prior: index > 0 ? periods[index - 1] : undefined,
        reportingPeriod: options.reportingPeriod,
        annualizeInterimMetrics: options.annualizeInterimMetrics,
        metricConfig: options.metricConfig,
      };
      const { value, inputs, note, denominatorBasis } = def.compute(ctx);
      return makeMetric(spec, period.label, value, inputs, {
        ...(note ? { note } : {}),
        ...(denominatorBasis ? { denominatorBasis } : {}),
      });
    });

    const usable = points.filter((p) => p.status === 'ok' && isNum(p.value));
    const latest = usable.length ? usable[usable.length - 1]! : null;
    const previous = usable.length > 1 ? usable[usable.length - 2]! : null;

    const change = latest && previous ? subtract(latest.value, previous.value) : null;
    const changePercent =
      latest && previous && !def.absoluteChangeOnly ? percentChange(previous.value, latest.value) : null;

    result[def.key] = {
      key: def.key,
      label: def.label,
      unit: def.unit,
      formula: def.formula,
      meaning: def.meaning,
      ...(def.higherIsBetter !== undefined ? { higherIsBetter: def.higherIsBetter } : {}),
      group: def.group,
      points,
      latest,
      previous,
      change: round(change, 4),
      changePercent: round(changePercent, 4),
      trend: classifyTrend(points.map((p) => p.value), def.higherIsBetter ?? true),
      ...(def.polarity ? { polarity: def.polarity } : {}),
    };
  }

  return result;
}

export function groupMetrics(metrics: Record<string, MetricSeries>): Record<MetricGroup, MetricSeries[]> {
  const groups: Record<MetricGroup, MetricSeries[]> = {
    growth: [], profitability: [], liquidity: [], solvency: [], efficiency: [],
    workingCapital: [], cashFlow: [], returns: [], perShare: [], valuation: [],
  };
  for (const series of Object.values(metrics)) groups[series.group].push(series);
  return groups;
}

interface CagrTarget {
  key: string;
  label: string;
  read: (p: FinancialPeriod) => Num;
}

const CAGR_TARGETS: CagrTarget[] = [
  { key: 'revenueCagr', label: 'Revenue CAGR', read: (p) => val(p, 'revenue') },
  { key: 'ebitdaCagr', label: 'EBITDA CAGR', read: (p) => val(p, 'ebitda') },
  { key: 'ebitCagr', label: 'EBIT CAGR', read: (p) => val(p, 'ebit') },
  { key: 'netIncomeCagr', label: 'Net Income CAGR', read: (p) => val(p, 'netIncome') },
  { key: 'epsCagr', label: 'EPS CAGR', read: (p) => val(p, 'basicEPS') },
  { key: 'cfoCagr', label: 'CFO CAGR', read: (p) => val(p, 'cfo') },
  { key: 'fcfCagr', label: 'FCF CAGR', read: (p) => freeCashFlow(p) },
  { key: 'totalAssetsCagr', label: 'Total Assets CAGR', read: (p) => val(p, 'totalAssets') },
  { key: 'equityCagr', label: 'Equity CAGR', read: (p) => val(p, 'totalEquity') },
];

/**
 * Compound annual growth rates across the longest span of periods for which both
 * endpoints are available and positive. A CAGR through a loss year has no real
 * solution, so it is reported as unavailable rather than approximated.
 */
export function calculateCagr(
  periods: FinancialPeriod[],
  options: { reportingPeriod?: 'annual' | 'half_yearly' | 'quarterly'; annualizeInterimMetrics?: boolean } = {},
): MetricValue[] {
  return CAGR_TARGETS.map((target) => {
    const spec = {
      key: target.key,
      label: target.label,
      unit: 'percent' as const,
      formula: '((Ending Value / Beginning Value) ^ (1 / number of years)) − 1',
      meaning: 'Average annual compound rate of growth over the period, smoothing year-to-year volatility.',
      higherIsBetter: true,
    };

    if (periods.length < 2) {
      return makeMetric(spec, 'period', null, {}, {
        status: 'insufficient_data',
        note: 'At least two periods of data are required to calculate a compound growth rate.',
      });
    }

    const series = periods.map((p) => ({ label: p.label, value: target.read(p) }));
    const firstIdx = series.findIndex((s) => isNum(s.value) && (s.value as number) > 0);
    let lastIdx = -1;
    for (let i = series.length - 1; i > firstIdx; i -= 1) {
      if (isNum(series[i]!.value) && (series[i]!.value as number) > 0) { lastIdx = i; break; }
    }

    if (firstIdx === -1 || lastIdx === -1) {
      const anyNegative = series.some((s) => isNum(s.value) && (s.value as number) <= 0);
      return makeMetric(spec, 'period', null, {}, {
        status: 'insufficient_data',
        note: anyNegative
          ? 'A compound growth rate cannot be calculated because the series contains zero or negative values.'
          : 'Insufficient data to calculate a compound growth rate for this measure.',
      });
    }

    const begin = series[firstIdx]!;
    const end = series[lastIdx]!;
    const factor = options.annualizeInterimMetrics
      ? options.reportingPeriod === 'quarterly' ? 4 : options.reportingPeriod === 'half_yearly' ? 2 : 1
      : 1;
    const years = (lastIdx - firstIdx) / factor;

    return makeMetric(
      { ...spec, label: `${target.label} (${begin.label}–${end.label})` },
      `${begin.label}–${end.label}`,
      cagr(begin.value, end.value, years),
      {
        [`${begin.label} (beginning)`]: begin.value,
        [`${end.label} (ending)`]: end.value,
        years,
      },
      years < periods.length - 1 / factor
        ? { note: `Computed over ${years} year(s); interim periods were annualized using a ${factor}x factor.` }
        : {},
    );
  });
}

/** Look up a metric value for a specific period label. */
export function metricAt(series: MetricSeries | undefined, period: string): MetricValue | null {
  if (!series) return null;
  return series.points.find((p) => p.period === period) ?? null;
}

export function valueAt(metrics: Record<string, MetricSeries>, key: string, period: string): Num {
  const point = metricAt(metrics[key], period);
  return point && point.status === 'ok' ? point.value : null;
}

export function latestValue(metrics: Record<string, MetricSeries>, key: string): Num {
  return metrics[key]?.latest?.value ?? null;
}

export { METRIC_MAP };
