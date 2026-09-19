import type {
  CompanyProfile,
  DataQualityCheck,
  DataQualityReport,
  Evidence,
  FinancialPeriod,
  MetricSeries,
  Num,
  ThresholdConfig,
} from '../types.js';
import { isNum, sumDefined } from '../utils/number.js';
import { formatCurrency, formatMetric } from '../utils/format.js';
import { CORE_LINE_ITEMS, labelFor } from './lineItems.js';
import { val } from './normalize.js';

/**
 * Data-quality engine.
 *
 * The purpose is to prevent misleading analysis: every structural problem with the input
 * data is stated plainly, with the amount involved, rather than being silently absorbed.
 */
export function assessDataQuality(
  periods: FinancialPeriod[],
  company: CompanyProfile,
  metrics: Record<string, MetricSeries>,
  thresholds: ThresholdConfig,
): DataQualityReport {
  const checks: DataQualityCheck[] = [];
  const ctx = { currency: company.currency, units: company.units };

  /* ---------- Structural checks on the period set ---------- */
  if (periods.length === 0) {
    checks.push({
      id: 'periods.none', label: 'Financial periods', status: 'fail',
      detail: 'No financial periods have been entered. Add at least one year of data to begin the analysis.',
    });
  } else if (periods.length === 1) {
    checks.push({
      id: 'periods.single', label: 'Financial periods', status: 'warn',
      detail: 'Only one period is available. Growth rates, trends and average-balance ratios cannot be calculated from a single year.',
    });
  } else {
    checks.push({
      id: 'periods.count', label: 'Financial periods', status: 'pass',
      detail: `${periods.length} periods available (${periods[0]!.label} to ${periods[periods.length - 1]!.label}).`,
    });
  }

  const labels = periods.map((p) => p.label);
  const duplicates = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (duplicates.length > 0) {
    checks.push({
      id: 'periods.duplicate', label: 'Duplicate periods', status: 'fail',
      detail: `Duplicate period labels found: ${[...new Set(duplicates)].join(', ')}. Each period must appear exactly once.`,
    });
  }

  /* ---------- Balance sheet identity ---------- */
  for (const period of periods) {
    const assets = val(period, 'totalAssets');
    const liabilities = val(period, 'totalLiabilities');
    const equity = val(period, 'totalEquity');

    if (!isNum(assets) || !isNum(liabilities) || !isNum(equity)) {
      checks.push({
        id: `balance.${period.label}`, label: `Balance sheet check — ${period.label}`, status: 'skipped',
        period: period.label,
        detail: 'Insufficient data to test the accounting identity. Total assets, total liabilities and total equity are all required.',
      });
      continue;
    }

    const difference = assets - (liabilities + equity);
    const tolerance = Math.max(
      Math.abs(assets) * thresholds.balanceToleranceRatio,
      thresholds.balanceToleranceAbsolute,
    );
    const balanced = Math.abs(difference) <= tolerance;

    const evidence: Evidence = {
      formula: 'Total Assets = Total Liabilities + Total Equity',
      lines: [
        { label: 'Total assets', display: formatCurrency(assets, ctx), value: assets, unit: 'currency', period: period.label },
        { label: 'Total liabilities', display: formatCurrency(liabilities, ctx), value: liabilities, unit: 'currency', period: period.label },
        { label: 'Total equity', display: formatCurrency(equity, ctx), value: equity, unit: 'currency', period: period.label },
        { label: 'Difference', display: formatCurrency(difference, ctx), value: difference, unit: 'currency', period: period.label },
      ],
      conclusion: balanced
        ? 'The balance sheet balances within the configured rounding tolerance.'
        : `The balance sheet does not balance. Difference: ${formatCurrency(difference, ctx)}.`,
    };

    checks.push({
      id: `balance.${period.label}`,
      label: `Balance sheet check — ${period.label}`,
      status: balanced ? 'pass' : 'fail',
      period: period.label,
      detail: balanced
        ? `Balanced. Assets ${formatCurrency(assets, ctx)} = Liabilities ${formatCurrency(liabilities, ctx)} + Equity ${formatCurrency(equity, ctx)}.`
        : `Balance sheet difference: ${formatCurrency(difference, ctx)}. Ratios that use total assets or equity should be treated with caution until this is resolved.`,
      evidence,
    });
  }

  /* ---------- Cash flow reconciliation ---------- */
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i]!;
    const cfo = val(period, 'cfo');
    const cfi = val(period, 'cfi');
    const cff = val(period, 'cff');

    if (!isNum(cfo) || !isNum(cfi) || !isNum(cff)) {
      checks.push({
        id: `cashflow.${period.label}`, label: `Cash flow reconciliation — ${period.label}`, status: 'skipped',
        period: period.label,
        detail: 'CFO, CFI and CFF are all required to reconcile the movement in cash.',
      });
      continue;
    }

    const fx = val(period, 'fxEffectOnCash') ?? 0;
    const netChange = cfo + cfi + cff + fx;
    const priorCash = i > 0 ? val(periods[i - 1]!, 'cash') : val(period, 'openingCash');
    const closingCash = val(period, 'cash') ?? val(period, 'closingCash');

    if (!isNum(priorCash) || !isNum(closingCash)) {
      checks.push({
        id: `cashflow.${period.label}`, label: `Cash flow reconciliation — ${period.label}`, status: 'skipped',
        period: period.label,
        detail: `Net change in cash computes to ${formatCurrency(netChange, ctx)}, but opening and closing cash balances are not both available to reconcile against the balance sheet.`,
      });
      continue;
    }

    const balanceMovement = closingCash - priorCash;
    const gap = netChange - balanceMovement;
    const tolerance = Math.max(Math.abs(closingCash) * 0.01, thresholds.balanceToleranceAbsolute);
    const reconciled = Math.abs(gap) <= tolerance;

    checks.push({
      id: `cashflow.${period.label}`,
      label: `Cash flow reconciliation — ${period.label}`,
      status: reconciled ? 'pass' : 'warn',
      period: period.label,
      detail: reconciled
        ? `Reconciled. CFO + CFI + CFF of ${formatCurrency(netChange, ctx)} matches the movement in the cash balance.`
        : `Unreconciled difference of ${formatCurrency(gap, ctx)} between the cash flow statement and the movement in balance sheet cash.`,
      evidence: {
        formula: 'Net Change in Cash = CFO + CFI + CFF (+ FX effect), compared with Closing Cash − Opening Cash',
        lines: [
          { label: 'CFO', display: formatCurrency(cfo, ctx), value: cfo, unit: 'currency', period: period.label },
          { label: 'CFI', display: formatCurrency(cfi, ctx), value: cfi, unit: 'currency', period: period.label },
          { label: 'CFF', display: formatCurrency(cff, ctx), value: cff, unit: 'currency', period: period.label },
          { label: 'Net change per cash flow statement', display: formatCurrency(netChange, ctx), value: netChange, unit: 'currency' },
          { label: 'Movement in balance sheet cash', display: formatCurrency(balanceMovement, ctx), value: balanceMovement, unit: 'currency' },
          { label: 'Difference', display: formatCurrency(gap, ctx), value: gap, unit: 'currency' },
        ],
      },
    });
  }

  /* ---------- Roll-forward and plausibility checks ---------- */
  for (let i = 1; i < periods.length; i += 1) {
    const period = periods[i]!;
    const prior = periods[i - 1]!;
    const rollForwards: [string, string, string][] = [
      ['inventory', 'changeInInventory', 'Inventory'],
      ['accountsReceivable', 'changeInReceivables', 'Receivables'],
      ['accountsPayable', 'changeInPayables', 'Payables'],
    ];
    for (const [balanceKey, cashFlowKey, label] of rollForwards) {
      const opening = val(prior, balanceKey);
      const closing = val(period, balanceKey);
      const movement = val(period, cashFlowKey);
      if (!isNum(opening) || !isNum(closing) || !isNum(movement)) continue;
      const expected = closing - opening;
      const gap = expected + movement;
      const tolerance = Math.max(Math.abs(closing) * 0.05, thresholds.balanceToleranceAbsolute);
      if (Math.abs(gap) > tolerance) {
        checks.push({
          id: `rollforward.${balanceKey}.${period.label}`,
          label: `${label} roll-forward — ${period.label}`,
          status: 'fail',
          period: period.label,
          detail: `${label} changed by ${formatCurrency(expected, ctx)} but the cash-flow movement was ${formatCurrency(movement, ctx)}; the ${formatCurrency(gap, ctx)} gap indicates a mapping or omitted-flow issue.`,
        });
      }
    }
  }
  for (const period of periods) {
    const revenue = val(period, 'revenue');
    const receivables = val(period, 'accountsReceivable');
    const cogs = val(period, 'cogs');
    const inventory = val(period, 'inventory');
    if (isNum(revenue) && isNum(receivables) && receivables > revenue) {
      checks.push({ id: `plausibility.receivables.${period.label}`, label: `Receivables exceed revenue — ${period.label}`, status: 'warn', period: period.label, detail: `Accounts receivable of ${formatCurrency(receivables, ctx)} exceeds revenue of ${formatCurrency(revenue, ctx)}. Check whether unbilled revenue has been combined with trade receivables.` });
    }
    if (isNum(cogs) && isNum(inventory) && cogs > 0 && inventory > cogs * 3) {
      checks.push({ id: `plausibility.inventory.${period.label}`, label: `Inventory exceeds COGS plausibility bound — ${period.label}`, status: 'warn', period: period.label, detail: `Inventory of ${formatCurrency(inventory, ctx)} is more than three times COGS of ${formatCurrency(cogs, ctx)}. Confirm units and source mapping.` });
    }
    const ebitda = val(period, 'ebitda');
    if (isNum(revenue) && isNum(ebitda) && (ebitda < -revenue || ebitda > revenue)) {
      checks.push({ id: `plausibility.margin.${period.label}`, label: `Margin outside plausibility bounds — ${period.label}`, status: 'warn', period: period.label, detail: `EBITDA margin is outside −100% to +100% (${formatMetric(ebitda / revenue * 100, 'percent', ctx)}). Confirm the imported units.` });
    }
  }

  /* ---------- Basis-break detection (specification I.3 / E8) ---------- */
  for (const bb of detectBasisBreaks(periods)) {
    checks.push({
      id: `basisbreak.${bb.key}.${bb.period}`,
      label: `Possible basis change in ${bb.label} — ${bb.period}`,
      status: 'warn',
      period: bb.period,
      detail:
        `${bb.label} moved ${bb.changePct > 0 ? '+' : ''}${bb.changePct.toFixed(1)}% between ${bb.priorPeriod} and ${bb.period} ` +
        `while ${bb.referenceLabels.join(' and ')} moved less than ${BASIS_BREAK_REFERENCE_TOLERANCE_PCT}%. ` +
        'A line that re-bases on its own is usually a change of accounting or mapping rather than a change in the business; ' +
        'trends and signals crossing this transition are not comparable.',
    });
  }

  /* ---------- Component vs reported total consistency ---------- */
  const totalChecks: { total: string; parts: string[]; label: string }[] = [
    { total: 'totalCurrentAssets', parts: ['cash', 'shortTermInvestments', 'accountsReceivable', 'inventory', 'otherCurrentAssets'], label: 'Current assets' },
    { total: 'totalCurrentLiabilities', parts: ['accountsPayable', 'shortTermDebt', 'otherCurrentLiabilities'], label: 'Current liabilities' },
  ];
  for (const period of periods) {
    for (const check of totalChecks) {
      if (period.sources[check.total] !== 'entered') continue;
      const enteredParts = check.parts.filter((p) => period.sources[p] === 'entered');
      if (enteredParts.length < check.parts.length) continue;
      const total = val(period, check.total);
      const sum = sumDefined(check.parts.map((p) => val(period, p)));
      if (!isNum(total) || !isNum(sum)) continue;
      const gap = total - sum;
      if (Math.abs(gap) > Math.max(Math.abs(total) * 0.01, thresholds.balanceToleranceAbsolute)) {
        checks.push({
          id: `total.${check.total}.${period.label}`,
          label: `${check.label} total — ${period.label}`,
          status: 'warn',
          period: period.label,
          detail: `The reported total of ${formatCurrency(total, ctx)} differs from the sum of its components (${formatCurrency(sum, ctx)}) by ${formatCurrency(gap, ctx)}. The reported total has been used.`,
        });
      }
    }
  }

  /* ---------- Missing core line items ---------- */
  const missingByItem = new Map<string, string[]>();
  for (const period of periods) {
    for (const key of CORE_LINE_ITEMS) {
      if (!isNum(val(period, key))) {
        const list = missingByItem.get(key) ?? [];
        list.push(period.label);
        missingByItem.set(key, list);
      }
    }
  }
  for (const [key, affected] of missingByItem) {
    checks.push({
      id: `missing.${key}`,
      label: `Missing: ${labelFor(key)}`,
      status: affected.length === periods.length ? 'warn' : 'warn',
      detail: `${labelFor(key)} is missing for ${affected.join(', ')}. Ratios that depend on it will be reported as unavailable for those periods rather than estimated.`,
    });
  }

  /* ---------- Metrics that could not be calculated ---------- */
  const firstPeriod = periods[0]?.label;
  for (const series of Object.values(metrics)) {
    const blocked = series.points
      .filter((p) => p.status === 'insufficient_data' || p.status === 'undefined_denominator')
      // A growth or average-balance metric is necessarily unavailable in the earliest period,
      // because there is no prior period to compare against. Reporting that as a data-quality
      // warning would bury the genuine problems under one row per metric, so it is not raised.
      .filter((p) => !(p.period === firstPeriod && requiresPriorPeriod(p)));

    if (blocked.length === 0 || blocked.length === series.points.length) {
      if (blocked.length > 0 && blocked.length === series.points.length && series.points.length > 0) {
        checks.push({
          id: `metric.${series.key}`,
          label: `${series.label} unavailable`,
          status: 'warn',
          detail: `${series.label} could not be calculated for any period. ${blocked[0]!.note ?? ''}`.trim(),
        });
      }
      continue;
    }
    checks.push({
      id: `metric.${series.key}`,
      label: `${series.label} partially unavailable`,
      status: 'warn',
      detail: `${series.label} could not be calculated for ${blocked.map((b) => b.period).join(', ')}. ${blocked[0]!.note ?? ''}`.trim(),
    });
  }

  /* ---------- Sign sanity checks ---------- */
  const shouldBeNonNegative = ['revenue', 'totalAssets', 'inventory', 'accountsReceivable', 'cash', 'sharesOutstanding'];
  for (const period of periods) {
    for (const key of shouldBeNonNegative) {
      const v = val(period, key);
      if (isNum(v) && v < 0) {
        checks.push({
          id: `sign.${key}.${period.label}`,
          label: `Unexpected negative value — ${labelFor(key)}`,
          status: 'warn',
          period: period.label,
          detail: `${labelFor(key)} is negative (${formatCurrency(v, ctx)}) in ${period.label}. Check whether the sign convention of the source data was inverted on import.`,
        });
      }
    }
    const equity = val(period, 'totalEquity');
    if (isNum(equity) && equity < 0) {
      checks.push({
        id: `sign.equity.${period.label}`,
        label: `Negative equity — ${period.label}`,
        status: 'warn',
        period: period.label,
        detail: `Total equity is negative (${formatCurrency(equity, ctx)}). Return on equity and debt-to-equity are not meaningful for this period and are reported as unavailable.`,
      });
    }
  }

  /* ---------- Completeness ---------- */
  const totalSlots = periods.length * CORE_LINE_ITEMS.length;
  const filled = periods.reduce(
    (acc, p) => acc + CORE_LINE_ITEMS.filter((k) => isNum(val(p, k))).length,
    0,
  );
  const completeness = totalSlots > 0 ? Math.round((filled / totalSlots) * 100) : 0;

  return {
    checks,
    passed: checks.filter((c) => c.status === 'pass').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    failures: checks.filter((c) => c.status === 'fail').length,
    skipped: checks.filter((c) => c.status === 'skipped').length,
    completeness,
  };
}

/**
 * True when a metric point could not be calculated only because it needs a prior period.
 *
 * The metric records the inputs it wanted; a missing input labelled "(prior)" in the earliest
 * period is expected rather than a defect in the data.
 */
function requiresPriorPeriod(point: { inputs: Record<string, Num>; note?: string }): boolean {
  const missingPriorInput = Object.entries(point.inputs).some(
    ([label, value]) => /\(prior\)|\(opening\)/i.test(label) && !isNum(value),
  );
  return missingPriorInput || /\(prior\)|\(opening\)/i.test(point.note ?? '');
}

/** Balance sheet difference for a single period, or null when it cannot be tested. */
export function balanceSheetDifference(period: FinancialPeriod): Num {
  const a = val(period, 'totalAssets');
  const l = val(period, 'totalLiabilities');
  const e = val(period, 'totalEquity');
  if (!isNum(a) || !isNum(l) || !isNum(e)) return null;
  return a - (l + e);
}

/** A line item moves this far, in percent, before the movement is treated as a candidate break. */
export const BASIS_BREAK_CHANGE_PCT = 60;
/** …and every reference line must have moved less than this, in percent, for it to count. */
export const BASIS_BREAK_REFERENCE_TOLERANCE_PCT = 20;

export interface BasisBreak {
  key: string;
  label: string;
  period: string;
  priorPeriod: string;
  changePct: number;
  referenceLabels: string[];
}

/**
 * Specification I.3 and explanation E8: find a line item that re-bases on its own.
 *
 * A single line moving by more than BASIS_BREAK_CHANGE_PCT while the lines it is economically
 * tied to barely move is far more likely to be a change of accounting policy, presentation or
 * input mapping than a change in the business. In the reference case a finance cost falling from
 * ₹22 Cr to ₹5.79 Cr produced a "debt-servicing capacity has improved" positive signal out of
 * what was an artefact. Detecting the break lets the transition be excluded rather than narrated.
 *
 * The check is deliberately conservative: it needs a real prior value to compute a percentage
 * against, and it stays silent unless EVERY reference line is quiet, so a company-wide step
 * change (an acquisition, a demerger) does not read as a basis break on every line at once.
 */
export function detectBasisBreaks(periods: FinancialPeriod[]): BasisBreak[] {
  const watched: { key: string; label: string; references: { key: string; label: string }[] }[] = [
    { key: 'interestExpense', label: 'finance cost', references: [{ key: 'longTermDebt', label: 'long-term debt' }, { key: 'shortTermDebt', label: 'short-term debt' }] },
    { key: 'depreciation', label: 'depreciation', references: [{ key: 'ppe', label: 'PP&E' }] },
    { key: 'cogs', label: 'cost of goods sold', references: [{ key: 'revenue', label: 'revenue' }] },
    { key: 'accountsReceivable', label: 'receivables', references: [{ key: 'revenue', label: 'revenue' }] },
    { key: 'inventory', label: 'inventory', references: [{ key: 'cogs', label: 'cost of goods sold' }, { key: 'revenue', label: 'revenue' }] },
    { key: 'otherIncome', label: 'other income', references: [{ key: 'cash', label: 'cash' }] },
    { key: 'operatingExpenses', label: 'operating expenses', references: [{ key: 'revenue', label: 'revenue' }] },
  ];

  const changePct = (prior: FinancialPeriod, current: FinancialPeriod, key: string): number | null => {
    const before = val(prior, key);
    const after = val(current, key);
    if (!isNum(before) || !isNum(after) || before === 0) return null;
    return ((after - before) / Math.abs(before)) * 100;
  };

  const breaks: BasisBreak[] = [];
  const ordered = [...periods].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i += 1) {
    const prior = ordered[i - 1]!;
    const current = ordered[i]!;
    for (const watch of watched) {
      const moved = changePct(prior, current, watch.key);
      if (moved === null || Math.abs(moved) < BASIS_BREAK_CHANGE_PCT) continue;
      const referenceMoves = watch.references.map((r) => ({ ...r, pct: changePct(prior, current, r.key) }));
      const usable = referenceMoves.filter((r) => r.pct !== null);
      if (usable.length === 0) continue;
      if (!usable.every((r) => Math.abs(r.pct as number) < BASIS_BREAK_REFERENCE_TOLERANCE_PCT)) continue;
      breaks.push({
        key: watch.key,
        label: watch.label,
        period: current.label,
        priorPeriod: prior.label,
        changePct: moved,
        referenceLabels: usable.map((r) => r.label),
      });
    }
  }
  return breaks;
}
