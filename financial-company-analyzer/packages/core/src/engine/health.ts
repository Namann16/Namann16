import type {
  HealthFactor,
  HealthLabel,
  HealthPillar,
  HealthScore,
  Anomaly,
  MetricGroup,
  MetricSeries,
  Num,
  ThresholdConfig,
} from '../types.js';
import { clamp, isNum } from '../utils/number.js';
import { formatMetric } from '../utils/format.js';

/**
 * Explainable financial health framework.
 *
 * Each pillar is scored from a small number of named checks. Every check states the metric it
 * used, the value observed, the band it was scored against, and how many points it contributed.
 * Nothing is scored on an undisclosed basis, and a check with no data reduces coverage rather
 * than silently scoring zero — a company is never penalised for data the user did not supply.
 */

interface Check {
  label: string;
  metricKey: string;
  weight: number;
  /** Value at or below which the check scores 0; value at or above which it scores 1. Reversed when `lowerIsBetter`. */
  low: number;
  high: number;
  lowerIsBetter?: boolean;
  /** Use the trend of the series rather than its latest level. */
  useTrend?: boolean;
  explain: (value: Num, score: number) => string;
}

interface PillarSpec {
  key: MetricGroup;
  label: string;
  weight: number;
  checks: (t: ThresholdConfig) => Check[];
}

/** Linear score in [0,1] between the two band edges. */
function band(value: number, low: number, high: number, lowerIsBetter = false): number {
  if (high === low) return value >= high ? 1 : 0;
  const raw = (value - low) / (high - low);
  const score = clamp(raw, 0, 1);
  return lowerIsBetter ? 1 - score : score;
}

const TREND_SCORES: Record<string, number> = {
  improving: 1,
  stable: 0.6,
  volatile: 0.4,
  deteriorating: 0.15,
  insufficient_data: NaN,
};

const PILLARS: PillarSpec[] = [
  {
    key: 'growth',
    label: 'Growth',
    weight: 1,
    checks: (t) => [
      {
        label: 'Revenue growth', metricKey: 'revenueGrowth', weight: 2,
        low: t.revenueGrowthWeak, high: t.revenueGrowthStrong,
        explain: (v) => `Revenue growth of ${formatMetric(v, 'percent')} against a weak/strong band of ${t.revenueGrowthWeak}%–${t.revenueGrowthStrong}%.`,
      },
      {
        label: 'EBITDA growth', metricKey: 'ebitdaGrowth', weight: 1.5,
        low: 0, high: t.revenueGrowthStrong + 3,
        explain: (v) => `EBITDA growth of ${formatMetric(v, 'percent')}.`,
      },
      {
        label: 'Net income growth', metricKey: 'netIncomeGrowth', weight: 1,
        low: 0, high: t.revenueGrowthStrong + 3,
        explain: (v) => `Net income growth of ${formatMetric(v, 'percent')}.`,
      },
      {
        label: 'Revenue trend consistency', metricKey: 'revenue', weight: 1, useTrend: true,
        low: 0, high: 1,
        explain: (_v, s) => `The multi-period revenue trend scored ${(s * 100).toFixed(0)}/100 for direction and consistency.`,
      },
    ],
  },
  {
    key: 'profitability',
    label: 'Profitability',
    weight: 1.25,
    checks: (t) => [
      {
        label: 'EBITDA margin', metricKey: 'ebitdaMargin', weight: 2,
        low: 5, high: 25,
        explain: (v) => `EBITDA margin of ${formatMetric(v, 'percent')} scored against a 5%–25% band.`,
      },
      {
        label: 'Net profit margin', metricKey: 'netMargin', weight: 1.5,
        low: 0, high: 15,
        explain: (v) => `Net margin of ${formatMetric(v, 'percent')} scored against a 0%–15% band.`,
      },
      {
        label: 'Gross margin', metricKey: 'grossMargin', weight: 1,
        low: 15, high: 50,
        explain: (v) => `Gross margin of ${formatMetric(v, 'percent')}.`,
      },
      {
        label: 'EBITDA margin trend', metricKey: 'ebitdaMargin', weight: 1.5, useTrend: true,
        low: 0, high: 1,
        explain: (_v, s) => `The direction of EBITDA margin over the period scored ${(s * 100).toFixed(0)}/100.`,
      },
    ],
  },
  {
    key: 'liquidity',
    label: 'Liquidity',
    weight: 1,
    checks: (t) => [
      {
        label: 'Current ratio', metricKey: 'currentRatio', weight: 2,
        low: Math.max(t.currentRatioLow * 0.6, 0.4), high: t.currentRatioStrong,
        explain: (v) => `Current ratio of ${formatMetric(v, 'times')} against a ${t.currentRatioLow.toFixed(1)}x minimum and ${t.currentRatioStrong.toFixed(1)}x comfortable level.`,
      },
      {
        label: 'Quick ratio', metricKey: 'quickRatio', weight: 1.5,
        low: t.quickRatioLow * 0.6, high: t.quickRatioLow + 0.5,
        explain: (v) => `Quick ratio of ${formatMetric(v, 'times')} against a ${t.quickRatioLow.toFixed(1)}x threshold.`,
      },
      {
        label: 'Cash ratio', metricKey: 'cashRatio', weight: 1,
        low: 0.05, high: 0.5,
        explain: (v) => `Cash ratio of ${formatMetric(v, 'times')}.`,
      },
    ],
  },
  {
    key: 'solvency',
    label: 'Solvency & Leverage',
    weight: 1.25,
    checks: (t) => [
      {
        label: 'Net debt / EBITDA', metricKey: 'netDebtToEbitda', weight: 2.5,
        low: 0, high: t.netDebtToEbitdaCritical, lowerIsBetter: true,
        explain: (v) => `Net debt / EBITDA of ${formatMetric(v, 'times')} against an elevated level of ${t.netDebtToEbitdaHigh.toFixed(1)}x and a critical level of ${t.netDebtToEbitdaCritical.toFixed(1)}x.`,
      },
      {
        label: 'Interest coverage', metricKey: 'interestCoverage', weight: 2,
        low: t.interestCoverageCritical, high: t.interestCoverageLow * 2.5,
        explain: (v) => `Interest coverage of ${formatMetric(v, 'times')} against a ${t.interestCoverageLow.toFixed(1)}x threshold.`,
      },
      {
        label: 'Debt / equity', metricKey: 'debtToEquity', weight: 1.5,
        low: 0, high: t.debtToEquityHigh * 1.5, lowerIsBetter: true,
        explain: (v) => `Debt / equity of ${formatMetric(v, 'times')} against a ${t.debtToEquityHigh.toFixed(1)}x level treated as aggressive.`,
      },
    ],
  },
  {
    key: 'efficiency',
    label: 'Operating Efficiency',
    weight: 0.9,
    checks: () => [
      {
        label: 'Asset turnover', metricKey: 'assetTurnover', weight: 1.5,
        low: 0.3, high: 1.5,
        explain: (v) => `Asset turnover of ${formatMetric(v, 'times')}.`,
      },
      {
        label: 'Asset turnover trend', metricKey: 'assetTurnover', weight: 1, useTrend: true,
        low: 0, high: 1,
        explain: (_v, s) => `The direction of asset turnover scored ${(s * 100).toFixed(0)}/100.`,
      },
      {
        label: 'Cash conversion cycle trend', metricKey: 'cashConversionCycle', weight: 1.5, useTrend: true,
        low: 0, high: 1,
        explain: (_v, s) => `The direction of the cash conversion cycle scored ${(s * 100).toFixed(0)}/100 (a shortening cycle scores higher).`,
      },
      {
        label: 'Return on capital employed', metricKey: 'roce', weight: 1.5,
        low: 5, high: 20,
        explain: (v) => `ROCE of ${formatMetric(v, 'percent')}.`,
      },
    ],
  },
  {
    key: 'cashFlow',
    label: 'Cash Flow',
    weight: 1.25,
    checks: (t) => [
      {
        label: 'CFO / net income', metricKey: 'cfoToNetIncome', weight: 2,
        low: t.cfoToNetIncomeLow * 0.5, high: 1.2,
        explain: (v) => `CFO covered ${formatMetric(v, 'times')} of net income against a ${t.cfoToNetIncomeLow.toFixed(2)}x threshold.`,
      },
      {
        label: 'FCF margin', metricKey: 'fcfMargin', weight: 1.5,
        low: 0, high: 10,
        explain: (v) => `Free cash flow margin of ${formatMetric(v, 'percent')}.`,
      },
      {
        label: 'FCF / net income', metricKey: 'fcfConversion', weight: 1.5,
        low: t.fcfConversionLow * 0.5, high: 1,
        explain: (v) => `FCF converted ${formatMetric(v, 'times')} of net income against a ${t.fcfConversionLow.toFixed(2)}x threshold.`,
      },
      {
        label: 'CFO trend', metricKey: 'cfo', weight: 1, useTrend: true,
        low: 0, high: 1,
        explain: (_v, s) => `The direction of operating cash flow scored ${(s * 100).toFixed(0)}/100.`,
      },
    ],
  },
  {
    key: 'returns',
    label: 'Returns on Capital',
    weight: 1.1,
    checks: (t) => [
      {
        label: 'Return on equity', metricKey: 'roe', weight: 2,
        low: 0, high: t.roeStrong * 1.4,
        explain: (v) => `ROE of ${formatMetric(v, 'percent')} against a ${t.roeStrong.toFixed(0)}% level treated as strong.`,
      },
      {
        label: 'Return on invested capital', metricKey: 'roic', weight: 2,
        low: 0, high: t.roicStrong * 1.4,
        explain: (v) => `ROIC of ${formatMetric(v, 'percent')} against a ${t.roicStrong.toFixed(0)}% level treated as strong` +
          (isNum(v) ? `, and a ${t.roicHurdle.toFixed(0)}% indicative cost-of-capital hurdle.` : '.'),
      },
      {
        label: 'Return on assets', metricKey: 'roa', weight: 1,
        low: 0, high: 10,
        explain: (v) => `ROA of ${formatMetric(v, 'percent')}.`,
      },
    ],
  },
];

function labelForScore(score: number | null): HealthLabel {
  if (score === null) return 'Not rated';
  if (score >= 85) return 'Excellent';
  if (score >= 72) return 'Strong';
  if (score >= 58) return 'Healthy';
  if (score >= 44) return 'Watch';
  if (score >= 28) return 'Concern';
  return 'Critical';
}

export function scoreHealth(
  metrics: Record<string, MetricSeries>,
  thresholds: ThresholdConfig,
  anomalies: Anomaly[] = [],
): HealthScore {
  let unratedChecks = 0;

  const pillars: HealthPillar[] = PILLARS.map((spec) => {
    const checks = spec.checks(thresholds);
    const factors: HealthFactor[] = [];
    let weightedScore = 0;
    // Denominator of the weighted score: only checks actually scored against a band.
    let scoredWeight = 0;
    // Numerator of coverage: scored checks in full, explanation-set-aside checks in part.
    let coveredWeight = 0;
    let totalWeight = 0;
    let explainedChecks = 0;

    for (const check of checks) {
      totalWeight += check.weight;
      const series = metrics[check.metricKey];

      if (!series) { unratedChecks += 1; continue; }

      let score: number;
      let observed: Num = null;

      if (check.useTrend) {
        const t = TREND_SCORES[series.trend];
        if (t === undefined || Number.isNaN(t)) {
          unratedChecks += 1;
          factors.push({
            label: check.label,
            direction: 'neutral',
            detail: 'Not rated — not enough periods with data to establish a trend.',
            points: 0,
          });
          continue;
        }
        score = t;
      } else {
        const point = series.latest;
        if (!point || point.status !== 'ok' || !isNum(point.value)) {
          unratedChecks += 1;
          factors.push({
            label: check.label,
            direction: 'neutral',
            detail: `Not rated — ${point?.note ?? 'the metric could not be calculated from the data supplied.'}`,
            points: 0,
          });
          continue;
        }
        observed = point.value;
        score = band(point.value, check.low, check.high, check.lowerIsBetter);
      }

      // Post-explanation scoring. An anomaly on this metric is resolved by the explanation
      // engine before it reaches the score, never after — a value outside its generic band for
      // a cause that passed its test must not be scored as though the band applied.
      const relevant = anomalies.filter((anomaly) =>
        anomaly.metric === check.metricKey &&
        anomaly.period === (series.latest?.period ?? ''),
      );
      const benign = relevant.find((anomaly) => anomaly.status === 'explained_benign');
      const concerning = relevant.find((anomaly) => anomaly.status === 'explained_concerning');
      const unexplained = relevant.some((anomaly) => anomaly.status === 'unexplained');

      if (benign) {
        // The generic band is the wrong yardstick here, so the check is set aside rather than
        // scored. It counts as partial coverage: the metric was computed, but not assessable.
        const cause = benign.candidates.find((candidate) => candidate.evidence.passed);
        coveredWeight += check.weight * 0.5;
        explainedChecks += 1;
        factors.push({
          label: check.label,
          direction: 'neutral',
          detail:
            `${check.explain(observed, score)} This value sits outside the generic band, but ` +
            `${cause ? `“${cause.label}” passed its evidence test` : 'a structural cause was established'}` +
            ', so the band was not applied and this check was set aside rather than scored. ' +
            'The raw value is unchanged and shown above.',
          points: 0,
          anomalyStatus: 'explained',
          ...(cause ? { explanation: cause.label } : {}),
        });
        continue;
      }

      if (unexplained) score = Math.max(0, score - 0.25);

      weightedScore += score * check.weight;
      scoredWeight += check.weight;
      coveredWeight += check.weight;

      const concerningCause = concerning?.candidates.find((candidate) => candidate.evidence.passed);
      factors.push({
        label: check.label,
        direction: score >= 0.65 ? 'supports' : score <= 0.4 ? 'offsets' : 'neutral',
        detail:
          `${check.explain(observed, score)}` +
          (unexplained
            ? ' An unexplained anomaly reduced this score until the input or business cause is resolved.'
            : '') +
          (concerningCause
            ? ` “${concerningCause.label}” passed its evidence test and sharpens rather than softens this finding.`
            : ''),
        points: Math.round(score * check.weight * 10) / 10,
        ...(unexplained ? { anomalyStatus: 'unexplained' as const } : {}),
        ...(concerningCause ? { explanation: concerningCause.label } : {}),
      });
    }

    const score = scoredWeight > 0 ? Math.round((weightedScore / scoredWeight) * 100) : null;

    return {
      key: spec.key,
      label: spec.label,
      score,
      label_: labelForScore(score),
      weight: spec.weight,
      factors,
      coverage: totalWeight > 0 ? Math.round((coveredWeight / totalWeight) * 100) / 100 : 0,
      ...(explainedChecks > 0 ? { explainedChecks } : {}),
    };
  });

  const rated = pillars.filter((p) => p.score !== null);
  // Pillars with thin data carry less influence on the overall score, so a single check
  // standing in for a whole pillar cannot swing the headline assessment.
  const overall =
    rated.length === 0
      ? null
      : Math.round(
          rated.reduce((acc, p) => acc + (p.score as number) * p.weight * p.coverage, 0) /
            rated.reduce((acc, p) => acc + p.weight * p.coverage, 0),
        );

  return {
    overall,
    label: labelForScore(overall),
    pillars,
    unratedChecks,
    methodology:
      'Each pillar is scored from named checks, every one of which maps a metric onto a configurable band between a weak and a strong level. ' +
      'Checks with no data are reported as unrated and reduce the pillar’s coverage rather than scoring zero, so a company is never penalised for data that was not supplied. ' +
      'Where a value falls outside its generic band and the explanation engine found a tested structural cause, the band is not applied: the check is set aside, counts as partial coverage, and the raw value is still shown. ' +
      'Anomalies with no passing explanation are penalised instead. ' +
      'The overall score is the coverage-weighted average of the pillar scores. Every band edge is drawn from the threshold configuration and can be changed in Settings.',
  };
}

export { labelForScore };

/**
 * The band a metric is actually scored against, exposed so the anomaly engine can use the same
 * one rather than a parallel table.
 *
 * Keeping two band systems is how a company ends up rated "Critical" on a metric the explanation
 * engine considers unremarkable: the pillar scored HAL's asset turnover of 0.27x at the floor of
 * a 0.3–1.5x band while a separate anomaly table called 0.2–5x normal, so no explanation was ever
 * sought for the number driving the verdict. Level checks only — a trend check scores a direction,
 * not a level, and has no band a value can sit outside of.
 */
export function genericBandFor(
  metricKey: string,
  thresholds: ThresholdConfig,
): { band: [number, number]; lowerIsBetter: boolean } | null {
  for (const spec of PILLARS) {
    for (const check of spec.checks(thresholds)) {
      if (check.metricKey !== metricKey || check.useTrend) continue;
      const low = Math.min(check.low, check.high);
      const high = Math.max(check.low, check.high);
      return { band: [low, high], lowerIsBetter: Boolean(check.lowerIsBetter) };
    }
  }
  return null;
}
