import type {
  CompanyProfile,
  Evidence,
  EvidenceLine,
  FinancialPeriod,
  Flag,
  MetricSeries,
  MetricValue,
  Num,
  Severity,
  ThresholdConfig,
} from '../types.js';
import { isNum } from '../utils/number.js';
import { formatCurrency, formatMetric } from '../utils/format.js';
import { freeCashFlow, totalDebt } from './metricDefs.js';
import { val } from './normalize.js';

export interface RuleContext {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  metrics: Record<string, MetricSeries>;
  thresholds: ThresholdConfig;
  latestPeriod: string;
  fmtCtx: { currency: string; units: CompanyProfile['units'] };
}

export interface Rule {
  id: string;
  /** Human-readable description of the rule condition, shown in Settings. */
  description: string;
  kind: 'red_flag' | 'positive_signal';
  evaluate: (ctx: RuleContext) => Flag | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Latest usable point of a metric series. */
function latest(ctx: RuleContext, key: string): MetricValue | null {
  return ctx.metrics[key]?.latest ?? null;
}
function previous(ctx: RuleContext, key: string): MetricValue | null {
  return ctx.metrics[key]?.previous ?? null;
}
function latestVal(ctx: RuleContext, key: string): Num {
  const p = latest(ctx, key);
  return p && p.status === 'ok' ? p.value : null;
}
function prevVal(ctx: RuleContext, key: string): Num {
  const p = previous(ctx, key);
  return p && p.status === 'ok' ? p.value : null;
}

/** Usable points of a series, oldest first. */
function usablePoints(ctx: RuleContext, key: string): MetricValue[] {
  return (ctx.metrics[key]?.points ?? []).filter((p) => p.status === 'ok' && isNum(p.value));
}

function line(label: string, value: Num, unit: EvidenceLine['unit'], ctx: RuleContext, period?: string): EvidenceLine {
  const display = unit === 'currency'
    ? formatCurrency(value, ctx.fmtCtx)
    : formatMetric(value, unit ?? 'number', ctx.fmtCtx);
  return { label, display, value, ...(unit ? { unit } : {}), ...(period ? { period } : {}) };
}

function pp(value: Num, decimals = 1): string {
  if (!isNum(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)} pp`;
}

function flag(
  ctx: RuleContext,
  input: Omit<Flag, 'period'> & { period?: string },
): Flag {
  return { ...input, period: input.period ?? ctx.latestPeriod };
}

/* ------------------------------------------------------------------ */
/* Red flag rules                                                     */
/* ------------------------------------------------------------------ */

export const RED_FLAG_RULES: Rule[] = [
  {
    id: 'receivables_vs_revenue',
    kind: 'red_flag',
    description: 'Receivables growth exceeds revenue growth by more than the configured gap.',
    evaluate: (ctx) => {
      const revGrowth = latestVal(ctx, 'revenueGrowth');
      const recGrowth = latestVal(ctx, 'receivablesGrowth');
      if (!isNum(revGrowth) || !isNum(recGrowth)) return null;
      const gap = recGrowth - revGrowth;
      if (gap <= ctx.thresholds.receivablesVsRevenueGapPp) return null;

      const period = ctx.periods[ctx.periods.length - 1]!;
      const prior = ctx.periods[ctx.periods.length - 2];
      const dso = ctx.metrics['dso'];

      return flag(ctx, {
        id: 'receivables_vs_revenue',
        rule: 'Receivables growth vs revenue growth',
        title: 'Receivables are growing significantly faster than revenue',
        detail:
          `Receivables grew ${recGrowth.toFixed(1)}% against revenue growth of ${revGrowth.toFixed(1)}%, a gap of ${gap.toFixed(1)} percentage points. ` +
          `This may indicate slower collections, a shift towards customers on longer credit terms, or revenue recognised ahead of cash. ` +
          `It warrants investigation because it increases working-capital requirements and, if sustained, weakens the conversion of profit into cash.`,
        sentiment: 'negative',
        severity: gap > ctx.thresholds.receivablesVsRevenueGapPp * 2 ? 'high' : 'medium',
        category: 'workingCapital',
        thresholdUsed: { receivablesVsRevenueGapPp: ctx.thresholds.receivablesVsRevenueGapPp },
        evidence: {
          formula: 'Receivables growth − Revenue growth, both measured year on year',
          lines: [
            line(`Revenue ${prior?.label ?? 'prior'}`, val(prior, 'revenue'), 'currency', ctx, prior?.label),
            line(`Revenue ${period.label}`, val(period, 'revenue'), 'currency', ctx, period.label),
            line('Revenue growth', revGrowth, 'percent', ctx),
            line(`Receivables ${prior?.label ?? 'prior'}`, val(prior, 'accountsReceivable'), 'currency', ctx, prior?.label),
            line(`Receivables ${period.label}`, val(period, 'accountsReceivable'), 'currency', ctx, period.label),
            line('Receivables growth', recGrowth, 'percent', ctx),
            ...(dso?.latest?.status === 'ok'
              ? [line('Days sales outstanding', dso.latest.value, 'days', ctx, dso.latest.period)]
              : []),
          ],
          conclusion: `Receivables growth exceeds revenue growth by ${gap.toFixed(1)} percentage points, against a configured tolerance of ${ctx.thresholds.receivablesVsRevenueGapPp} pp.`,
        },
      });
    },
  },

  {
    id: 'inventory_vs_revenue',
    kind: 'red_flag',
    description: 'Inventory growth exceeds revenue growth by more than the configured gap.',
    evaluate: (ctx) => {
      const revGrowth = latestVal(ctx, 'revenueGrowth');
      const invGrowth = latestVal(ctx, 'inventoryGrowth');
      if (!isNum(revGrowth) || !isNum(invGrowth)) return null;
      const gap = invGrowth - revGrowth;
      if (gap <= ctx.thresholds.inventoryVsRevenueGapPp) return null;

      const period = ctx.periods[ctx.periods.length - 1]!;
      const prior = ctx.periods[ctx.periods.length - 2];
      return flag(ctx, {
        id: 'inventory_vs_revenue',
        rule: 'Inventory growth vs revenue growth',
        title: 'Inventory is building faster than sales',
        detail:
          `Inventory grew ${invGrowth.toFixed(1)}% while revenue grew ${revGrowth.toFixed(1)}%, a gap of ${gap.toFixed(1)} percentage points. ` +
          `This could suggest slowing demand, a deliberate stock build ahead of expected sales, or obsolescence risk. ` +
          `Inventory build absorbs cash, so the reason should be established before the position is judged.`,
        sentiment: 'negative',
        severity: gap > ctx.thresholds.inventoryVsRevenueGapPp * 2 ? 'high' : 'medium',
        category: 'workingCapital',
        thresholdUsed: { inventoryVsRevenueGapPp: ctx.thresholds.inventoryVsRevenueGapPp },
        evidence: {
          formula: 'Inventory growth − Revenue growth, both measured year on year',
          lines: [
            line(`Inventory ${prior?.label ?? 'prior'}`, val(prior, 'inventory'), 'currency', ctx, prior?.label),
            line(`Inventory ${period.label}`, val(period, 'inventory'), 'currency', ctx, period.label),
            line('Inventory growth', invGrowth, 'percent', ctx),
            line('Revenue growth', revGrowth, 'percent', ctx),
          ],
          conclusion: `Inventory growth exceeds revenue growth by ${gap.toFixed(1)} percentage points, against a configured tolerance of ${ctx.thresholds.inventoryVsRevenueGapPp} pp.`,
        },
      });
    },
  },

  {
    id: 'earnings_vs_cash_flow',
    kind: 'red_flag',
    description: 'Net income is growing while operating cash flow is declining.',
    evaluate: (ctx) => {
      const niGrowth = latestVal(ctx, 'netIncomeGrowth');
      const cfoGrowth = latestVal(ctx, 'cfoGrowth');
      if (!isNum(niGrowth) || !isNum(cfoGrowth)) return null;
      if (!(niGrowth > 0 && cfoGrowth < 0)) return null;

      const period = ctx.periods[ctx.periods.length - 1]!;
      const prior = ctx.periods[ctx.periods.length - 2];
      return flag(ctx, {
        id: 'earnings_vs_cash_flow',
        rule: 'Earnings growth vs operating cash flow growth',
        title: 'Earnings growth is not being accompanied by cash generation',
        detail:
          `Net income rose ${niGrowth.toFixed(1)}% while operating cash flow fell ${Math.abs(cfoGrowth).toFixed(1)}%. ` +
          `A divergence of this kind warrants investigation: it can arise from working-capital build, revenue recognised ahead of collection, ` +
          `or non-cash gains flattering reported profit. It does not by itself establish a problem, but the reconciliation between profit and cash should be reviewed.`,
        sentiment: 'investigate',
        severity: 'high',
        category: 'cashFlow',
        evidence: {
          formula: 'Year-on-year growth in net income compared with year-on-year growth in CFO',
          lines: [
            line(`Net income ${prior?.label ?? 'prior'}`, val(prior, 'netIncome'), 'currency', ctx, prior?.label),
            line(`Net income ${period.label}`, val(period, 'netIncome'), 'currency', ctx, period.label),
            line('Net income growth', niGrowth, 'percent', ctx),
            line(`CFO ${prior?.label ?? 'prior'}`, val(prior, 'cfo'), 'currency', ctx, prior?.label),
            line(`CFO ${period.label}`, val(period, 'cfo'), 'currency', ctx, period.label),
            line('CFO growth', cfoGrowth, 'percent', ctx),
          ],
          conclusion: `Profit and operating cash flow moved in opposite directions, a divergence of ${(niGrowth - cfoGrowth).toFixed(1)} percentage points.`,
        },
      });
    },
  },

  {
    id: 'weak_cash_conversion',
    kind: 'red_flag',
    description: 'CFO / net income is below the configured earnings-quality threshold.',
    evaluate: (ctx) => {
      const ratio = latestVal(ctx, 'cfoToNetIncome');
      if (!isNum(ratio) || ratio >= ctx.thresholds.cfoToNetIncomeLow) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      return flag(ctx, {
        id: 'weak_cash_conversion',
        rule: 'CFO / net income below threshold',
        title: 'Reported profit is not converting into operating cash',
        detail:
          `Operating cash flow covered only ${ratio.toFixed(2)}x of net income, below the ${ctx.thresholds.cfoToNetIncomeLow.toFixed(2)}x threshold in force. ` +
          `Sustained readings below 1.0x may indicate that profit is being absorbed by working capital or supported by non-cash items.`,
        sentiment: 'negative',
        severity: ratio < 0.5 ? 'high' : 'medium',
        category: 'cashFlow',
        thresholdUsed: { cfoToNetIncomeLow: ctx.thresholds.cfoToNetIncomeLow },
        evidence: {
          formula: 'CFO / Net Income',
          lines: [
            line('CFO', val(period, 'cfo'), 'currency', ctx, period.label),
            line('Net income', val(period, 'netIncome'), 'currency', ctx, period.label),
            line('CFO / Net income', ratio, 'times', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'margin_deterioration',
    kind: 'red_flag',
    description: 'EBITDA margin has declined for the configured number of consecutive periods.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'ebitdaMargin');
      const need = ctx.thresholds.marginDeclinePeriods;
      if (points.length < need + 1) return null;
      const window = points.slice(-(need + 1));
      let consecutive = true;
      for (let i = 1; i < window.length; i += 1) {
        if ((window[i]!.value as number) >= (window[i - 1]!.value as number)) consecutive = false;
      }
      if (!consecutive) return null;
      const totalDrop = (window[0]!.value as number) - (window[window.length - 1]!.value as number);
      if (totalDrop < ctx.thresholds.marginMaterialPp) return null;

      return flag(ctx, {
        id: 'margin_deterioration',
        rule: 'Consecutive EBITDA margin decline',
        title: 'Operating margins are deteriorating',
        detail:
          `EBITDA margin has fallen in each of the last ${need} periods, from ${(window[0]!.value as number).toFixed(1)}% in ${window[0]!.period} to ${(window[window.length - 1]!.value as number).toFixed(1)}% in ${window[window.length - 1]!.period}, ` +
          `a cumulative contraction of ${totalDrop.toFixed(1)} percentage points. Persistent margin compression may reflect input cost inflation, pricing pressure, or an unfavourable shift in sales mix.`,
        sentiment: 'negative',
        severity: totalDrop > ctx.thresholds.marginMaterialPp * 3 ? 'high' : 'medium',
        category: 'profitability',
        thresholdUsed: {
          marginDeclinePeriods: ctx.thresholds.marginDeclinePeriods,
          marginMaterialPp: ctx.thresholds.marginMaterialPp,
        },
        evidence: {
          formula: 'EBITDA / Revenue, tracked across consecutive periods',
          lines: window.map((p) => line(`EBITDA margin ${p.period}`, p.value, 'percent', ctx, p.period)),
          conclusion: `Cumulative decline of ${totalDrop.toFixed(1)} percentage points over ${need} consecutive periods.`,
        },
      });
    },
  },

  {
    id: 'leverage_elevated',
    kind: 'red_flag',
    description: 'Net debt / EBITDA exceeds the industry-configured leverage threshold.',
    evaluate: (ctx) => {
      const nde = latestVal(ctx, 'netDebtToEbitda');
      if (!isNum(nde) || nde <= ctx.thresholds.netDebtToEbitdaHigh) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      const prior = prevVal(ctx, 'netDebtToEbitda');
      const critical = nde > ctx.thresholds.netDebtToEbitdaCritical;
      return flag(ctx, {
        id: 'leverage_elevated',
        rule: 'Net debt / EBITDA above threshold',
        title: critical ? 'Leverage is at a critical level' : 'Leverage appears elevated',
        detail:
          `Net debt / EBITDA stands at ${nde.toFixed(2)}x against a threshold of ${ctx.thresholds.netDebtToEbitdaHigh.toFixed(1)}x for this industry` +
          (isNum(prior) ? `, compared with ${prior.toFixed(2)}x in the prior period` : '') +
          `. At this level the company's financial flexibility is constrained and refinancing terms become more sensitive to earnings volatility.`,
        sentiment: 'negative',
        severity: critical ? 'critical' : 'high',
        category: 'solvency',
        thresholdUsed: {
          netDebtToEbitdaHigh: ctx.thresholds.netDebtToEbitdaHigh,
          netDebtToEbitdaCritical: ctx.thresholds.netDebtToEbitdaCritical,
        },
        evidence: {
          formula: 'Net Debt / EBITDA, where Net Debt = Short-Term Debt + Long-Term Debt − Cash − Short-Term Investments',
          lines: [
            line('Short-term debt', val(period, 'shortTermDebt'), 'currency', ctx, period.label),
            line('Long-term debt', val(period, 'longTermDebt'), 'currency', ctx, period.label),
            line('Cash & equivalents', val(period, 'cash'), 'currency', ctx, period.label),
            line('Net debt', latestVal(ctx, 'netDebt'), 'currency', ctx, period.label),
            line('EBITDA', val(period, 'ebitda'), 'currency', ctx, period.label),
            line('Net debt / EBITDA', nde, 'times', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'leverage_increase',
    kind: 'red_flag',
    description: 'Net debt / EBITDA has increased materially versus the prior period.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'netDebtToEbitda');
      const prior = prevVal(ctx, 'netDebtToEbitda');
      if (!isNum(cur) || !isNum(prior)) return null;
      const delta = cur - prior;
      // Only report a material step-up that is not already covered by the absolute threshold rule.
      if (delta < 0.75 || cur <= ctx.thresholds.netDebtToEbitdaHigh * 0.6) return null;
      return flag(ctx, {
        id: 'leverage_increase',
        rule: 'Material increase in net debt / EBITDA',
        title: 'Leverage has increased materially',
        detail:
          `Net debt / EBITDA rose from ${prior.toFixed(2)}x to ${cur.toFixed(2)}x, an increase of ${delta.toFixed(2)}x in a single period. ` +
          `This may reflect debt-funded investment, an acquisition, or a fall in EBITDA; the driver should be identified because the two have very different implications.`,
        sentiment: 'investigate',
        severity: 'medium',
        category: 'solvency',
        evidence: {
          formula: 'Change in Net Debt / EBITDA between consecutive periods',
          lines: [
            line('Net debt / EBITDA (prior)', prior, 'times', ctx, previous(ctx, 'netDebtToEbitda')?.period),
            line('Net debt / EBITDA (current)', cur, 'times', ctx, ctx.latestPeriod),
            line('Net debt', latestVal(ctx, 'netDebt'), 'currency', ctx, ctx.latestPeriod),
            line('EBITDA', latestVal(ctx, 'ebitdaValue'), 'currency', ctx, ctx.latestPeriod),
          ],
          conclusion: `Leverage increased by ${delta.toFixed(2)}x year on year.`,
        },
      });
    },
  },

  {
    id: 'interest_coverage_weak',
    kind: 'red_flag',
    description: 'Interest coverage has fallen below the configured threshold.',
    evaluate: (ctx) => {
      const cov = latestVal(ctx, 'interestCoverage');
      if (!isNum(cov) || cov >= ctx.thresholds.interestCoverageLow) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      const critical = cov < ctx.thresholds.interestCoverageCritical;
      return flag(ctx, {
        id: 'interest_coverage_weak',
        rule: 'Interest coverage below threshold',
        title: critical ? 'Interest-servicing capacity is critically weak' : 'Interest-servicing capacity has weakened',
        detail:
          `Operating profit covers interest ${cov.toFixed(2)}x, below the ${ctx.thresholds.interestCoverageLow.toFixed(1)}x threshold in force` +
          (critical ? ` and below the ${ctx.thresholds.interestCoverageCritical.toFixed(1)}x level treated as critical` : '') +
          `. At this level a modest fall in operating profit would leave little headroom over the interest bill.`,
        sentiment: 'negative',
        severity: critical ? 'critical' : 'high',
        category: 'solvency',
        thresholdUsed: {
          interestCoverageLow: ctx.thresholds.interestCoverageLow,
          interestCoverageCritical: ctx.thresholds.interestCoverageCritical,
        },
        evidence: {
          formula: 'EBIT / Interest Expense',
          lines: [
            line('EBIT', val(period, 'ebit'), 'currency', ctx, period.label),
            line('Interest expense', val(period, 'interestExpense'), 'currency', ctx, period.label),
            line('Interest coverage', cov, 'times', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'ccc_deterioration',
    kind: 'red_flag',
    description: 'The cash conversion cycle has lengthened by more than the configured number of days.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'cashConversionCycle');
      const prior = prevVal(ctx, 'cashConversionCycle');
      if (!isNum(cur) || !isNum(prior)) return null;
      const delta = cur - prior;
      if (delta < ctx.thresholds.cccIncreaseDaysMaterial) return null;
      return flag(ctx, {
        id: 'ccc_deterioration',
        rule: 'Cash conversion cycle increase',
        title: 'Working-capital efficiency has deteriorated',
        detail:
          `The cash conversion cycle lengthened from ${prior.toFixed(0)} to ${cur.toFixed(0)} days, an increase of ${delta.toFixed(0)} days. ` +
          `Each additional day of cycle ties up more cash in operations, which reduces the cash available from a given level of profit.`,
        sentiment: 'negative',
        severity: delta > ctx.thresholds.cccIncreaseDaysMaterial * 2 ? 'high' : 'medium',
        category: 'workingCapital',
        thresholdUsed: { cccIncreaseDaysMaterial: ctx.thresholds.cccIncreaseDaysMaterial },
        evidence: {
          formula: 'Cash Conversion Cycle = DSO + DIO − DPO',
          lines: [
            line('DSO (prior)', prevVal(ctx, 'dso'), 'days', ctx),
            line('DSO (current)', latestVal(ctx, 'dso'), 'days', ctx),
            line('DIO (prior)', prevVal(ctx, 'dio'), 'days', ctx),
            line('DIO (current)', latestVal(ctx, 'dio'), 'days', ctx),
            line('DPO (prior)', prevVal(ctx, 'dpo'), 'days', ctx),
            line('DPO (current)', latestVal(ctx, 'dpo'), 'days', ctx),
            line('Cash conversion cycle (prior)', prior, 'days', ctx),
            line('Cash conversion cycle (current)', cur, 'days', ctx),
          ],
          conclusion: `The cycle lengthened by ${delta.toFixed(0)} days, against a configured materiality of ${ctx.thresholds.cccIncreaseDaysMaterial} days.`,
        },
      });
    },
  },

  {
    id: 'asset_efficiency',
    kind: 'red_flag',
    description: 'Total assets are growing materially faster than revenue.',
    evaluate: (ctx) => {
      const assetGrowth = latestVal(ctx, 'assetGrowth');
      const revGrowth = latestVal(ctx, 'revenueGrowth');
      if (!isNum(assetGrowth) || !isNum(revGrowth)) return null;
      const gap = assetGrowth - revGrowth;
      if (gap <= ctx.thresholds.assetsVsRevenueGapPp) return null;
      return flag(ctx, {
        id: 'asset_efficiency',
        rule: 'Asset growth vs revenue growth',
        title: 'Asset growth is outpacing revenue growth',
        detail:
          `Total assets grew ${assetGrowth.toFixed(1)}% while revenue grew ${revGrowth.toFixed(1)}%, a gap of ${gap.toFixed(1)} percentage points. ` +
          `This potentially indicates declining asset efficiency. It can also be the expected pattern where capacity has been added ahead of the revenue it will serve, ` +
          `so the timing of recent capital expenditure should be considered before drawing a conclusion.`,
        sentiment: 'investigate',
        severity: 'medium',
        category: 'efficiency',
        thresholdUsed: { assetsVsRevenueGapPp: ctx.thresholds.assetsVsRevenueGapPp },
        evidence: {
          formula: 'Total asset growth − Revenue growth, year on year',
          lines: [
            line('Asset growth', assetGrowth, 'percent', ctx),
            line('Revenue growth', revGrowth, 'percent', ctx),
            line('Asset turnover (prior)', prevVal(ctx, 'assetTurnover'), 'times', ctx),
            line('Asset turnover (current)', latestVal(ctx, 'assetTurnover'), 'times', ctx),
          ],
          conclusion: `Asset growth exceeds revenue growth by ${gap.toFixed(1)} percentage points, against a configured tolerance of ${ctx.thresholds.assetsVsRevenueGapPp} pp.`,
        },
      });
    },
  },

  {
    id: 'roe_quality',
    kind: 'red_flag',
    description: 'ROE improved primarily because of higher financial leverage rather than operating performance.',
    evaluate: (ctx) => {
      const roeCur = latestVal(ctx, 'roe');
      const roePrev = prevVal(ctx, 'roe');
      const emCur = latestVal(ctx, 'equityMultiplier');
      const emPrev = prevVal(ctx, 'equityMultiplier');
      const nmCur = latestVal(ctx, 'netMargin');
      const nmPrev = prevVal(ctx, 'netMargin');
      const atCur = latestVal(ctx, 'assetTurnover');
      const atPrev = prevVal(ctx, 'assetTurnover');
      if (![roeCur, roePrev, emCur, emPrev, nmCur, nmPrev, atCur, atPrev].every(isNum)) return null;
      if ((roeCur as number) <= (roePrev as number)) return null;

      const base = (nmPrev as number) * (atPrev as number) * (emPrev as number);
      const afterMargin = (nmCur as number) * (atPrev as number) * (emPrev as number);
      const afterTurnover = (nmCur as number) * (atCur as number) * (emPrev as number);
      const afterLeverage = (nmCur as number) * (atCur as number) * (emCur as number);
      const marginEffect = afterMargin - base;
      const turnoverEffect = afterTurnover - afterMargin;
      const leverageEffect = afterLeverage - afterTurnover;

      if (leverageEffect <= 0) return null;
      if (leverageEffect <= Math.abs(marginEffect) || leverageEffect <= Math.abs(turnoverEffect)) return null;

      return flag(ctx, {
        id: 'roe_quality',
        rule: 'ROE improvement driven by leverage',
        title: 'ROE improvement is leverage-driven',
        detail:
          `ROE rose from ${(roePrev as number).toFixed(1)}% to ${(roeCur as number).toFixed(1)}%, but the DuPont decomposition attributes ${pp(leverageEffect)} of that movement to a higher equity multiplier, ` +
          `against ${pp(marginEffect)} from margins and ${pp(turnoverEffect)} from asset turnover. ` +
          `A leverage-led improvement raises returns without improving the underlying business, and it increases sensitivity to a downturn.`,
        sentiment: 'investigate',
        severity: 'medium',
        category: 'returns',
        evidence: {
          formula: 'ROE = Net Margin × Asset Turnover × Equity Multiplier; each component moved in turn from prior to current value',
          lines: [
            line('Net margin (prior)', nmPrev, 'percent', ctx),
            line('Net margin (current)', nmCur, 'percent', ctx),
            line('Asset turnover (prior)', atPrev, 'times', ctx),
            line('Asset turnover (current)', atCur, 'times', ctx),
            line('Equity multiplier (prior)', emPrev, 'times', ctx),
            line('Equity multiplier (current)', emCur, 'times', ctx),
            { label: 'Margin effect on ROE', display: pp(marginEffect), value: marginEffect, unit: 'percent' },
            { label: 'Turnover effect on ROE', display: pp(turnoverEffect), value: turnoverEffect, unit: 'percent' },
            { label: 'Leverage effect on ROE', display: pp(leverageEffect), value: leverageEffect, unit: 'percent' },
          ],
          conclusion: 'Leverage is the largest single contributor to the increase in return on equity.',
        },
      });
    },
  },

  {
    id: 'liquidity_strain',
    kind: 'red_flag',
    description: 'Current ratio has fallen below the configured minimum.',
    evaluate: (ctx) => {
      const cr = latestVal(ctx, 'currentRatio');
      if (!isNum(cr) || ctx.thresholds.currentRatioLow <= 0 || cr >= ctx.thresholds.currentRatioLow) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      return flag(ctx, {
        id: 'liquidity_strain',
        rule: 'Current ratio below threshold',
        title: 'Short-term liquidity is tight',
        detail:
          `The current ratio stands at ${cr.toFixed(2)}x, below the ${ctx.thresholds.currentRatioLow.toFixed(2)}x threshold in force, meaning current liabilities exceed the current assets available to settle them. ` +
          `This is not automatically a problem where the business collects cash quickly and has committed facilities, but it leaves little buffer.`,
        sentiment: 'negative',
        severity: cr < ctx.thresholds.currentRatioLow * 0.75 ? 'high' : 'medium',
        category: 'liquidity',
        thresholdUsed: { currentRatioLow: ctx.thresholds.currentRatioLow },
        evidence: {
          formula: 'Total Current Assets / Total Current Liabilities',
          lines: [
            line('Total current assets', val(period, 'totalCurrentAssets'), 'currency', ctx, period.label),
            line('Total current liabilities', val(period, 'totalCurrentLiabilities'), 'currency', ctx, period.label),
            line('Current ratio', cr, 'times', ctx, period.label),
            line('Quick ratio', latestVal(ctx, 'quickRatio'), 'times', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'negative_equity',
    kind: 'red_flag',
    description: 'Total equity is negative.',
    evaluate: (ctx) => {
      const period = ctx.periods[ctx.periods.length - 1]!;
      const equity = val(period, 'totalEquity');
      if (!isNum(equity) || equity >= 0) return null;
      return flag(ctx, {
        id: 'negative_equity',
        rule: 'Negative shareholders’ equity',
        title: 'Shareholders’ equity is negative',
        detail:
          `Total equity is ${formatCurrency(equity, ctx.fmtCtx)}, meaning accumulated losses or distributions exceed the capital contributed. ` +
          `Return on equity and debt-to-equity cannot be meaningfully interpreted in this state, and the company depends on creditors rather than shareholders for its funding.`,
        sentiment: 'negative',
        severity: 'critical',
        category: 'solvency',
        evidence: {
          formula: 'Total Equity as reported on the balance sheet',
          lines: [
            line('Total equity', equity, 'currency', ctx, period.label),
            line('Retained earnings', val(period, 'retainedEarnings'), 'currency', ctx, period.label),
            line('Total liabilities', val(period, 'totalLiabilities'), 'currency', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'revenue_decline',
    kind: 'red_flag',
    description: 'Revenue declined versus the prior period.',
    evaluate: (ctx) => {
      const growth = latestVal(ctx, 'revenueGrowth');
      if (!isNum(growth) || growth >= 0) return null;
      const points = usablePoints(ctx, 'revenueGrowth');
      const consecutive = points.slice(-2).every((p) => (p.value as number) < 0) && points.length >= 2;
      return flag(ctx, {
        id: 'revenue_decline',
        rule: 'Revenue contraction',
        title: consecutive ? 'Revenue has declined for two consecutive periods' : 'Revenue declined in the latest period',
        detail:
          `Revenue fell ${Math.abs(growth).toFixed(1)}% year on year` +
          (consecutive ? ', the second consecutive period of contraction' : '') +
          `. Operating leverage works in both directions, so a falling top line usually puts pressure on margins unless the cost base moves with it.`,
        sentiment: 'negative',
        severity: consecutive ? 'high' : 'medium',
        category: 'growth',
        evidence: {
          formula: '(Revenue − Prior Revenue) / Prior Revenue',
          lines: usablePoints(ctx, 'revenue').slice(-3).map((p) => line(`Revenue ${p.period}`, p.value, 'currency', ctx, p.period)),
        },
      });
    },
  },

  {
    id: 'negative_free_cash_flow',
    kind: 'red_flag',
    description: 'Free cash flow has been negative in consecutive periods.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'fcf');
      if (points.length < 2) return null;
      const recent = points.slice(-2);
      if (!recent.every((p) => (p.value as number) < 0)) return null;
      return flag(ctx, {
        id: 'negative_free_cash_flow',
        rule: 'Consecutive negative free cash flow',
        title: 'Free cash flow has been negative in consecutive periods',
        detail:
          `Free cash flow was ${formatCurrency(recent[0]!.value, ctx.fmtCtx)} in ${recent[0]!.period} and ${formatCurrency(recent[1]!.value, ctx.fmtCtx)} in ${recent[1]!.period}. ` +
          `Sustained negative free cash flow must be funded from existing cash, new debt or new equity. Where this reflects a deliberate expansion programme it may be appropriate, ` +
          `but the funding plan and the expected return on that investment should be understood.`,
        sentiment: 'investigate',
        severity: 'medium',
        category: 'cashFlow',
        evidence: {
          formula: 'Free Cash Flow = CFO − Capital Expenditure',
          lines: recent.flatMap((p) => {
            const period = ctx.periods.find((x) => x.label === p.period);
            return [
              line(`CFO ${p.period}`, val(period, 'cfo'), 'currency', ctx, p.period),
              line(`Capex ${p.period}`, val(period, 'capex'), 'currency', ctx, p.period),
              line(`FCF ${p.period}`, p.value, 'currency', ctx, p.period),
            ];
          }),
        },
      });
    },
  },

  {
    id: 'capex_exceeds_cfo',
    kind: 'red_flag',
    description: 'Capital expenditure exceeds operating cash flow.',
    evaluate: (ctx) => {
      const ratio = latestVal(ctx, 'capexToCfo');
      if (!isNum(ratio) || ratio <= 100) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      return flag(ctx, {
        id: 'capex_exceeds_cfo',
        rule: 'Capex / CFO above 100%',
        title: 'Capital investment exceeds cash generated from operations',
        detail:
          `Capital expenditure absorbed ${ratio.toFixed(0)}% of operating cash flow, so the investment programme is being funded in part from sources other than operations. ` +
          `This is common during a capacity build; what matters is whether the funding is secured and whether the returns on that spend are visible in later periods.`,
        sentiment: 'investigate',
        severity: 'low',
        category: 'cashFlow',
        evidence: {
          formula: 'Capital Expenditure / CFO',
          lines: [
            line('Capex', val(period, 'capex'), 'currency', ctx, period.label),
            line('CFO', val(period, 'cfo'), 'currency', ctx, period.label),
            line('Capex / CFO', ratio, 'percent', ctx, period.label),
          ],
        },
      });
    },
  },

  {
    id: 'other_income_dependence',
    kind: 'red_flag',
    description: 'A large share of pre-tax profit comes from other income rather than operations.',
    evaluate: (ctx) => {
      const period = ctx.periods[ctx.periods.length - 1]!;
      const other = val(period, 'otherIncome');
      const pbt = val(period, 'pbt');
      if (!isNum(other) || !isNum(pbt) || pbt <= 0 || other <= 0) return null;
      const share = (other / pbt) * 100;
      if (share < 25) return null;
      return flag(ctx, {
        id: 'other_income_dependence',
        rule: 'Other income share of pre-tax profit',
        title: 'A material share of pre-tax profit comes from non-operating income',
        detail:
          `Other income of ${formatCurrency(other, ctx.fmtCtx)} represents ${share.toFixed(0)}% of pre-tax profit. ` +
          `Non-operating income is typically less repeatable than trading profit, so the underlying operating earnings power may be lower than the headline suggests.`,
        sentiment: 'investigate',
        severity: share > 50 ? 'medium' : 'low',
        category: 'profitability',
        evidence: {
          formula: 'Other Income / Profit Before Tax',
          lines: [
            line('Other income', other, 'currency', ctx, period.label),
            line('EBIT', val(period, 'ebit'), 'currency', ctx, period.label),
            line('Profit before tax', pbt, 'currency', ctx, period.label),
            line('Other income share of PBT', share, 'percent', ctx, period.label),
          ],
        },
      });
    },
  },
];

/* ------------------------------------------------------------------ */
/* Positive signal rules                                              */
/* ------------------------------------------------------------------ */

export const POSITIVE_SIGNAL_RULES: Rule[] = [
  {
    id: 'growth_accelerating',
    kind: 'positive_signal',
    description: 'Revenue growth in the latest period exceeds the prior period by a material margin.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'revenueGrowth');
      if (points.length < 2) return null;
      const cur = points[points.length - 1]!.value as number;
      const prior = points[points.length - 2]!.value as number;
      if (cur <= prior + 2 || cur <= 0) return null;
      return flag(ctx, {
        id: 'growth_accelerating',
        rule: 'Revenue growth acceleration',
        title: 'Revenue growth is accelerating',
        detail:
          `Revenue growth improved from ${prior.toFixed(1)}% to ${cur.toFixed(1)}%, an acceleration of ${(cur - prior).toFixed(1)} percentage points. ` +
          `Accelerating growth from an established base generally indicates strengthening demand or successful expansion.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'growth',
        evidence: {
          formula: 'Year-on-year revenue growth, compared across the two most recent periods',
          lines: points.slice(-3).map((p) => line(`Revenue growth ${p.period}`, p.value, 'percent', ctx, p.period)),
        },
      });
    },
  },
  {
    id: 'margin_expansion',
    kind: 'positive_signal',
    description: 'EBITDA margin has expanded materially over the analysis period.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'ebitdaMargin');
      if (points.length < 3) return null;
      const first = points[0]!.value as number;
      const last = points[points.length - 1]!.value as number;
      const gain = last - first;
      if (gain < ctx.thresholds.marginMaterialPp) return null;
      return flag(ctx, {
        id: 'margin_expansion',
        rule: 'EBITDA margin expansion',
        title: 'Operating margins have expanded',
        detail:
          `EBITDA margin improved from ${first.toFixed(1)}% in ${points[0]!.period} to ${last.toFixed(1)}% in ${points[points.length - 1]!.period}, a gain of ${gain.toFixed(1)} percentage points. ` +
          `Margin expansion alongside growth indicates the cost base is scaling more slowly than revenue.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'profitability',
        evidence: {
          formula: 'EBITDA / Revenue, tracked across the analysis period',
          lines: points.map((p) => line(`EBITDA margin ${p.period}`, p.value, 'percent', ctx, p.period)),
          conclusion: `Cumulative margin expansion of ${gain.toFixed(1)} percentage points.`,
        },
      });
    },
  },
  {
    id: 'deleveraging',
    kind: 'positive_signal',
    description: 'Net debt / EBITDA has fallen materially.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'netDebtToEbitda');
      const prior = prevVal(ctx, 'netDebtToEbitda');
      if (!isNum(cur) || !isNum(prior)) return null;
      const delta = prior - cur;
      if (delta < 0.3) return null;
      return flag(ctx, {
        id: 'deleveraging',
        rule: 'Reduction in net debt / EBITDA',
        title: 'Leverage is being reduced',
        detail:
          `Net debt / EBITDA fell from ${prior.toFixed(2)}x to ${cur.toFixed(2)}x, a reduction of ${delta.toFixed(2)}x. ` +
          `Lower leverage improves financial flexibility and reduces the earnings sensitivity of equity returns.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'solvency',
        evidence: {
          formula: 'Net Debt / EBITDA across consecutive periods',
          lines: [
            line('Net debt (prior)', prevVal(ctx, 'netDebt'), 'currency', ctx),
            line('Net debt (current)', latestVal(ctx, 'netDebt'), 'currency', ctx),
            line('Net debt / EBITDA (prior)', prior, 'times', ctx),
            line('Net debt / EBITDA (current)', cur, 'times', ctx),
          ],
        },
      });
    },
  },
  {
    id: 'net_cash',
    kind: 'positive_signal',
    description: 'The company holds more cash and liquid investments than total debt.',
    evaluate: (ctx) => {
      const nd = latestVal(ctx, 'netDebt');
      if (!isNum(nd) || nd >= 0) return null;
      const period = ctx.periods[ctx.periods.length - 1]!;
      return flag(ctx, {
        id: 'net_cash',
        rule: 'Net cash position',
        title: 'The balance sheet is in a net cash position',
        detail:
          `Cash and liquid investments exceed total borrowings by ${formatCurrency(Math.abs(nd), ctx.fmtCtx)}. ` +
          `A net cash balance sheet gives the company optionality to invest, withstand a downturn, or return capital without relying on credit markets.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'solvency',
        evidence: {
          formula: 'Net Debt = Short-Term Debt + Long-Term Debt − Cash − Short-Term Investments',
          lines: [
            line('Total debt', totalDebt(period), 'currency', ctx, period.label),
            line('Cash & equivalents', val(period, 'cash'), 'currency', ctx, period.label),
            line('Short-term investments', val(period, 'shortTermInvestments'), 'currency', ctx, period.label),
            line('Net debt', nd, 'currency', ctx, period.label),
          ],
        },
      });
    },
  },
  {
    id: 'coverage_improving',
    kind: 'positive_signal',
    description: 'Interest coverage has improved materially.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'interestCoverage');
      const prior = prevVal(ctx, 'interestCoverage');
      if (!isNum(cur) || !isNum(prior) || cur <= prior * 1.15) return null;
      if (cur < ctx.thresholds.interestCoverageLow) return null;
      return flag(ctx, {
        id: 'coverage_improving',
        rule: 'Interest coverage improvement',
        title: 'Debt-servicing capacity has improved',
        detail:
          `Interest coverage improved from ${prior.toFixed(2)}x to ${cur.toFixed(2)}x. ` +
          `Operating profit now provides a wider buffer over the interest bill.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'solvency',
        evidence: {
          formula: 'EBIT / Interest Expense across consecutive periods',
          lines: [
            line('Interest coverage (prior)', prior, 'times', ctx),
            line('Interest coverage (current)', cur, 'times', ctx),
            line('EBIT (current)', latestVal(ctx, 'ebitValue'), 'currency', ctx),
            line('Interest expense (current)', val(ctx.periods[ctx.periods.length - 1], 'interestExpense'), 'currency', ctx),
          ],
        },
      });
    },
  },
  {
    id: 'cash_backed_earnings',
    kind: 'positive_signal',
    description: 'CFO has exceeded net income in every period with data.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'cfoToNetIncome');
      if (points.length < 3) return null;
      if (!points.every((p) => (p.value as number) >= 1)) return null;
      return flag(ctx, {
        id: 'cash_backed_earnings',
        rule: 'CFO consistently exceeds net income',
        title: 'Reported earnings are consistently backed by cash',
        detail:
          `Operating cash flow exceeded net income in all ${points.length} periods with data, ranging from ${Math.min(...points.map((p) => p.value as number)).toFixed(2)}x to ${Math.max(...points.map((p) => p.value as number)).toFixed(2)}x. ` +
          `Consistent cash backing is a strong indicator of earnings quality.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'cashFlow',
        evidence: {
          formula: 'CFO / Net Income, tracked across the analysis period',
          lines: points.map((p) => line(`CFO / Net income ${p.period}`, p.value, 'times', ctx, p.period)),
        },
      });
    },
  },
  {
    id: 'fcf_growth_streak',
    kind: 'positive_signal',
    description: 'Free cash flow has increased in each of the last three periods.',
    evaluate: (ctx) => {
      const points = usablePoints(ctx, 'fcf');
      if (points.length < 4) return null;
      const window = points.slice(-4);
      for (let i = 1; i < window.length; i += 1) {
        if ((window[i]!.value as number) <= (window[i - 1]!.value as number)) return null;
      }
      if ((window[window.length - 1]!.value as number) <= 0) return null;
      return flag(ctx, {
        id: 'fcf_growth_streak',
        rule: 'Consecutive free cash flow growth',
        title: 'Free cash flow has grown consistently over the last three years',
        detail:
          `Free cash flow rose in each of the last three periods, from ${formatCurrency(window[0]!.value, ctx.fmtCtx)} in ${window[0]!.period} to ${formatCurrency(window[window.length - 1]!.value, ctx.fmtCtx)} in ${window[window.length - 1]!.period}. ` +
          `Consistent growth in cash after capital investment is the clearest evidence that growth is being funded from within the business.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'cashFlow',
        evidence: {
          formula: 'Free Cash Flow = CFO − Capital Expenditure, tracked across periods',
          lines: window.map((p) => line(`FCF ${p.period}`, p.value, 'currency', ctx, p.period)),
        },
      });
    },
  },
  {
    id: 'ccc_improving',
    kind: 'positive_signal',
    description: 'The cash conversion cycle has shortened materially.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'cashConversionCycle');
      const prior = prevVal(ctx, 'cashConversionCycle');
      if (!isNum(cur) || !isNum(prior)) return null;
      const delta = prior - cur;
      if (delta < 5) return null;
      return flag(ctx, {
        id: 'ccc_improving',
        rule: 'Cash conversion cycle reduction',
        title: 'The working-capital cycle has improved',
        detail:
          `The cash conversion cycle shortened from ${prior.toFixed(0)} to ${cur.toFixed(0)} days, releasing cash from operations. ` +
          `A shorter cycle means each unit of revenue ties up less capital.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'workingCapital',
        evidence: {
          formula: 'Cash Conversion Cycle = DSO + DIO − DPO',
          lines: [
            line('DSO (prior)', prevVal(ctx, 'dso'), 'days', ctx),
            line('DSO (current)', latestVal(ctx, 'dso'), 'days', ctx),
            line('DIO (prior)', prevVal(ctx, 'dio'), 'days', ctx),
            line('DIO (current)', latestVal(ctx, 'dio'), 'days', ctx),
            line('DPO (prior)', prevVal(ctx, 'dpo'), 'days', ctx),
            line('DPO (current)', latestVal(ctx, 'dpo'), 'days', ctx),
            line('Cycle (prior)', prior, 'days', ctx),
            line('Cycle (current)', cur, 'days', ctx),
          ],
          conclusion: `The cycle shortened by ${delta.toFixed(0)} days.`,
        },
      });
    },
  },
  {
    id: 'roic_improving',
    kind: 'positive_signal',
    description: 'ROIC has improved and stands above the configured strength threshold.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'roic');
      const prior = prevVal(ctx, 'roic');
      if (!isNum(cur) || !isNum(prior)) return null;
      if (cur <= prior || cur < ctx.thresholds.roicStrong) return null;
      return flag(ctx, {
        id: 'roic_improving',
        rule: 'ROIC improvement above threshold',
        title: 'Return on invested capital is improving',
        detail:
          `ROIC improved from ${prior.toFixed(1)}% to ${cur.toFixed(1)}%, above the ${ctx.thresholds.roicStrong.toFixed(0)}% level treated as strong for this industry` +
          (cur > ctx.thresholds.roicHurdle
            ? ` and above the indicative ${ctx.thresholds.roicHurdle.toFixed(0)}% cost-of-capital hurdle configured, which would suggest incremental capital is being deployed at a return above its cost.`
            : '.'),
        sentiment: 'positive',
        severity: 'info',
        category: 'returns',
        thresholdUsed: { roicStrong: ctx.thresholds.roicStrong, roicHurdle: ctx.thresholds.roicHurdle },
        evidence: {
          formula: 'NOPAT / Average Invested Capital, where Invested Capital = Equity + Total Debt − Cash',
          lines: [
            line('ROIC (prior)', prior, 'percent', ctx),
            line('ROIC (current)', cur, 'percent', ctx),
            line('EBIT (current)', latestVal(ctx, 'ebitValue'), 'currency', ctx),
            line('Total debt', latestVal(ctx, 'totalDebt'), 'currency', ctx),
            line('Total equity', val(ctx.periods[ctx.periods.length - 1], 'totalEquity'), 'currency', ctx),
          ],
        },
      });
    },
  },
  {
    id: 'asset_turnover_improving',
    kind: 'positive_signal',
    description: 'Asset turnover has improved versus the prior period.',
    evaluate: (ctx) => {
      const cur = latestVal(ctx, 'assetTurnover');
      const prior = prevVal(ctx, 'assetTurnover');
      if (!isNum(cur) || !isNum(prior) || cur <= prior * 1.05) return null;
      return flag(ctx, {
        id: 'asset_turnover_improving',
        rule: 'Asset turnover improvement',
        title: 'The asset base is being used more productively',
        detail:
          `Asset turnover improved from ${prior.toFixed(2)}x to ${cur.toFixed(2)}x, meaning each unit of assets is now generating more revenue. ` +
          `Where this is sustained it lifts returns on capital without requiring additional margin.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'efficiency',
        evidence: {
          formula: 'Revenue / Average Total Assets across consecutive periods',
          lines: [
            line('Asset turnover (prior)', prior, 'times', ctx),
            line('Asset turnover (current)', cur, 'times', ctx),
            line('Revenue growth', latestVal(ctx, 'revenueGrowth'), 'percent', ctx),
            line('Asset growth', latestVal(ctx, 'assetGrowth'), 'percent', ctx),
          ],
        },
      });
    },
  },
  {
    id: 'operating_leverage',
    kind: 'positive_signal',
    description: 'EBITDA is growing faster than revenue.',
    evaluate: (ctx) => {
      const rev = latestVal(ctx, 'revenueGrowth');
      const ebitda = latestVal(ctx, 'ebitdaGrowth');
      if (!isNum(rev) || !isNum(ebitda) || rev <= 0) return null;
      if (ebitda <= rev + 2) return null;
      return flag(ctx, {
        id: 'operating_leverage',
        rule: 'EBITDA growth exceeds revenue growth',
        title: 'Operating leverage is working in the company’s favour',
        detail:
          `EBITDA grew ${ebitda.toFixed(1)}% against revenue growth of ${rev.toFixed(1)}%, so profit is expanding faster than sales. ` +
          `This indicates that a portion of the cost base is fixed and is being spread over a larger revenue base.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'profitability',
        evidence: {
          formula: 'Year-on-year EBITDA growth compared with year-on-year revenue growth',
          lines: [
            line('Revenue growth', rev, 'percent', ctx),
            line('EBITDA growth', ebitda, 'percent', ctx),
            line('EBITDA margin (prior)', prevVal(ctx, 'ebitdaMargin'), 'percent', ctx),
            line('EBITDA margin (current)', latestVal(ctx, 'ebitdaMargin'), 'percent', ctx),
          ],
          conclusion: `EBITDA growth exceeds revenue growth by ${(ebitda - rev).toFixed(1)} percentage points.`,
        },
      });
    },
  },
  {
    id: 'strong_returns',
    kind: 'positive_signal',
    description: 'ROE is at or above the configured strength threshold.',
    evaluate: (ctx) => {
      const roe = latestVal(ctx, 'roe');
      if (!isNum(roe) || roe < ctx.thresholds.roeStrong) return null;
      return flag(ctx, {
        id: 'strong_returns',
        rule: 'ROE above threshold',
        title: 'Returns on shareholder capital are strong',
        detail:
          `ROE of ${roe.toFixed(1)}% is at or above the ${ctx.thresholds.roeStrong.toFixed(0)}% level configured as strong for this industry.` +
          (isNum(latestVal(ctx, 'equityMultiplier'))
            ? ` The equity multiplier stands at ${(latestVal(ctx, 'equityMultiplier') as number).toFixed(2)}x, which indicates how much of this return rests on leverage.`
            : ''),
        sentiment: 'positive',
        severity: 'info',
        category: 'returns',
        thresholdUsed: { roeStrong: ctx.thresholds.roeStrong },
        evidence: {
          formula: '(Net Income − Preferred Dividends) / Average Shareholders’ Equity',
          lines: [
            line('ROE', roe, 'percent', ctx),
            line('Net margin', latestVal(ctx, 'netMargin'), 'percent', ctx),
            line('Asset turnover', latestVal(ctx, 'assetTurnover'), 'times', ctx),
            line('Equity multiplier', latestVal(ctx, 'equityMultiplier'), 'times', ctx),
          ],
        },
      });
    },
  },
  {
    id: 'debt_reduction',
    kind: 'positive_signal',
    description: 'Total debt has been reduced versus the prior period.',
    evaluate: (ctx) => {
      const growth = latestVal(ctx, 'debtGrowth');
      if (!isNum(growth) || growth >= -5) return null;
      return flag(ctx, {
        id: 'debt_reduction',
        rule: 'Reduction in total debt',
        title: 'Borrowings have been reduced',
        detail:
          `Total debt fell ${Math.abs(growth).toFixed(1)}% year on year, from ${formatCurrency(prevVal(ctx, 'totalDebt'), ctx.fmtCtx)} to ${formatCurrency(latestVal(ctx, 'totalDebt'), ctx.fmtCtx)}. ` +
          `Debt reduction lowers fixed financing costs and improves resilience.`,
        sentiment: 'positive',
        severity: 'info',
        category: 'solvency',
        evidence: {
          formula: 'Change in Total Debt (Short-Term Debt + Long-Term Debt) year on year',
          lines: [
            line('Total debt (prior)', prevVal(ctx, 'totalDebt'), 'currency', ctx),
            line('Total debt (current)', latestVal(ctx, 'totalDebt'), 'currency', ctx),
            line('Debt repaid (cash flow)', val(ctx.periods[ctx.periods.length - 1], 'debtRepaid'), 'currency', ctx),
          ],
        },
      });
    },
  },
];

export const ALL_RULES = [...RED_FLAG_RULES, ...POSITIVE_SIGNAL_RULES];

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Run every rule and return the flags that fired, ordered by severity. */
export function runRules(ctx: RuleContext): { redFlags: Flag[]; positiveSignals: Flag[] } {
  const redFlags: Flag[] = [];
  const positiveSignals: Flag[] = [];

  for (const rule of ALL_RULES) {
    let result: Flag | null = null;
    try {
      result = rule.evaluate(ctx);
    } catch {
      // A rule that cannot evaluate must never take down the analysis; it simply does not fire.
      result = null;
    }
    if (!result) continue;
    if (rule.kind === 'red_flag') redFlags.push(result);
    else positiveSignals.push(result);
  }

  redFlags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { redFlags, positiveSignals };
}
