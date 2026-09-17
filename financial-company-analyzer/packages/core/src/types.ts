/**
 * Core domain types for the Financial Company Analyzer.
 *
 * The application keeps three layers strictly separate:
 *   1. RAW DATA        - numbers a user entered or imported  (`FinancialPeriod.values` with source 'entered')
 *   2. CALCULATED DATA - numbers this engine derived         (`MetricValue`, and derived line items with source 'calculated')
 *   3. INTERPRETATION  - language generated from layer 2     (`Insight`, `Flag`, `ExecutiveSummary`)
 *
 * Nothing in layer 3 may be produced without the supporting layer-2 evidence being attached to it.
 */

/** A number that may legitimately be absent. `null` means "not available", never "zero". */
export type Num = number | null;

export type ValueSource = 'entered' | 'calculated';

/** Why a metric has no value. Distinguishes "not available" from "zero" from "not applicable". */
export type MetricStatus =
  | 'ok'
  | 'insufficient_data'
  | 'undefined_denominator'
  | 'not_applicable';

export type MetricUnit =
  | 'currency'
  | 'percent'
  | 'times'
  | 'days'
  | 'number'
  | 'per_share';

/**
 * A single calculated metric, carrying full provenance so that any statement made about it
 * can be traced back to the raw inputs it was computed from.
 */
export interface MetricValue {
  key: string;
  label: string;
  period: string;
  value: Num;
  unit: MetricUnit;
  /** Human readable formula, e.g. "Net Income / Average Shareholders' Equity". */
  formula: string;
  /** The exact raw inputs used, keyed by readable name. */
  inputs: Record<string, Num>;
  status: MetricStatus;
  /** Present when status !== 'ok' or when a methodology caveat applies. */
  note?: string;
  /** Short explanation of what the metric means, for tooltips. */
  meaning?: string;
  /** Direction that is generally favourable. Used by trend labelling, never by itself an assessment. */
  higherIsBetter?: boolean;
}

/** A metric tracked across all periods, with the derived change and trend. */
export interface MetricSeries {
  key: string;
  label: string;
  unit: MetricUnit;
  formula: string;
  meaning?: string;
  higherIsBetter?: boolean;
  group: MetricGroup;
  points: MetricValue[];
  latest: MetricValue | null;
  previous: MetricValue | null;
  /** latest - previous, in the metric's own unit. null when either side is unavailable. */
  change: Num;
  /** Percentage change vs previous. null for percent/days metrics where absolute change is the meaningful measure. */
  changePercent: Num;
  trend: Trend;
}

export type MetricGroup =
  | 'growth'
  | 'profitability'
  | 'liquidity'
  | 'solvency'
  | 'efficiency'
  | 'workingCapital'
  | 'cashFlow'
  | 'returns'
  | 'perShare'
  | 'valuation';

export type Trend = 'improving' | 'stable' | 'deteriorating' | 'volatile' | 'insufficient_data';

export type StatementKey = 'income' | 'balance' | 'cashFlow' | 'share';

export interface LineItemDef {
  key: string;
  label: string;
  statement: StatementKey;
  /** Section inside the statement, used for grouped rendering. */
  section: string;
  /** True when this item is normally a total that the engine can derive from its components. */
  derivable?: boolean;
  /** Values that are conventionally negative (e.g. COGS entered as a positive cost). */
  sign?: 'positive' | 'negative' | 'any';
  unit?: MetricUnit;
  description?: string;
}

/** One financial year of raw data. */
export interface FinancialPeriod {
  /** Display label, e.g. "FY24". Must be unique inside a company. */
  label: string;
  /** Period end date (ISO), optional but used for ordering when present. */
  endDate?: string | null;
  /** Ordering key. Lower = earlier. */
  order: number;
  /** Raw + derived line item values, keyed by LineItemDef.key. */
  values: Record<string, Num>;
  /** Which of the above were entered by the user and which the engine derived. */
  sources: Record<string, ValueSource>;
  /** True when the period covers fewer than 12 months (interim / stub period). */
  isPartial?: boolean;
}

export type Units = 'units' | 'thousands' | 'lakhs' | 'millions' | 'crores' | 'billions';
export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'SGD' | 'OTHER';

export type IndustryKey =
  | 'banking'
  | 'financial_services'
  | 'manufacturing'
  | 'fmcg'
  | 'retail'
  | 'technology'
  | 'pharmaceuticals'
  | 'automobile'
  | 'infrastructure'
  | 'energy'
  | 'telecom'
  | 'general';

export interface CompanyProfile {
  id?: string;
  name: string;
  industry: IndustryKey;
  sector?: string;
  country?: string;
  currency: Currency;
  currencyLabel?: string;
  fiscalYearEnd?: string;
  reportingPeriod?: 'annual' | 'half_yearly' | 'quarterly';
  /** Opt in to annualized growth and days-based metrics for interim reporting. */
  annualizeInterimMetrics?: boolean;
  units: Units;
  ticker?: string | null;
  benchmark?: string | null;
  marketCap?: Num;
  sharePrice?: Num;
  sharesOutstanding?: Num;
  isSample?: boolean;
  notes?: string;
}

export interface PeerCompany {
  name: string;
  /** Peer metrics keyed by metric key (e.g. 'ebitdaMargin'), stored in the metric's native unit. */
  metrics: Record<string, Num>;
  source?: string;
}

export interface CompanyDataset {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  peers?: PeerCompany[];
  thresholds?: Partial<ThresholdConfig>;
}

export interface ScenarioModification {
  period: string;
  values: Record<string, Num>;
}

export interface ScenarioMetricChange {
  key: string;
  label: string;
  period: string;
  base: Num;
  scenario: Num;
  delta: Num;
  unit: MetricUnit;
}

export interface ScenarioDiff {
  base: AnalysisResult;
  scenario: AnalysisResult;
  metricChanges: ScenarioMetricChange[];
  healthDelta: Num;
  addedRedFlags: string[];
  removedRedFlags: string[];
}

/* ------------------------------------------------------------------ */
/* Interpretation layer                                               */
/* ------------------------------------------------------------------ */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Sentiment = 'positive' | 'negative' | 'neutral' | 'investigate';

/** A traceable calculation step shown behind a "view calculation" control. */
export interface EvidenceLine {
  label: string;
  /** Pre-formatted display value, e.g. "FY26 1,720 Cr" or "14.7%". */
  display: string;
  value?: Num;
  unit?: MetricUnit;
  period?: string;
}

export interface Evidence {
  /** Plain-language description of the calculation performed. */
  formula?: string;
  lines: EvidenceLine[];
  conclusion?: string;
}

export interface Flag {
  id: string;
  rule: string;
  title: string;
  /** The analytical statement. Must be supported by `evidence`. */
  detail: string;
  sentiment: Sentiment;
  severity: Severity;
  category: MetricGroup | 'dataQuality' | 'accounting';
  period: string;
  evidence: Evidence;
  /** Threshold(s) that triggered the rule, so the user can see why and reconfigure. */
  thresholdUsed?: Record<string, number>;
}

export interface Insight {
  id: string;
  title: string;
  narrative: string;
  sentiment: Sentiment;
  importance: number; // 0-100, used for ordering in the executive summary
  category: MetricGroup | 'overview' | 'accounting';
  evidence: Evidence;
}

export type HealthLabel = 'Excellent' | 'Strong' | 'Healthy' | 'Watch' | 'Concern' | 'Critical' | 'Not rated';

export interface HealthFactor {
  label: string;
  direction: 'supports' | 'offsets' | 'neutral';
  detail: string;
  /** Points contributed to the pillar score (can be negative). */
  points: number;
  evidence?: Evidence;
}

export interface HealthPillar {
  key: MetricGroup;
  label: string;
  /** 0-100. null when there was not enough data to rate the pillar. */
  score: number | null;
  label_: HealthLabel;
  weight: number;
  factors: HealthFactor[];
  coverage: number; // 0-1, proportion of the pillar's checks that had data
}

export interface HealthScore {
  overall: number | null;
  label: HealthLabel;
  pillars: HealthPillar[];
  /** Number of pillar checks that could not be evaluated for lack of data. */
  unratedChecks: number;
  methodology: string;
}

export interface DataQualityCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  detail: string;
  period?: string;
  evidence?: Evidence;
}

export interface DataQualityReport {
  checks: DataQualityCheck[];
  passed: number;
  warnings: number;
  failures: number;
  skipped: number;
  /** 0-100 completeness of the core line items across all periods. */
  completeness: number;
}

export interface DuPontPeriod {
  period: string;
  roe: Num;
  netMargin: Num;
  assetTurnover: Num;
  equityMultiplier: Num;
  /** Product of the three components; compared against directly computed ROE as a consistency check. */
  reconstructedRoe: Num;
  status: MetricStatus;
  note?: string;
}

export interface DuPontAnalysis {
  periods: DuPontPeriod[];
  /** Attribution of the ROE change between the two most recent comparable periods. */
  attribution: {
    from: string;
    to: string;
    roeChange: Num;
    marginEffect: Num;
    turnoverEffect: Num;
    leverageEffect: Num;
    primaryDriver: 'margin' | 'turnover' | 'leverage' | 'none';
    narrative: string;
    evidence: Evidence;
  } | null;
}

export interface ExecutiveSummary {
  headline: string;
  overallAssessment: string;
  strengths: Insight[];
  concerns: Insight[];
  sections: { key: string; label: string; body: string; sentiment: Sentiment }[];
  takeaways: string[];
}

export interface PeerComparisonRow {
  metricKey: string;
  label: string;
  unit: MetricUnit;
  company: Num;
  peerAverage: Num;
  bestPeer: { name: string; value: Num } | null;
  worstPeer: { name: string; value: Num } | null;
  peerValues: { name: string; value: Num }[];
  available: boolean;
  note?: string;
}

/** Full analysis output. This is the only thing the UI (and any LLM layer) should consume. */
export interface AnalysisResult {
  company: CompanyProfile;
  periods: { label: string; order: number; isPartial?: boolean }[];
  latestPeriod: string | null;
  /** Normalized statements, with per-value provenance. */
  statements: FinancialPeriod[];
  metrics: Record<string, MetricSeries>;
  metricsByGroup: Record<MetricGroup, MetricSeries[]>;
  cagr: MetricValue[];
  duPont: DuPontAnalysis;
  health: HealthScore;
  redFlags: Flag[];
  positiveSignals: Flag[];
  insights: Insight[];
  executiveSummary: ExecutiveSummary;
  dataQuality: DataQualityReport;
  peerComparison: PeerComparisonRow[];
  thresholds: ThresholdConfig;
  generatedAt: string;
  engineVersion: string;
}

/* ------------------------------------------------------------------ */
/* Configurable thresholds                                            */
/* ------------------------------------------------------------------ */

export interface ThresholdConfig {
  /** Percentage points by which receivables growth must exceed revenue growth to flag. */
  receivablesVsRevenueGapPp: number;
  inventoryVsRevenueGapPp: number;
  assetsVsRevenueGapPp: number;
  /** Consecutive periods of margin decline required to flag deterioration. */
  marginDeclinePeriods: number;
  /** Minimum absolute pp move for a margin change to be called material. */
  marginMaterialPp: number;
  netDebtToEbitdaHigh: number;
  netDebtToEbitdaCritical: number;
  interestCoverageLow: number;
  interestCoverageCritical: number;
  currentRatioLow: number;
  currentRatioStrong: number;
  quickRatioLow: number;
  debtToEquityHigh: number;
  cfoToNetIncomeLow: number;
  cccIncreaseDaysMaterial: number;
  roeStrong: number;
  roicStrong: number;
  /** Minimum WACC-style hurdle used only for commentary, never as a fact. */
  roicHurdle: number;
  revenueGrowthStrong: number;
  revenueGrowthWeak: number;
  fcfConversionLow: number;
  /** Relative tolerance for the balance sheet identity check (fraction of total assets). */
  balanceToleranceRatio: number;
  /** Absolute tolerance floor for the balance sheet identity check. */
  balanceToleranceAbsolute: number;
}
