import type {
  CompanyProfile,
  DuPontAnalysis,
  Evidence,
  ExecutiveSummary,
  FinancialPeriod,
  Flag,
  HealthScore,
  Insight,
  MetricSeries,
  MetricValue,
  Num,
  Sentiment,
  ThresholdConfig,
} from '../types.js';
import { isNum } from '../utils/number.js';
import { formatCurrency, formatMetric } from '../utils/format.js';
import { trendLabel } from '../utils/metric.js';
import { val } from './normalize.js';

export interface InsightContext {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  metrics: Record<string, MetricSeries>;
  cagr: MetricValue[];
  duPont: DuPontAnalysis;
  health: HealthScore;
  redFlags: Flag[];
  positiveSignals: Flag[];
  thresholds: ThresholdConfig;
}

const INSUFFICIENT = 'Insufficient data to perform this analysis.';

function fmtCtx(company: CompanyProfile) {
  return { currency: company.currency, units: company.units };
}

function usable(series: MetricSeries | undefined): MetricValue[] {
  return (series?.points ?? []).filter((p) => p.status === 'ok' && isNum(p.value));
}

function latestOk(metrics: Record<string, MetricSeries>, key: string): Num {
  const p = metrics[key]?.latest;
  return p && p.status === 'ok' ? p.value : null;
}
function prevOk(metrics: Record<string, MetricSeries>, key: string): Num {
  const p = metrics[key]?.previous;
  return p && p.status === 'ok' ? p.value : null;
}
function cagrOf(list: MetricValue[], key: string): MetricValue | undefined {
  return list.find((c) => c.key === key && c.status === 'ok' && isNum(c.value));
}

function seriesEvidence(
  series: MetricSeries | undefined,
  company: CompanyProfile,
  limit = 6,
): Evidence {
  const points = usable(series).slice(-limit);
  return {
    formula: series?.formula,
    lines: points.map((p) => ({
      label: `${series?.label ?? ''} ${p.period}`.trim(),
      display: formatMetric(p.value, p.unit, fmtCtx(company)),
      value: p.value,
      unit: p.unit,
      period: p.period,
    })),
  };
}

/**
 * Convert calculated metrics into analyst-style written insights.
 *
 * Every narrative here is generated from values the deterministic engine produced, and each one
 * carries the evidence that supports it. Where the data does not establish causality the wording
 * is hedged ("may indicate", "warrants investigation") rather than asserting a cause.
 */
export function buildInsights(ctx: InsightContext): Insight[] {
  const insights: Insight[] = [];
  const { metrics, company, cagr, duPont, thresholds } = ctx;
  const f = fmtCtx(company);

  /* ---------------- Growth and operating leverage ---------------- */
  const revenueCagr = cagrOf(cagr, 'revenueCagr');
  const ebitdaCagr = cagrOf(cagr, 'ebitdaCagr');
  const netIncomeCagr = cagrOf(cagr, 'netIncomeCagr');

  if (revenueCagr) {
    const revValue = revenueCagr.value as number;
    let narrative = `Revenue has compounded at ${revValue.toFixed(1)}% a year over ${revenueCagr.period}`;
    let sentiment: Sentiment = revValue >= thresholds.revenueGrowthStrong ? 'positive' : revValue < thresholds.revenueGrowthWeak ? 'negative' : 'neutral';

    if (ebitdaCagr) {
      const ebValue = ebitdaCagr.value as number;
      const gap = ebValue - revValue;
      if (gap > 2) {
        narrative += `, while EBITDA has compounded at ${ebValue.toFixed(1)}%. Profit growing ${gap.toFixed(1)} percentage points faster than sales indicates operating leverage: a portion of the cost base is fixed and is being spread across a larger revenue base`;
        sentiment = 'positive';
      } else if (gap < -2) {
        narrative += `, but EBITDA has compounded at only ${ebValue.toFixed(1)}%. Profit growing ${Math.abs(gap).toFixed(1)} percentage points slower than sales means the cost base is expanding faster than revenue, which may indicate input cost pressure, price discounting, or an adverse shift in sales mix`;
        sentiment = 'negative';
      } else {
        narrative += `, with EBITDA compounding at a similar ${ebValue.toFixed(1)}%. Margins have therefore been broadly held rather than expanded or eroded`;
      }
    }
    narrative += '.';

    if (netIncomeCagr && revenueCagr) {
      narrative += ` Net income has compounded at ${(netIncomeCagr.value as number).toFixed(1)}% over the same span.`;
    }

    insights.push({
      id: 'growth.cagr',
      title: 'Multi-year growth and operating leverage',
      narrative,
      sentiment,
      importance: 92,
      category: 'growth',
      evidence: {
        formula: 'CAGR = ((Ending Value / Beginning Value) ^ (1 / years)) − 1',
        lines: [
          ...Object.entries(revenueCagr.inputs).map(([label, value]) => ({
            label: `Revenue: ${label}`,
            display: typeof value === 'number' && label === 'years' ? String(value) : formatCurrency(value, f),
            value,
          })),
          { label: 'Revenue CAGR', display: formatMetric(revenueCagr.value, 'percent'), value: revenueCagr.value, unit: 'percent' },
          ...(ebitdaCagr ? [{ label: 'EBITDA CAGR', display: formatMetric(ebitdaCagr.value, 'percent'), value: ebitdaCagr.value, unit: 'percent' as const }] : []),
          ...(netIncomeCagr ? [{ label: 'Net income CAGR', display: formatMetric(netIncomeCagr.value, 'percent'), value: netIncomeCagr.value, unit: 'percent' as const }] : []),
        ],
        conclusion: ebitdaCagr
          ? `EBITDA CAGR of ${(ebitdaCagr.value as number).toFixed(1)}% versus revenue CAGR of ${revValue.toFixed(1)}%: a gap of ${((ebitdaCagr.value as number) - revValue).toFixed(1)} percentage points.`
          : undefined,
      },
    });
  } else if (ctx.periods.length < 2) {
    insights.push({
      id: 'growth.cagr',
      title: 'Multi-year growth',
      narrative: `${INSUFFICIENT} At least two periods of revenue data are required to measure growth.`,
      sentiment: 'neutral',
      importance: 50,
      category: 'growth',
      evidence: { lines: [] },
    });
  }

  /* ---------------- Margin structure ---------------- */
  const ebitdaMarginPoints = usable(metrics['ebitdaMargin']);
  if (ebitdaMarginPoints.length >= 2) {
    const first = ebitdaMarginPoints[0]!;
    const last = ebitdaMarginPoints[ebitdaMarginPoints.length - 1]!;
    const move = (last.value as number) - (first.value as number);
    const yoy = isNum(latestOk(metrics, 'ebitdaMargin')) && isNum(prevOk(metrics, 'ebitdaMargin'))
      ? (latestOk(metrics, 'ebitdaMargin') as number) - (prevOk(metrics, 'ebitdaMargin') as number)
      : null;
    const grossMove = (() => {
      const gp = usable(metrics['grossMargin']);
      if (gp.length < 2) return null;
      return (gp[gp.length - 1]!.value as number) - (gp[0]!.value as number);
    })();

    let narrative =
      `EBITDA margin stands at ${formatMetric(last.value, 'percent')} in ${last.period}, ` +
      (isNum(yoy) ? `${yoy >= 0 ? 'up' : 'down'} ${Math.abs(yoy).toFixed(1)} percentage points year on year and ` : '') +
      `${move >= 0 ? 'up' : 'down'} ${Math.abs(move).toFixed(1)} percentage points from ${formatMetric(first.value, 'percent')} in ${first.period}.`;

    if (isNum(grossMove)) {
      if (move > 0 && grossMove <= 0) {
        narrative += ` Gross margin moved ${grossMove >= 0 ? 'up' : 'down'} ${Math.abs(grossMove).toFixed(1)} percentage points over the same span, so the improvement at the EBITDA level appears to come from operating cost control rather than from pricing or input costs.`;
      } else if (move > 0 && grossMove > 0) {
        narrative += ` Gross margin also improved, by ${grossMove.toFixed(1)} percentage points, which suggests the gain originates in pricing or input costs rather than in overhead alone.`;
      } else if (move < 0 && grossMove < 0) {
        narrative += ` Gross margin fell ${Math.abs(grossMove).toFixed(1)} percentage points over the same span, pointing to pressure at the cost-of-goods level rather than in overheads.`;
      }
    }

    narrative += ` The trend across the period is ${trendLabel(metrics['ebitdaMargin']!.trend).toLowerCase()}.`;

    insights.push({
      id: 'profitability.margins',
      title: 'Operating margin structure',
      narrative,
      sentiment: move > thresholds.marginMaterialPp ? 'positive' : move < -thresholds.marginMaterialPp ? 'negative' : 'neutral',
      importance: 88,
      category: 'profitability',
      evidence: {
        formula: 'EBITDA / Revenue and Gross Profit / Revenue, tracked across the analysis period',
        lines: [
          ...ebitdaMarginPoints.map((p) => ({
            label: `EBITDA margin ${p.period}`,
            display: formatMetric(p.value, 'percent'),
            value: p.value, unit: 'percent' as const, period: p.period,
          })),
          ...usable(metrics['grossMargin']).map((p) => ({
            label: `Gross margin ${p.period}`,
            display: formatMetric(p.value, 'percent'),
            value: p.value, unit: 'percent' as const, period: p.period,
          })),
        ],
        conclusion: `EBITDA margin moved ${move >= 0 ? '+' : ''}${move.toFixed(1)} percentage points between ${first.period} and ${last.period}.`,
      },
    });
  }

  /* ---------------- Returns and DuPont ---------------- */
  if (duPont.attribution) {
    const a = duPont.attribution;
    insights.push({
      id: 'returns.dupont',
      title: 'What is driving return on equity',
      narrative: a.narrative,
      sentiment: !isNum(a.roeChange) ? 'neutral' : (a.roeChange as number) > 0 ? (a.primaryDriver === 'leverage' ? 'investigate' : 'positive') : 'negative',
      importance: 90,
      category: 'returns',
      evidence: a.evidence,
    });
  }

  const roic = latestOk(metrics, 'roic');
  if (isNum(roic)) {
    const above = roic - thresholds.roicHurdle;
    insights.push({
      id: 'returns.roic',
      title: 'Return on invested capital versus cost of capital',
      narrative:
        `ROIC stands at ${roic.toFixed(1)}% against the ${thresholds.roicHurdle.toFixed(0)}% indicative cost-of-capital hurdle set in the configuration, a spread of ${above >= 0 ? '+' : ''}${above.toFixed(1)} percentage points. ` +
        (above > 0
          ? 'On this basis the capital employed in the business is earning more than it costs, which means growth adds value rather than consuming it. Note that the hurdle is a configured assumption, not a measured cost of capital for this company.'
          : 'On this basis the capital employed is earning less than the configured cost of capital, which would mean growth consumes value rather than creating it. The hurdle is an assumption and should be set to a rate appropriate for this company before drawing a firm conclusion.'),
      sentiment: above > 0 ? 'positive' : 'investigate',
      importance: 84,
      category: 'returns',
      evidence: {
        formula: 'ROIC = NOPAT / Average Invested Capital, where NOPAT = EBIT × (1 − effective tax rate) and Invested Capital = Equity + Total Debt − Cash',
        lines: [
          ...Object.entries(metrics['roic']?.latest?.inputs ?? {}).map(([label, value]) => ({
            label,
            display: label.includes('rate') ? formatMetric(value, 'percent') : formatCurrency(value, f),
            value,
          })),
          { label: 'ROIC', display: formatMetric(roic, 'percent'), value: roic, unit: 'percent' },
          { label: 'Configured hurdle', display: formatMetric(thresholds.roicHurdle, 'percent'), value: thresholds.roicHurdle, unit: 'percent' },
        ],
        conclusion: `ROIC exceeds the configured hurdle by ${above.toFixed(1)} percentage points.`,
      },
    });
  }

  /* ---------------- Cash conversion ---------------- */
  const cfoSeries = usable(metrics['cfo']);
  const niSeries = usable(metrics['netIncomeValue']);
  if (cfoSeries.length >= 2 && niSeries.length >= 2) {
    const cfoLatest = cfoSeries[cfoSeries.length - 1]!;
    const conversion = latestOk(metrics, 'cfoToNetIncome');
    const fcf = latestOk(metrics, 'fcf');
    const fcfMargin = latestOk(metrics, 'fcfMargin');

    const narrative =
      `Operating cash flow of ${formatCurrency(cfoLatest.value, f)} in ${cfoLatest.period} ` +
      (isNum(conversion)
        ? `represents ${conversion.toFixed(2)}x reported net income. ` +
          (conversion >= 1
            ? 'Profit is more than fully converted into cash, which supports the quality of reported earnings. '
            : conversion >= thresholds.cfoToNetIncomeLow
              ? 'Conversion is below 1.0x but within the configured tolerance, which is common where the business is growing and absorbing working capital. '
              : 'Conversion is below the configured tolerance, which means a material part of reported profit did not arrive as cash this period. ')
        : 'could not be compared with net income for this period. ') +
      (isNum(fcf)
        ? `After capital expenditure the company generated free cash flow of ${formatCurrency(fcf, f)}` +
          (isNum(fcfMargin) ? `, an FCF margin of ${fcfMargin.toFixed(1)}%.` : '.')
        : '');

    insights.push({
      id: 'cashflow.conversion',
      title: 'Conversion of profit into cash',
      narrative,
      sentiment: isNum(conversion) ? (conversion >= 1 ? 'positive' : conversion >= thresholds.cfoToNetIncomeLow ? 'neutral' : 'negative') : 'neutral',
      importance: 86,
      category: 'cashFlow',
      evidence: {
        formula: 'CFO / Net Income, and Free Cash Flow = CFO − Capital Expenditure',
        lines: [
          ...cfoSeries.slice(-4).map((p) => ({
            label: `CFO ${p.period}`, display: formatCurrency(p.value, f), value: p.value, unit: 'currency' as const, period: p.period,
          })),
          ...niSeries.slice(-4).map((p) => ({
            label: `Net income ${p.period}`, display: formatCurrency(p.value, f), value: p.value, unit: 'currency' as const, period: p.period,
          })),
          ...usable(metrics['fcf']).slice(-4).map((p) => ({
            label: `Free cash flow ${p.period}`, display: formatCurrency(p.value, f), value: p.value, unit: 'currency' as const, period: p.period,
          })),
        ],
      },
    });
  } else {
    insights.push({
      id: 'cashflow.conversion',
      title: 'Conversion of profit into cash',
      narrative: `${INSUFFICIENT} Operating cash flow and net income are both required for at least two periods to assess cash conversion. Add CFO, CFI and CFF to unlock cash-flow analysis.`,
      sentiment: 'neutral',
      importance: 45,
      category: 'cashFlow',
      evidence: { lines: [] },
    });
  }

  /* ---------------- Working capital ---------------- */
  const cccPoints = usable(metrics['cashConversionCycle']);
  if (cccPoints.length >= 2) {
    const first = cccPoints[0]!;
    const last = cccPoints[cccPoints.length - 1]!;
    const move = (last.value as number) - (first.value as number);
    const dso = latestOk(metrics, 'dso');
    const dio = latestOk(metrics, 'dio');
    const dpo = latestOk(metrics, 'dpo');

    insights.push({
      id: 'workingCapital.cycle',
      title: 'Working-capital cycle',
      narrative:
        `The cash conversion cycle stands at ${(last.value as number).toFixed(0)} days in ${last.period}, ` +
        `${move === 0 ? 'unchanged from' : move > 0 ? `${move.toFixed(0)} days longer than` : `${Math.abs(move).toFixed(0)} days shorter than`} ${first.period}. ` +
        (isNum(dso) && isNum(dpo)
          ? `The current cycle comprises ${dso.toFixed(0)} days of receivables${isNum(dio) ? `, ${dio.toFixed(0)} days of inventory` : ''} less ${dpo.toFixed(0)} days of payables. `
          : '') +
        (move > thresholds.cccIncreaseDaysMaterial
          ? 'A lengthening cycle absorbs cash as the business grows and reduces the cash available from a given level of profit.'
          : move < -5
            ? 'A shortening cycle releases cash from operations and improves the cash return on each unit of revenue.'
            : 'The cycle has been broadly stable, so working capital is scaling in line with the business.'),
      sentiment: move > thresholds.cccIncreaseDaysMaterial ? 'negative' : move < -5 ? 'positive' : 'neutral',
      importance: 78,
      category: 'workingCapital',
      evidence: {
        formula: 'Cash Conversion Cycle = DSO + DIO − DPO',
        lines: [
          ...cccPoints.map((p) => ({
            label: `Cash conversion cycle ${p.period}`, display: formatMetric(p.value, 'days'), value: p.value, unit: 'days' as const, period: p.period,
          })),
          { label: 'DSO (latest)', display: formatMetric(dso, 'days'), value: dso, unit: 'days' },
          { label: 'DIO (latest)', display: formatMetric(dio, 'days'), value: dio, unit: 'days' },
          { label: 'DPO (latest)', display: formatMetric(dpo, 'days'), value: dpo, unit: 'days' },
        ],
        conclusion: `The cycle moved ${move >= 0 ? '+' : ''}${move.toFixed(0)} days between ${first.period} and ${last.period}.`,
      },
    });
  }

  /* ---------------- Leverage and liquidity ---------------- */
  const nde = latestOk(metrics, 'netDebtToEbitda');
  const ndePrev = prevOk(metrics, 'netDebtToEbitda');
  const coverage = latestOk(metrics, 'interestCoverage');
  if (isNum(nde) || isNum(coverage)) {
    const parts: string[] = [];
    if (isNum(nde)) {
      parts.push(
        `Net debt / EBITDA stands at ${nde.toFixed(2)}x` +
          (isNum(ndePrev) ? ` against ${ndePrev.toFixed(2)}x a year earlier, a ${nde > ndePrev ? 'increase' : 'reduction'} of ${Math.abs(nde - ndePrev).toFixed(2)}x` : '') +
          `, versus the ${thresholds.netDebtToEbitdaHigh.toFixed(1)}x level configured as elevated for this industry`,
      );
    }
    if (isNum(coverage)) {
      parts.push(`operating profit covers interest ${coverage.toFixed(2)}x against a ${thresholds.interestCoverageLow.toFixed(1)}x threshold`);
    }
    const sentiment: Sentiment =
      (isNum(nde) && nde > thresholds.netDebtToEbitdaHigh) || (isNum(coverage) && coverage < thresholds.interestCoverageLow)
        ? 'negative'
        : isNum(nde) && nde <= thresholds.netDebtToEbitdaHigh * 0.5
          ? 'positive'
          : 'neutral';

    insights.push({
      id: 'solvency.leverage',
      title: 'Balance sheet leverage and debt service',
      narrative:
        `${parts.join('; ')}. ` +
        (sentiment === 'negative'
          ? 'On these measures the balance sheet carries meaningful financial risk, and earnings volatility would translate quickly into pressure on covenants and refinancing terms.'
          : sentiment === 'positive'
            ? 'On these measures the balance sheet is conservatively funded and retains capacity to invest or absorb a downturn.'
            : 'On these measures leverage is within the configured tolerances for this industry.'),
      sentiment,
      importance: 85,
      category: 'solvency',
      evidence: {
        formula: 'Net Debt / EBITDA and EBIT / Interest Expense',
        lines: [
          ...usable(metrics['netDebt']).slice(-4).map((p) => ({
            label: `Net debt ${p.period}`, display: formatCurrency(p.value, f), value: p.value, unit: 'currency' as const, period: p.period,
          })),
          ...usable(metrics['netDebtToEbitda']).slice(-4).map((p) => ({
            label: `Net debt / EBITDA ${p.period}`, display: formatMetric(p.value, 'times'), value: p.value, unit: 'times' as const, period: p.period,
          })),
          ...usable(metrics['interestCoverage']).slice(-4).map((p) => ({
            label: `Interest coverage ${p.period}`, display: formatMetric(p.value, 'times'), value: p.value, unit: 'times' as const, period: p.period,
          })),
        ],
      },
    });
  }

  const currentRatio = latestOk(metrics, 'currentRatio');
  if (isNum(currentRatio)) {
    insights.push({
      id: 'liquidity.position',
      title: 'Short-term liquidity position',
      narrative:
        `The current ratio is ${currentRatio.toFixed(2)}x, meaning the company holds ${currentRatio.toFixed(2)} units of current assets for every unit of current liabilities falling due within the year. ` +
        (isNum(latestOk(metrics, 'quickRatio'))
          ? `Excluding inventory, the quick ratio is ${(latestOk(metrics, 'quickRatio') as number).toFixed(2)}x. `
          : '') +
        (currentRatio >= thresholds.currentRatioStrong
          ? 'Short-term obligations are comfortably covered.'
          : currentRatio >= thresholds.currentRatioLow
            ? 'Coverage is adequate but without a large buffer.'
            : 'Current liabilities exceed current assets, so the company depends on cash generation or committed facilities to meet obligations as they fall due.'),
      sentiment: currentRatio >= thresholds.currentRatioStrong ? 'positive' : currentRatio >= thresholds.currentRatioLow ? 'neutral' : 'negative',
      importance: 74,
      category: 'liquidity',
      evidence: seriesEvidence(metrics['currentRatio'], company),
    });
  }

  /* ---------------- Capital allocation ---------------- */
  const capexToCfo = latestOk(metrics, 'capexToCfo');
  const latestPeriod = ctx.periods[ctx.periods.length - 1];
  if (isNum(capexToCfo) && latestPeriod) {
    const dividends = val(latestPeriod, 'dividendsPaid');
    const buybacks = val(latestPeriod, 'shareBuybacks');
    insights.push({
      id: 'cashflow.capitalAllocation',
      title: 'Capital allocation',
      narrative:
        `Capital expenditure absorbed ${capexToCfo.toFixed(0)}% of operating cash flow in ${latestPeriod.label}. ` +
        (isNum(dividends) && Math.abs(dividends) > 0
          ? `Dividends of ${formatCurrency(Math.abs(dividends), f)} were paid. `
          : '') +
        (isNum(buybacks) && Math.abs(buybacks) > 0 ? `Share buybacks of ${formatCurrency(Math.abs(buybacks), f)} were undertaken. ` : '') +
        (capexToCfo > 100
          ? 'Investment exceeded internally generated cash, so the shortfall was funded from existing balances or external sources.'
          : capexToCfo > 60
            ? 'The business is reinvesting a substantial share of its operating cash, which limits near-term distributable cash but supports future capacity.'
            : 'A majority of operating cash remained after investment, leaving room for debt reduction or distributions.'),
      sentiment: 'neutral',
      importance: 70,
      category: 'cashFlow',
      evidence: {
        formula: 'Capex / CFO, alongside dividends and buybacks from the financing section',
        lines: [
          { label: 'CFO', display: formatCurrency(val(latestPeriod, 'cfo'), f), value: val(latestPeriod, 'cfo'), unit: 'currency', period: latestPeriod.label },
          { label: 'Capex', display: formatCurrency(val(latestPeriod, 'capex'), f), value: val(latestPeriod, 'capex'), unit: 'currency', period: latestPeriod.label },
          { label: 'Dividends paid', display: formatCurrency(dividends, f), value: dividends, unit: 'currency', period: latestPeriod.label },
          { label: 'Share buybacks', display: formatCurrency(buybacks, f), value: buybacks, unit: 'currency', period: latestPeriod.label },
          { label: 'Free cash flow', display: formatCurrency(latestOk(metrics, 'fcf'), f), value: latestOk(metrics, 'fcf'), unit: 'currency', period: latestPeriod.label },
        ],
      },
    });
  }

  return insights.sort((a, b) => b.importance - a.importance);
}

/* ------------------------------------------------------------------ */
/* Executive summary                                                  */
/* ------------------------------------------------------------------ */

function flagToInsight(flag: Flag, importance: number): Insight {
  return {
    id: `flag.${flag.id}`,
    title: flag.title,
    narrative: flag.detail,
    sentiment: flag.sentiment,
    importance,
    category: flag.category === 'dataQuality' || flag.category === 'accounting' ? 'accounting' : flag.category,
    evidence: flag.evidence,
  };
}

const SECTION_ORDER: { key: string; label: string; insightIds: string[]; group: string }[] = [
  { key: 'growth', label: 'Growth', insightIds: ['growth.cagr'], group: 'growth' },
  { key: 'profitability', label: 'Profitability', insightIds: ['profitability.margins'], group: 'profitability' },
  { key: 'liquidity', label: 'Liquidity', insightIds: ['liquidity.position'], group: 'liquidity' },
  { key: 'solvency', label: 'Solvency', insightIds: ['solvency.leverage'], group: 'solvency' },
  { key: 'workingCapital', label: 'Working Capital', insightIds: ['workingCapital.cycle'], group: 'workingCapital' },
  { key: 'cashFlow', label: 'Cash Flow', insightIds: ['cashflow.conversion'], group: 'cashFlow' },
  { key: 'returns', label: 'Capital Efficiency', insightIds: ['returns.dupont', 'returns.roic'], group: 'returns' },
];

/**
 * Build the executive summary. It prioritises the most material observations rather than
 * restating every ratio, and it never asserts anything the insight and flag engines did not
 * derive from the data.
 */
export function buildExecutiveSummary(ctx: InsightContext, insights: Insight[]): ExecutiveSummary {
  const { company, health, redFlags, positiveSignals, metrics, periods } = ctx;
  const f = fmtCtx(company);
  const latest = periods[periods.length - 1];

  if (periods.length === 0 || !latest) {
    return {
      headline: 'No financial data has been entered yet.',
      overallAssessment: 'Add at least one financial year of data — through the Excel import or the manual input grid — to generate an analysis.',
      strengths: [],
      concerns: [],
      sections: [],
      takeaways: [],
    };
  }

  const revenue = val(latest, 'revenue');
  const critical = redFlags.filter((r) => r.severity === 'critical' || r.severity === 'high');

  const headline =
    `${company.name} — ${health.label === 'Not rated' ? 'analysis based on the data supplied' : `overall financial health assessed as ${health.label}`}` +
    (isNum(revenue) ? ` on revenue of ${formatCurrency(revenue, f)} in ${latest.label}.` : ` for ${latest.label}.`);

  const overallParts: string[] = [];
  if (health.overall !== null) {
    const rated = health.pillars.filter((p) => p.score !== null).sort((a, b) => (b.score as number) - (a.score as number));
    const best = rated[0];
    const worst = rated[rated.length - 1];
    overallParts.push(
      `The framework scores overall financial health at ${health.overall}/100 (${health.label}), built from ${rated.length} rated pillars.`,
    );
    if (best && worst && best.key !== worst.key) {
      overallParts.push(
        `${best.label} is the strongest pillar at ${best.score}/100, while ${worst.label} is the weakest at ${worst.score}/100.`,
      );
    }
  } else {
    overallParts.push('There was not enough data to rate overall financial health. Add the missing line items flagged in Data Quality to enable scoring.');
  }
  if (critical.length > 0) {
    overallParts.push(
      `${critical.length} ${critical.length === 1 ? 'issue requires' : 'issues require'} attention, the most significant being: ${critical[0]!.title.toLowerCase()}.`,
    );
  } else if (redFlags.length > 0) {
    overallParts.push(`${redFlags.length} lower-severity ${redFlags.length === 1 ? 'observation was' : 'observations were'} raised for review.`);
  } else {
    overallParts.push('No rule in the risk engine was triggered by the data supplied.');
  }
  if (health.unratedChecks > 0) {
    overallParts.push(`${health.unratedChecks} scoring checks could not be evaluated for lack of data and were excluded rather than scored as zero.`);
  }

  const strengths = [
    ...positiveSignals.map((s, i) => flagToInsight(s, 80 - i)),
    ...insights.filter((i) => i.sentiment === 'positive'),
  ]
    .filter((v, i, arr) => arr.findIndex((x) => x.title === v.title) === i)
    .slice(0, 6);

  const concerns = [
    ...redFlags.map((r, i) => flagToInsight(r, 95 - i)),
    ...insights.filter((i) => i.sentiment === 'negative'),
  ]
    .filter((v, i, arr) => arr.findIndex((x) => x.title === v.title) === i)
    .slice(0, 6);

  const sections = SECTION_ORDER.map((section) => {
    const matched = section.insightIds.map((id) => insights.find((i) => i.id === id)).filter(Boolean) as Insight[];
    if (matched.length === 0) {
      return {
        key: section.key,
        label: section.label,
        body: `${INSUFFICIENT} The line items needed for ${section.label.toLowerCase()} analysis are not available for enough periods.`,
        sentiment: 'neutral' as Sentiment,
      };
    }
    const negative = matched.some((m) => m.sentiment === 'negative');
    const positive = matched.every((m) => m.sentiment === 'positive');
    return {
      key: section.key,
      label: section.label,
      body: matched.map((m) => m.narrative).join(' '),
      sentiment: (negative ? 'negative' : positive ? 'positive' : 'neutral') as Sentiment,
    };
  });

  const takeaways: string[] = [];
  const revGrowth = latestOk(metrics, 'revenueGrowth');
  const ebitdaMargin = latestOk(metrics, 'ebitdaMargin');
  const roe = latestOk(metrics, 'roe');
  const nde = latestOk(metrics, 'netDebtToEbitda');
  const fcf = latestOk(metrics, 'fcf');

  if (isNum(revGrowth) && isNum(ebitdaMargin)) {
    takeaways.push(
      `Revenue grew ${revGrowth.toFixed(1)}% in ${latest.label} at an EBITDA margin of ${ebitdaMargin.toFixed(1)}%.`,
    );
  }
  if (isNum(roe)) {
    const driver = ctx.duPont.attribution?.primaryDriver;
    takeaways.push(
      `ROE of ${roe.toFixed(1)}%` +
        (driver && driver !== 'none' ? `, with the latest change driven primarily by ${driver === 'margin' ? 'net profit margin' : driver === 'turnover' ? 'asset turnover' : 'financial leverage'}.` : '.'),
    );
  }
  if (isNum(nde)) {
    takeaways.push(`Net debt / EBITDA of ${nde.toFixed(2)}x against a configured elevated level of ${ctx.thresholds.netDebtToEbitdaHigh.toFixed(1)}x.`);
  }
  if (isNum(fcf)) {
    takeaways.push(`Free cash flow of ${formatCurrency(fcf, f)} after capital expenditure.`);
  }
  for (const flagItem of critical.slice(0, 2)) takeaways.push(flagItem.title + '.');

  return {
    headline,
    overallAssessment: overallParts.join(' '),
    strengths,
    concerns,
    sections,
    takeaways: takeaways.slice(0, 7),
  };
}

export { INSUFFICIENT };
