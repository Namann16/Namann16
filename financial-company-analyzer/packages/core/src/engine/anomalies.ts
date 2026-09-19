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
  if (key === 'inventoryGrowth' || key === 'receivablesGrowth') {
    const contextPass = context?.unusual === true;
    facts.push(result('prior_exceptional', 'Prior period was exceptional', contextPass,
      contextPass ? [`${period.label} is flagged unusual: ${context?.unusualReason ?? 'reason not supplied'}.`] : [],
      ['Unusual-period flag and reason'], 'downgrade_one',
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
