import type { Anomaly, CompanyDataset, ExplanationResult, FinancialPeriod, MetricSeries, ThresholdConfig } from '../types.js';
import { isNum } from '../utils/number.js';
import { detectBasisBreaks, type BasisBreak } from './dataQuality.js';
import { genericBandFor } from './health.js';
import { val } from './normalize.js';

type Band = [number, number];

/** Which side of the band is the unfavourable one for a given metric. */
type BadSide = 'below' | 'above' | 'both';

interface BandSpec {
  band: Band;
  badSide: BadSide;
}

/**
 * Generic bands for metrics that no pillar check scores on a level. Metrics that ARE scored take
 * their band from the scoring configuration instead (see `genericBandFor`), so a value cannot be
 * marked normal here while being scored at the floor of its band there.
 */
const SUPPLEMENTARY_BANDS: Record<string, BandSpec> = {
  dso: { band: [0, 120], badSide: 'above' },
  dio: { band: [0, 365], badSide: 'above' },
  // A build-up is the concern the reference case turns on, but an abrupt collapse in either line
  // is equally worth an explanation, so neither direction is assumed benign.
  inventoryGrowth: { band: [-20, 20], badSide: 'both' },
  receivablesGrowth: { band: [-20, 30], badSide: 'both' },
};

/** Metrics whose band comes from the scoring configuration rather than the table above. */
const SCORED_METRICS = ['assetTurnover', 'roa', 'roce', 'roe', 'roic', 'currentRatio', 'interestCoverage'];

/** Every metric the detector looks at, with the band to judge it against. */
function bandsFor(thresholds: ThresholdConfig): Record<string, BandSpec> {
  const bands: Record<string, BandSpec> = { ...SUPPLEMENTARY_BANDS };
  for (const key of SCORED_METRICS) {
    const scored = genericBandFor(key, thresholds);
    // A scoring band runs from weak to strong, so for a higher-is-better metric the unfavourable
    // side is below the band and for a lower-is-better metric it is above it.
    if (scored) bands[key] = { band: scored.band, badSide: scored.lowerIsBetter ? 'above' : 'below' };
  }
  return bands;
}

/**
 * How far outside its band a value sits, in band-widths, and whether that warrants an anomaly.
 *
 * Being outside the band on the favourable side is usually just good performance: an ROE of 24%
 * against a band topping out at 20% is not an anomaly, and reporting it as one — then escalating
 * it for having no explanation — is exactly the kind of confident nonsense this engine exists to
 * avoid. The favourable side only counts once the value clears the band by more than a full
 * band-width, which is the "very high ROCE or ROE" case explanation E10 is written for.
 */
function deviationOf(value: number, spec: BandSpec): number | null {
  const [low, high] = spec.band;
  if (value >= low && value <= high) return null;
  const width = Math.max(high - low, 1);
  const outside = value < low ? (low - value) / width : (value - high) / width;
  const onBadSide = spec.badSide === 'both'
    || (spec.badSide === 'below' ? value < low : value > high);
  if (onBadSide) return outside;
  return outside > 1 ? outside : null;
}

function result(
  id: string, label: string, passed: boolean, facts: string[], missing: string[],
  effect: ExplanationResult['severityEffect'], narrative: string,
): ExplanationResult {
  return {
    id, label,
    evidence: { passed, confidence: passed ? facts.length > 1 ? 'strong' : 'moderate' : 'weak', supportingFacts: facts, missingInputs: missing },
    severityEffect: effect, narrative,
  };
}

/**
 * Which raw line items each banded metric is computed from. Explanation E8 needs this: a basis
 * break only bears on an anomaly when the line that re-based is one the metric actually uses.
 * Matching on MetricValue.inputs is not viable — those keys are readable names, not canonical ones.
 */
const METRIC_INPUTS: Record<string, string[]> = {
  dso: ['accountsReceivable', 'revenue'],
  dio: ['inventory', 'cogs'],
  inventoryGrowth: ['inventory'],
  receivablesGrowth: ['accountsReceivable'],
  assetTurnover: ['revenue', 'totalAssets'],
  roa: ['netIncome', 'totalAssets'],
  roce: ['ebit', 'otherIncome', 'totalEquity'],
};

function candidates(
  dataset: CompanyDataset,
  period: FinancialPeriod,
  key: string,
  basisBreaks: BasisBreak[] = [],
): ExplanationResult[] {
  const context = dataset.businessContext?.periods?.[period.label];
  const customerAdvances = (val(period, 'customerAdvancesCurrent') ?? 0) + (val(period, 'customerAdvancesNonCurrent') ?? 0);
  const inventory = val(period, 'inventory');
  const receivables = val(period, 'accountsReceivable');
  const trade = val(period, 'tradeReceivables');
  const totalAssets = val(period, 'totalAssets');
  const cash = (val(period, 'cash') ?? 0) + (val(period, 'shortTermInvestments') ?? 0);
  const debt = (val(period, 'shortTermDebt') ?? 0) + (val(period, 'longTermDebt') ?? 0);
  const liabilities = val(period, 'totalLiabilities');
  const pbt = val(period, 'pbt');
  const otherIncome = val(period, 'otherIncome');
  const prior = dataset.periods.find((candidate) => candidate.order === period.order - 1);
  const facts: ExplanationResult[] = [];
  if (key === 'dio') {
    const passed = context?.revenueRecognitionBasis === 'over_time_milestone' || context?.revenueRecognitionBasis === 'over_time_cost_to_cost';
    facts.push(result('long_cycle_production', 'Long-cycle production inventory', passed && customerAdvances > 0 && customerAdvances > (inventory ?? Infinity) * 0.2,
      passed ? [`Revenue recognition basis is ${context?.revenueRecognitionBasis}.`, `Customer advances are ${customerAdvances.toFixed(2)}.`] : [],
      ['Revenue recognition basis', 'Customer advances'], 'downgrade_to_info',
      'Long-cycle production and advance-funded contracts may make high inventory days structural.'));
  }
  if (key === 'dso') {
    const passed = isNum(trade) && isNum(receivables) && receivables > trade * 1.2;
    facts.push(result('unbilled_receivables', 'Receivables include unbilled revenue', passed,
      passed ? [`Trade receivables are ${trade!.toFixed(2)} while total receivables are ${receivables!.toFixed(2)}.`] : [],
      ['Trade receivables (billed only)', 'Unbilled revenue / contract assets'], 'downgrade_to_info',
      'The total-receivables DSO is not comparable with peers when unbilled revenue is included.'));
  }
  if (key === 'assetTurnover' || key === 'roa') {
    const passed = isNum(totalAssets) && cash > totalAssets * 0.25;
    facts.push(result('cash_heavy_balance_sheet', 'Cash-heavy balance sheet', passed,
      passed ? [`Cash and liquid investments are ${cash.toFixed(2)}, ${((cash / totalAssets!) * 100).toFixed(1)}% of assets.`] : [],
      ['Cash', 'Short-term investments', 'Total assets'], 'downgrade_to_info',
      'Excess cash suppresses asset-based operating returns; ex-cash variants should be reviewed.'));
  }
  if (key === 'roce') {
    const equity = val(period, 'totalEquity');
    const advances = customerAdvances;
    const lowBorrowing = isNum(totalAssets) && debt < totalAssets * 0.05;
    const customerFunded = isNum(liabilities) && isNum(totalAssets) && advances > totalAssets * 0.3;
    facts.push(result('customer_funded_capital', 'Capital employed includes customer funding', customerFunded && lowBorrowing,
      customerFunded ? [`Customer advances are ${advances.toFixed(2)}, above 30% of assets.`, `Borrowings are ${debt.toFixed(2)}.`] : [],
      ['Customer advances', 'Total liabilities', 'Total assets', 'Borrowings'], 'reframe_as_positive',
      `ROCE is affected by interest-free customer funding; equity-plus-debt and advances-excluded variants should be compared.`));
    facts.push(result('negative_invested_capital', 'Advance-funded negative invested capital', isNum(equity) && equity + debt - cash < 0,
      isNum(equity) ? [`Invested capital on a surplus-cash basis is ${(equity + debt - cash).toFixed(2)}.`] : [],
      ['Total equity', 'Debt', 'Surplus cash'], 'upgrade_one',
      'A negative invested-capital denominator makes a conventional ROIC/ROCE conclusion misleading.'));
  }
  if (key === 'inventoryGrowth' || key === 'receivablesGrowth' || key === 'cfoToNetIncome') {
    // E7 tests the PRIOR period, not this one: a large year-on-year deterioration against an
    // exceptional base is an artefact of the base. The flag may sit on the period record (C4) or
    // in the business-context sheet (C3); either is accepted.
    const priorContext = prior ? dataset.businessContext?.periods?.[prior.label] : undefined;
    const flagged = prior?.unusual === true || priorContext?.unusual === true;
    const reason = prior?.unusualReason ?? priorContext?.unusualReason;
    facts.push(result('prior_exceptional', 'Prior period was exceptional', flagged,
      flagged ? [`${prior!.label} is flagged as not representative: ${reason ?? 'no reason was supplied'}.`] : [],
      ['Unusual-period flag on the comparison period'], 'downgrade_one',
      'Rebase the comparison against a normal-period baseline before treating the movement as deterioration.'));
  }
  if (key === 'inventoryGrowth') {
    const orderBook = context?.orderBook;
    const priorContext = prior ? dataset.businessContext?.periods?.[prior.label] : undefined;
    const orderBookGrowth = isNum(orderBook) && isNum(priorContext?.orderBook) && priorContext.orderBook !== 0
      ? (orderBook - priorContext.orderBook) / Math.abs(priorContext.orderBook)
      : null;
    const revenueGrowth = isNum(val(period, 'revenue')) && isNum(val(prior, 'revenue')) && val(prior, 'revenue') !== 0
      ? (val(period, 'revenue')! - val(prior, 'revenue')!) / Math.abs(val(prior, 'revenue')!)
      : null;
    const passed = isNum(orderBookGrowth) && isNum(revenueGrowth) && orderBookGrowth > revenueGrowth && customerAdvances > 0;
    facts.push(result('order_book_build', 'Order-book build ahead of revenue', passed,
      passed ? [`Order book growth exceeded revenue growth (${(orderBookGrowth! * 100).toFixed(1)}% vs ${(revenueGrowth! * 100).toFixed(1)}%).`, `Customer advances are ${customerAdvances.toFixed(2)}.`] : [],
      ['Order book for two periods', 'Revenue for two periods', 'Customer advances'], 'downgrade_to_info',
      'Inventory growth may reflect production ramp-up against contracted future demand.'));
  }
  if (key === 'roa' || key === 'assetTurnover') {
    const ppe = val(period, 'ppe');
    const intangibles = (val(period, 'intangibleAssets') ?? 0) + (val(period, 'goodwill') ?? 0);
    facts.push(result('asset_light_model', 'Asset-light business model', isNum(ppe) && isNum(totalAssets) && ppe < totalAssets * 0.15 && intangibles > ppe,
      isNum(ppe) ? [`PP&E is ${ppe.toFixed(2)} and intangible assets plus goodwill are ${intangibles.toFixed(2)}.`] : [],
      ['PP&E', 'Intangible assets', 'Goodwill'], 'neutral',
      'Returns are influenced by the size and composition of the asset base; inspect hidden leverage and intangible investment.'));
  }
  if (key === 'roa') {
    const passed = isNum(pbt) && isNum(otherIncome) && pbt > 0 && otherIncome > pbt * 0.2;
    facts.push(result('structural_treasury_income', 'Structural treasury income', passed && cash > 0,
      passed ? [`Other income is ${otherIncome!.toFixed(2)}, ${(otherIncome! / pbt! * 100).toFixed(1)}% of PBT.`, `Cash and investments are ${cash.toFixed(2)}.`] : [],
      ['Other income', 'Profit before tax', 'Cash and investments'], 'neutral',
      'Other income appears linked to a cash-heavy balance sheet and should be separated from operating returns.'));
  }
  // E8. A line that re-based on its own makes the transition non-comparable, so the anomaly is
  // real but it is an artefact of the input rather than a fact about the business. The severity
  // is retained, not softened — the finding is redirected at the data.
  const relevantBreaks = basisBreaks.filter(
    (bb) => bb.period === period.label && (METRIC_INPUTS[key] ?? []).includes(bb.key),
  );
  facts.push(result('basis_break', 'Reporting basis changed between periods', relevantBreaks.length > 0,
    relevantBreaks.map((bb) => `${bb.label} moved ${bb.changePct > 0 ? '+' : ''}${bb.changePct.toFixed(1)}% from ${bb.priorPeriod} while ${bb.referenceLabels.join(' and ')} did not.`),
    ['Two comparable periods for the metric’s input lines'], 'neutral',
    'One of this metric’s inputs re-based between periods, so the movement is not comparable and should be excluded from trend analysis until the basis is confirmed.'));

  return facts;
}

export function detectAnomalies(
  dataset: CompanyDataset,
  metrics: Record<string, MetricSeries>,
  thresholds: ThresholdConfig,
): Anomaly[] {
  const output: Anomaly[] = [];
  const basisBreaks = detectBasisBreaks(dataset.periods);
  for (const [key, spec] of Object.entries(bandsFor(thresholds))) {
    const series = metrics[key];
    if (!series) continue;
    for (const point of series.points) {
      if (point.status !== 'ok' || !isNum(point.value)) continue;
      const value = point.value;
      const deviation = deviationOf(value, spec);
      if (deviation === null) continue;
      const band = spec.band;
      const owner = dataset.periods.find((p) => p.label === point.period);
      if (!owner) continue;
      const candidatesFound = candidates(dataset, owner, key, basisBreaks);
      const passing = candidatesFound.filter((candidate) => candidate.evidence.passed);
      // A cause that sharpens the finding takes precedence over one that softens it: an anomaly
      // that is both structurally normal and sitting on a re-based input is still not comparable.
      const concerning = passing.find(
        (candidate) => candidate.severityEffect === 'upgrade_one' || candidate.severityEffect === 'neutral',
      );
      const benign = passing.find(
        (candidate) => candidate.severityEffect === 'downgrade_to_info'
          || candidate.severityEffect === 'downgrade_one'
          || candidate.severityEffect === 'reframe_as_positive',
      );
      const status = concerning ? 'explained_concerning' : benign ? 'explained_benign' : 'unexplained';
      output.push({
        metric: key, period: point.period, value, genericBand: band, deviation,
        candidates: candidatesFound,
        status,
        // An anomaly nobody can account for is more serious than one with an established cause.
        finalSeverity: status === 'explained_benign'
          ? 'info'
          : status === 'explained_concerning'
            ? deviation > 1 ? 'high' : 'medium'
            : deviation > 1 ? 'critical' : 'high',
      });
    }
  }
  return output;
}
