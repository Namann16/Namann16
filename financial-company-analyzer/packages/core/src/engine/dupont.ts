import type { DuPontAnalysis, DuPontPeriod, Evidence, FinancialPeriod, MetricSeries, Num } from '../types.js';
import { isNum, round } from '../utils/number.js';
import { formatMetric } from '../utils/format.js';
import { metricAt } from './calculate.js';

/**
 * Three-step DuPont decomposition:
 *
 *   ROE = Net Profit Margin × Asset Turnover × Equity Multiplier
 *
 * The identity holds because
 *   (NI / Revenue) × (Revenue / Assets) × (Assets / Equity) = NI / Equity.
 *
 * Note that the components use *average* balance-sheet values while the identity is exact only
 * on a consistent basis, so the product is reported alongside directly calculated ROE and any
 * material difference is surfaced rather than hidden.
 */
export function analyzeDuPont(
  periods: FinancialPeriod[],
  metrics: Record<string, MetricSeries>,
): DuPontAnalysis {
  const rows: DuPontPeriod[] = periods.map((period) => {
    const roe = metricAt(metrics['roe'], period.label);
    const margin = metricAt(metrics['netMargin'], period.label);
    const turnover = metricAt(metrics['assetTurnover'], period.label);
    const multiplier = metricAt(metrics['equityMultiplier'], period.label);

    const m = margin?.status === 'ok' ? margin.value : null;
    const t = turnover?.status === 'ok' ? turnover.value : null;
    const e = multiplier?.status === 'ok' ? multiplier.value : null;

    const reconstructed = isNum(m) && isNum(t) && isNum(e) ? m * t * e : null;
    const missing = [
      !isNum(m) ? 'net margin' : null,
      !isNum(t) ? 'asset turnover' : null,
      !isNum(e) ? 'equity multiplier' : null,
    ].filter(Boolean) as string[];

    return {
      period: period.label,
      roe: roe?.status === 'ok' ? roe.value : null,
      netMargin: m,
      assetTurnover: t,
      equityMultiplier: e,
      reconstructedRoe: round(reconstructed, 4),
      status: missing.length === 0 ? 'ok' : 'insufficient_data',
      ...(missing.length ? { note: `Insufficient data to decompose ROE: missing ${missing.join(', ')}.` } : {}),
    } satisfies DuPontPeriod;
  });

  return { periods: rows, attribution: buildAttribution(rows) };
}

/**
 * Attribute the change in ROE between the two most recent complete periods to its three drivers.
 *
 * Uses a sequential (chain) decomposition: each factor is moved from its prior to its current
 * value in turn, holding the not-yet-moved factors at prior values. The three effects sum
 * exactly to the total change in reconstructed ROE, so nothing is left unexplained.
 */
function buildAttribution(rows: DuPontPeriod[]): DuPontAnalysis['attribution'] {
  const complete = rows.filter((r) => r.status === 'ok');
  if (complete.length < 2) return null;

  const prior = complete[complete.length - 2]!;
  const current = complete[complete.length - 1]!;

  const m0 = prior.netMargin as number;
  const t0 = prior.assetTurnover as number;
  const e0 = prior.equityMultiplier as number;
  const m1 = current.netMargin as number;
  const t1 = current.assetTurnover as number;
  const e1 = current.equityMultiplier as number;

  const base = m0 * t0 * e0;
  const afterMargin = m1 * t0 * e0;
  const afterTurnover = m1 * t1 * e0;
  const afterLeverage = m1 * t1 * e1;

  const marginEffect = afterMargin - base;
  const turnoverEffect = afterTurnover - afterMargin;
  const leverageEffect = afterLeverage - afterTurnover;
  const roeChange = afterLeverage - base;

  const effects: { name: 'margin' | 'turnover' | 'leverage'; value: number; label: string }[] = [
    { name: 'margin', value: marginEffect, label: 'net profit margin' },
    { name: 'turnover', value: turnoverEffect, label: 'asset turnover' },
    { name: 'leverage', value: leverageEffect, label: 'financial leverage' },
  ];
  const dominant = effects.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
  const totalMagnitude = effects.reduce((acc, e) => acc + Math.abs(e.value), 0);
  const primaryDriver = totalMagnitude < 1e-9 ? 'none' : dominant.name;

  const direction = roeChange >= 0 ? 'increased' : 'declined';
  const share = totalMagnitude > 0 ? (Math.abs(dominant.value) / totalMagnitude) * 100 : 0;
  const alignsWithChange = Math.sign(dominant.value) === Math.sign(roeChange);

  const narrative =
    primaryDriver === 'none'
      ? `ROE was essentially unchanged between ${prior.period} and ${current.period}, with no single DuPont component moving materially.`
      : `ROE ${direction} from ${formatMetric(prior.roe ?? base, 'percent')} in ${prior.period} to ${formatMetric(current.roe ?? afterLeverage, 'percent')} in ${current.period}. ` +
        `The largest contributor was ${dominant.label}, which accounted for ${share.toFixed(0)}% of the total movement across the three components ` +
        `(${dominant.value >= 0 ? '+' : ''}${dominant.value.toFixed(2)} pp of ROE)` +
        (alignsWithChange
          ? `, ${roeChange >= 0 ? 'driving the improvement' : 'driving the decline'}.`
          : `, working against the overall ${roeChange >= 0 ? 'improvement' : 'decline'}.`) +
        (primaryDriver === 'leverage' && roeChange > 0
          ? ' Because the improvement is leverage-led rather than margin-led, it comes with higher balance-sheet risk rather than better underlying profitability.'
          : '');

  const evidence: Evidence = {
    formula: 'ROE = Net Profit Margin × Asset Turnover × Equity Multiplier. Each component is moved from its prior-period to its current-period value in turn, holding the remaining components at prior values.',
    lines: [
      { label: `${prior.period} net margin`, display: formatMetric(m0, 'percent'), value: m0, unit: 'percent', period: prior.period },
      { label: `${current.period} net margin`, display: formatMetric(m1, 'percent'), value: m1, unit: 'percent', period: current.period },
      { label: `${prior.period} asset turnover`, display: formatMetric(t0, 'times'), value: t0, unit: 'times', period: prior.period },
      { label: `${current.period} asset turnover`, display: formatMetric(t1, 'times'), value: t1, unit: 'times', period: current.period },
      { label: `${prior.period} equity multiplier`, display: formatMetric(e0, 'times'), value: e0, unit: 'times', period: prior.period },
      { label: `${current.period} equity multiplier`, display: formatMetric(e1, 'times'), value: e1, unit: 'times', period: current.period },
      { label: 'Effect of margin change', display: `${marginEffect >= 0 ? '+' : ''}${marginEffect.toFixed(2)} pp`, value: marginEffect, unit: 'percent' },
      { label: 'Effect of turnover change', display: `${turnoverEffect >= 0 ? '+' : ''}${turnoverEffect.toFixed(2)} pp`, value: turnoverEffect, unit: 'percent' },
      { label: 'Effect of leverage change', display: `${leverageEffect >= 0 ? '+' : ''}${leverageEffect.toFixed(2)} pp`, value: leverageEffect, unit: 'percent' },
    ],
    conclusion: `The three effects sum to ${roeChange >= 0 ? '+' : ''}${roeChange.toFixed(2)} pp, the total change in decomposed ROE.`,
  };

  return {
    from: prior.period,
    to: current.period,
    roeChange: round(roeChange, 4),
    marginEffect: round(marginEffect, 4),
    turnoverEffect: round(turnoverEffect, 4),
    leverageEffect: round(leverageEffect, 4),
    primaryDriver,
    narrative,
    evidence,
  };
}

/** Difference between decomposed and directly calculated ROE, used as a consistency check. */
export function dupontReconciliationGap(row: DuPontPeriod): Num {
  if (!isNum(row.roe) || !isNum(row.reconstructedRoe)) return null;
  return round(row.reconstructedRoe - row.roe, 4);
}
