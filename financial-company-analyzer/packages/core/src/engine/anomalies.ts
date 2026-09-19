import type { Anomaly, CompanyDataset, ExplanationResult, FinancialPeriod, MetricSeries } from '../types.js';
import { isNum } from '../utils/number.js';
import { val } from './normalize.js';

type Band = [number, number];

const BANDS: Record<string, Band> = {
  dso: [0, 120], dio: [0, 365], inventoryGrowth: [-20, 20],
  receivablesGrowth: [-20, 30], assetTurnover: [0.2, 5],
  roa: [-20, 40], roce: [-20, 50],
};

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

function candidates(dataset: CompanyDataset, period: FinancialPeriod, key: string): ExplanationResult[] {
  const context = dataset.businessContext?.periods?.[period.label];
  const customerAdvances = (val(period, 'customerAdvancesCurrent') ?? 0) + (val(period, 'customerAdvancesNonCurrent') ?? 0);
  const inventory = val(period, 'inventory');
  const receivables = val(period, 'accountsReceivable');
  const trade = val(period, 'tradeReceivables');
  const totalAssets = val(period, 'totalAssets');
  const cash = (val(period, 'cash') ?? 0) + (val(period, 'shortTermInvestments') ?? 0);
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
  return facts;
}

export function detectAnomalies(dataset: CompanyDataset, metrics: Record<string, MetricSeries>): Anomaly[] {
  const output: Anomaly[] = [];
  for (const [key, band] of Object.entries(BANDS)) {
    const series = metrics[key];
    if (!series) continue;
    for (const point of series.points) {
      if (point.status !== 'ok' || !isNum(point.value)) continue;
      const value = point.value;
      if (value >= band[0] && value <= band[1]) continue;
      const width = Math.max(band[1] - band[0], 1);
      const deviation = value < band[0] ? (band[0] - value) / width : (value - band[1]) / width;
      const candidatesFound = candidates(dataset, dataset.periods.find((p) => p.label === point.period)!, key);
      const passed = candidatesFound.find((candidate) => candidate.evidence.passed);
      output.push({
        metric: key, period: point.period, value, genericBand: band, deviation,
        candidates: candidatesFound,
        status: passed ? passed.severityEffect === 'upgrade_one' ? 'explained_concerning' : 'explained_benign' : 'unexplained',
        finalSeverity: passed ? 'info' : deviation > 1 ? 'high' : 'medium',
      });
    }
  }
  return output;
}
