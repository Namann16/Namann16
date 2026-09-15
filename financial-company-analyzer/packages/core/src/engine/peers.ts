import type { MetricSeries, Num, PeerCompany, PeerComparisonRow } from '../types.js';
import { isNum, round } from '../utils/number.js';
import { METRIC_MAP } from './metricDefs.js';

/** Metrics used for peer benchmarking. Extend this list to add more comparison rows. */
export const PEER_METRIC_KEYS = [
  'revenueGrowth',
  'ebitdaMargin',
  'netMargin',
  'roe',
  'roic',
  'debtToEquity',
  'netDebtToEbitda',
  'currentRatio',
  'assetTurnover',
  'fcfMargin',
];

/**
 * Build the peer comparison table.
 *
 * Peer values are supplied by the user, not derived, so they are echoed as given. Where a peer
 * has no value for a metric that peer is excluded from the average rather than counted as zero,
 * and the row records that the coverage was partial.
 */
export function comparePeers(
  metrics: Record<string, MetricSeries>,
  peers: PeerCompany[] = [],
): PeerComparisonRow[] {
  return PEER_METRIC_KEYS.map((key) => {
    const def = METRIC_MAP[key];
    const own = metrics[key]?.latest;
    const companyValue: Num = own && own.status === 'ok' ? own.value : null;

    const peerValues = peers
      .map((p) => ({ name: p.name, value: isNum(p.metrics?.[key]) ? (p.metrics[key] as number) : null }))
      .filter((p) => p.name.trim().length > 0);

    const withValues = peerValues.filter((p) => isNum(p.value)) as { name: string; value: number }[];
    const peerAverage = withValues.length
      ? round(withValues.reduce((a, b) => a + b.value, 0) / withValues.length, 4)
      : null;

    const higherIsBetter = def?.higherIsBetter ?? true;
    const sorted = [...withValues].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));

    const missingPeers = peerValues.length - withValues.length;

    return {
      metricKey: key,
      label: def?.label ?? key,
      unit: def?.unit ?? 'number',
      company: companyValue,
      peerAverage,
      bestPeer: sorted[0] ?? null,
      worstPeer: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
      peerValues,
      available: isNum(companyValue) || withValues.length > 0,
      ...(missingPeers > 0
        ? { note: `${missingPeers} of ${peerValues.length} peers have no value for this metric and were excluded from the average.` }
        : !isNum(companyValue)
          ? { note: 'This metric could not be calculated for the company from the data supplied.' }
          : {}),
    } satisfies PeerComparisonRow;
  });
}
