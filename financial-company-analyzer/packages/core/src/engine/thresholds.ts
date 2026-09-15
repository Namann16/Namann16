import type { IndustryKey, ThresholdConfig } from '../types.js';

/**
 * Default thresholds used by the red-flag, positive-signal and health-scoring engines.
 *
 * These are judgement calls, not facts. Every one of them is overridable per company
 * (see `resolveThresholds`) and every flag that fires records the threshold it used,
 * so a user can always see why a statement was made and change the basis.
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  receivablesVsRevenueGapPp: 15,
  inventoryVsRevenueGapPp: 15,
  assetsVsRevenueGapPp: 15,
  marginDeclinePeriods: 2,
  marginMaterialPp: 1,
  netDebtToEbitdaHigh: 3,
  netDebtToEbitdaCritical: 4.5,
  interestCoverageLow: 3,
  interestCoverageCritical: 1.5,
  currentRatioLow: 1,
  currentRatioStrong: 1.5,
  quickRatioLow: 0.8,
  debtToEquityHigh: 1.5,
  cfoToNetIncomeLow: 0.8,
  cccIncreaseDaysMaterial: 15,
  roeStrong: 15,
  roicStrong: 12,
  roicHurdle: 10,
  revenueGrowthStrong: 12,
  revenueGrowthWeak: 2,
  fcfConversionLow: 0.5,
  balanceToleranceRatio: 0.005,
  balanceToleranceAbsolute: 0.01,
};

export interface IndustryProfile {
  key: IndustryKey;
  label: string;
  /** Threshold overrides that reflect normal structural differences between industries. */
  overrides: Partial<ThresholdConfig>;
  /** Metric keys that are not meaningful for this industry and should be suppressed. */
  suppressedMetrics: string[];
  /** Short note explaining the industry treatment, shown in Settings. */
  note: string;
}

/**
 * Industry configuration. Financial thresholds are NOT applied blindly across industries:
 * a 3x net-debt/EBITDA reading means something very different for a utility than for a
 * software company, and inventory-based metrics are meaningless for a bank.
 */
export const INDUSTRY_PROFILES: Record<IndustryKey, IndustryProfile> = {
  banking: {
    key: 'banking',
    label: 'Banking',
    overrides: { debtToEquityHigh: 12, netDebtToEbitdaHigh: 99, netDebtToEbitdaCritical: 99, currentRatioLow: 0, currentRatioStrong: 0, roeStrong: 14 },
    suppressedMetrics: ['inventoryTurnover', 'dio', 'cashConversionCycle', 'netDebtToEbitda', 'currentRatio', 'quickRatio', 'cashRatio'],
    note: 'Deposits are operating liabilities rather than leverage, and working-capital cycle metrics do not apply. Leverage and liquidity ratios built for non-financial firms are suppressed.',
  },
  financial_services: {
    key: 'financial_services',
    label: 'Financial Services',
    overrides: { debtToEquityHigh: 6, netDebtToEbitdaHigh: 99, netDebtToEbitdaCritical: 99, roeStrong: 15 },
    suppressedMetrics: ['inventoryTurnover', 'dio', 'cashConversionCycle', 'netDebtToEbitda'],
    note: 'Borrowings are raw material for a lender. Debt-based leverage limits are widened and inventory metrics suppressed.',
  },
  manufacturing: {
    key: 'manufacturing',
    label: 'Manufacturing',
    overrides: { netDebtToEbitdaHigh: 3, assetsVsRevenueGapPp: 20, roicStrong: 12 },
    suppressedMetrics: [],
    note: 'Capital intensive with meaningful inventory. Asset growth is allowed more headroom before it is flagged.',
  },
  fmcg: {
    key: 'fmcg',
    label: 'FMCG',
    overrides: { netDebtToEbitdaHigh: 2.5, roeStrong: 20, roicStrong: 18, currentRatioLow: 0.9 },
    suppressedMetrics: [],
    note: 'Negative working capital and high returns on capital are normal. Return expectations are raised and liquidity thresholds relaxed.',
  },
  retail: {
    key: 'retail',
    label: 'Retail',
    overrides: { netDebtToEbitdaHigh: 3.5, currentRatioLow: 0.9, inventoryVsRevenueGapPp: 12 },
    suppressedMetrics: [],
    note: 'Lease-heavy balance sheets and inventory-led working capital. Inventory build-up is flagged earlier.',
  },
  technology: {
    key: 'technology',
    label: 'Technology',
    overrides: { netDebtToEbitdaHigh: 2, roicStrong: 18, roeStrong: 18, revenueGrowthStrong: 18, assetsVsRevenueGapPp: 10 },
    suppressedMetrics: ['inventoryTurnover', 'dio'],
    note: 'Asset-light and growth-led. Growth and return expectations are raised; inventory metrics are usually not meaningful.',
  },
  pharmaceuticals: {
    key: 'pharmaceuticals',
    label: 'Pharmaceuticals',
    overrides: { netDebtToEbitdaHigh: 2.5, roicStrong: 14, receivablesVsRevenueGapPp: 18 },
    suppressedMetrics: [],
    note: 'Long receivable cycles in regulated and export markets are common, so the receivables gap tolerance is wider.',
  },
  automobile: {
    key: 'automobile',
    label: 'Automobile',
    overrides: { netDebtToEbitdaHigh: 3, assetsVsRevenueGapPp: 20, roicStrong: 11 },
    suppressedMetrics: [],
    note: 'Cyclical and capital intensive. Asset growth tolerance is widened and return expectations moderated.',
  },
  infrastructure: {
    key: 'infrastructure',
    label: 'Infrastructure',
    overrides: { netDebtToEbitdaHigh: 5, netDebtToEbitdaCritical: 7, interestCoverageLow: 2, assetsVsRevenueGapPp: 40, roicStrong: 9, currentRatioLow: 0.8 },
    suppressedMetrics: [],
    note: 'Long-gestation assets are debt funded by design. Leverage limits are materially wider and asset growth is expected to lead revenue.',
  },
  energy: {
    key: 'energy',
    label: 'Energy',
    overrides: { netDebtToEbitdaHigh: 4, interestCoverageLow: 2.5, assetsVsRevenueGapPp: 30, roicStrong: 10 },
    suppressedMetrics: [],
    note: 'Capital intensive and commodity exposed. Leverage and asset-growth tolerances are widened.',
  },
  telecom: {
    key: 'telecom',
    label: 'Telecom',
    overrides: { netDebtToEbitdaHigh: 4, interestCoverageLow: 2.5, currentRatioLow: 0.7, assetsVsRevenueGapPp: 30, roicStrong: 9 },
    suppressedMetrics: ['inventoryTurnover', 'dio'],
    note: 'Spectrum and network capex drive structurally high leverage and negative working capital. Inventory metrics are not meaningful.',
  },
  general: {
    key: 'general',
    label: 'General / Other',
    overrides: {},
    suppressedMetrics: [],
    note: 'Neutral defaults. Select a specific industry to apply structure-aware thresholds.',
  },
};

export function industryProfile(industry: IndustryKey | undefined): IndustryProfile {
  return INDUSTRY_PROFILES[industry ?? 'general'] ?? INDUSTRY_PROFILES.general;
}

/**
 * Resolve the thresholds in force: engine defaults, overlaid with industry structure,
 * overlaid with anything the user configured for this specific company.
 */
export function resolveThresholds(
  industry: IndustryKey | undefined,
  userOverrides?: Partial<ThresholdConfig>,
): ThresholdConfig {
  return {
    ...DEFAULT_THRESHOLDS,
    ...industryProfile(industry).overrides,
    ...(userOverrides ?? {}),
  };
}

export function suppressedMetricsFor(industry: IndustryKey | undefined): Set<string> {
  return new Set(industryProfile(industry).suppressedMetrics);
}

export const THRESHOLD_DESCRIPTIONS: Record<keyof ThresholdConfig, string> = {
  receivablesVsRevenueGapPp: 'Percentage points by which receivables growth must exceed revenue growth before a working-capital flag is raised.',
  inventoryVsRevenueGapPp: 'Percentage points by which inventory growth must exceed revenue growth before a flag is raised.',
  assetsVsRevenueGapPp: 'Percentage points by which total asset growth must exceed revenue growth before an asset-efficiency flag is raised.',
  marginDeclinePeriods: 'Number of consecutive periods of EBITDA margin decline required to call margins deteriorating.',
  marginMaterialPp: 'Minimum percentage-point move for a margin change to be described as material.',
  netDebtToEbitdaHigh: 'Net debt / EBITDA above which leverage is described as elevated.',
  netDebtToEbitdaCritical: 'Net debt / EBITDA above which leverage is treated as a critical concern.',
  interestCoverageLow: 'Interest coverage below which interest-servicing capacity is described as weak.',
  interestCoverageCritical: 'Interest coverage below which interest-servicing capacity is treated as critical.',
  currentRatioLow: 'Current ratio below which short-term liquidity is flagged.',
  currentRatioStrong: 'Current ratio at or above which liquidity is described as comfortable.',
  quickRatioLow: 'Quick ratio below which liquidity excluding inventory is flagged.',
  debtToEquityHigh: 'Debt / equity above which the capital structure is described as aggressive.',
  cfoToNetIncomeLow: 'CFO / net income below which earnings quality is questioned.',
  cccIncreaseDaysMaterial: 'Increase in the cash conversion cycle (days) treated as a material deterioration.',
  roeStrong: 'Return on equity (%) at or above which returns are described as strong.',
  roicStrong: 'Return on invested capital (%) at or above which capital efficiency is described as strong.',
  roicHurdle: 'Indicative cost-of-capital hurdle (%) used only for commentary on value creation.',
  revenueGrowthStrong: 'Revenue growth (%) at or above which growth is described as strong.',
  revenueGrowthWeak: 'Revenue growth (%) below which growth is described as weak.',
  fcfConversionLow: 'FCF / net income below which cash conversion is flagged.',
  balanceToleranceRatio: 'Balance sheet identity tolerance as a fraction of total assets (rounding allowance).',
  balanceToleranceAbsolute: 'Absolute floor for the balance sheet identity tolerance, in reporting units.',
};
