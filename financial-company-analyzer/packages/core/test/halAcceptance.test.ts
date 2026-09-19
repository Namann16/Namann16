import { describe, expect, it } from 'vitest';
import {
  analyze,
  assessNarrative,
  detectBasisBreaks,
  findContradictions,
  genericBandFor,
  resolveThresholds,
  withWindows,
  buildSampleDataset,
  normalizePeriods,
  suggestMappings,
  LINE_ITEM_KEYS,
  SYNONYMS,
} from '../src/index.js';
import type { Flag } from '../src/types.js';
import { HAL_REFERENCE, halDataset } from './fixtures/hal.js';
import { dataset, period } from './helpers.js';

/**
 * Acceptance criteria from the upgrade specification, Part J.
 *
 * Only criteria that follow from figures the specification actually supplies are asserted. The
 * fixture's FY25 columns are placeholders (see `fixtures/hal.ts`), so criteria that need HAL's
 * real prior-year statements — the 31.9% ROCE basis, the Operating Efficiency score, the absolute
 * FCF figures — are listed at the bottom as pending rather than asserted against invented data.
 */
describe('Part J — HAL reference case', () => {
  const result = analyze(halDataset());

  it('J1: reports net debt / EBITDA as a signed value, not floored at zero', () => {
    const point = result.metrics.netDebtToEbitda?.latest;
    expect(point?.status).toBe('ok');
    // (65.82 − 46,195.76) / 9,769.83 = −4.7217
    expect(point?.value).toBeCloseTo(HAL_REFERENCE.netDebtToEbitdaFy26, 2);
    expect(point?.note).toMatch(/net cash/i);
  });

  it('J2: inventory growth of +44.7% is never labelled as an improvement', () => {
    const series = result.metrics.inventoryGrowth;
    expect(series?.latest?.value).toBeCloseTo(44.69, 1);
    expect(series?.trend).not.toBe('improving');
  });

  it('J5: the FY26 inventory line raises a roll-forward data-quality failure', () => {
    const check = result.dataQuality.checks.find((c) => c.id === 'rollforward.inventory.FY26');
    expect(check).toBeDefined();
    expect(check?.status).toBe('fail');
  });

  it('J6: DSO on trade receivables is distinguishable from DSO including unbilled revenue', () => {
    // 4,066 / 33,088.82 × 365 = 44.8 days on billed receivables alone.
    const tradeDso = (4066 / 33088.82) * 365;
    expect(tradeDso).toBeCloseTo(HAL_REFERENCE.tradeDsoFy26Days, 0);

    // The reported DSO uses the full receivables line, which is several times larger…
    const reported = result.metrics.dso?.latest?.value;
    expect(reported).not.toBeNull();
    expect(reported as number).toBeGreaterThan(tradeDso * 3);

    // …and that is flagged as an anomaly explained by unbilled revenue, not left unremarked.
    const anomaly = result.anomalies.find((a) => a.metric === 'dso' && a.period === 'FY26');
    expect(anomaly?.status).toBe('explained_benign');
    const cause = anomaly?.candidates.find((candidate) => candidate.evidence.passed);
    expect(cause?.id).toBe('unbilled_receivables');
    expect(cause?.narrative).toMatch(/not comparable/i);
  });

  it('J7: the CFO decline against an unusual FY25 does not stand as an unexplained finding', () => {
    // FY25 is flagged unusual, so E7 must pass wherever the comparison is drawn against it.
    const inventory = result.anomalies.find((a) => a.metric === 'inventoryGrowth' && a.period === 'FY26');
    expect(inventory?.status).toBe('explained_benign');
    const cause = inventory?.candidates.find((c) => c.evidence.passed);
    expect(cause?.id).toBe('prior_exceptional');
    expect(cause?.evidence.supportingFacts.join(' ')).toContain('FY25');
  });

  it('J10: no narrative renders with all-zero numeric slots', () => {
    const narratives = [
      ...result.insights.map((i) => `${i.title} ${i.narrative}`),
      ...result.redFlags.map((f) => `${f.title} ${f.detail}`),
      ...result.positiveSignals.map((f) => `${f.title} ${f.detail}`),
    ];
    for (const text of narratives) {
      expect(assessNarrative(text).vacuous, text).toBe(false);
    }
  });

  it('J11: dropping every optional v2 input still produces a valid analysis', () => {
    const v2Only = [
      'tradeReceivables', 'unbilledRevenue', 'customerAdvancesCurrent', 'customerAdvancesNonCurrent',
      'leaseLiabilitiesCurrent', 'leaseLiabilitiesNonCurrent', 'capitalWorkInProgress',
      'intangibleAssetsUnderDevelopment', 'purchaseOfIntangibles', 'purchaseOfIntangibleDevelopment',
      'incomeTaxesPaid', 'interestReceived',
    ];
    const base = halDataset();
    const stripped = {
      ...base,
      businessContext: undefined,
      periods: base.periods.map((p) => ({
        ...p,
        values: Object.fromEntries(Object.entries(p.values).filter(([k]) => !v2Only.includes(k))),
        sources: Object.fromEntries(Object.entries(p.sources).filter(([k]) => !v2Only.includes(k))),
      })),
    };
    const degraded = analyze(stripped);

    // The analysis still runs, and the metrics that do not depend on v2 inputs are unchanged.
    expect(degraded.latestPeriod).toBe('FY26');
    expect(degraded.metrics.netDebtToEbitda?.latest?.value).toBeCloseTo(HAL_REFERENCE.netDebtToEbitdaFy26, 2);

    // And what was lost is stated: without the trade-receivables split, E2 can no longer pass, so
    // the DSO anomaly goes back to unexplained and names the input that would resolve it.
    const dso = degraded.anomalies.find((a) => a.metric === 'dso' && a.period === 'FY26');
    expect(dso?.status).toBe('unexplained');
    const unbilled = dso?.candidates.find((c) => c.id === 'unbilled_receivables');
    expect(unbilled?.evidence.passed).toBe(false);
    expect(unbilled?.evidence.missingInputs).toContain('Trade receivables (billed only)');
  });
});

describe('Part F1 — anomalies reach the score only after explanation', () => {
  it('sets a check aside instead of scoring it against a band that does not apply', () => {
    const efficiency = analyze(halDataset()).health.pillars.find((p) => p.key === 'efficiency');
    expect(efficiency).toBeDefined();
    // Asset turnover of 0.27x sits below its band, but the cash-heavy balance sheet explains it.
    expect(efficiency?.explainedChecks ?? 0).toBeGreaterThan(0);
    const turnover = efficiency?.factors.find((f) => f.label === 'Asset turnover');
    expect(turnover?.anomalyStatus).toBe('explained');
    expect(turnover?.direction).toBe('neutral');
    expect(turnover?.points).toBe(0);
    expect(turnover?.explanation).toBe('Cash-heavy balance sheet');
    // The raw value is still quoted in the factor, never replaced.
    expect(turnover?.detail).toContain('0.27x');
    // Whatever the pillar now reports, it is no longer the false "Critical" the raw band produced.
    expect(efficiency?.label_).not.toBe('Critical');
  });

  it('penalises an anomaly that no explanation accounts for', () => {
    // The consumer-goods sample has no structural excuse for its receivables build.
    const sample = analyze(buildSampleDataset());
    const unexplained = sample.anomalies.filter((a) => a.status === 'unexplained');
    expect(unexplained.length).toBeGreaterThan(0);
    // An unexplained anomaly is more serious than an explained one, never less.
    for (const anomaly of unexplained) {
      expect(['high', 'critical']).toContain(anomaly.finalSeverity);
    }
  });

  it('does not fire the HAL explanations on a structurally opposite business', () => {
    const sample = analyze(buildSampleDataset());
    const halCauses = ['unbilled_receivables', 'cash_heavy_balance_sheet', 'customer_funded_capital', 'long_cycle_production'];
    const fired = sample.anomalies
      .flatMap((a) => a.candidates.filter((c) => c.evidence.passed).map((c) => c.id))
      .filter((id) => halCauses.includes(id));
    expect(fired).toEqual([]);
  });
});

describe('generic bands are the bands used for scoring', () => {
  const thresholds = resolveThresholds('general', {});

  it('reads the band from the scoring configuration rather than a parallel table', () => {
    const turnover = genericBandFor('assetTurnover', thresholds);
    expect(turnover).toEqual({ band: [0.3, 1.5], lowerIsBetter: false });
  });

  it('does not treat a higher-is-better metric above its band as an anomaly', () => {
    // ROE comfortably above the strong edge is good performance, not an unexplained anomaly.
    const strong = analyze(
      dataset([
        period('FY25', 0, { revenue: 1000, netIncome: 200, totalEquity: 800, totalAssets: 1000, cash: 50 }),
        period('FY26', 1, { revenue: 1100, netIncome: 230, totalEquity: 900, totalAssets: 1050, cash: 60 }),
      ]),
    );
    expect(strong.anomalies.filter((a) => a.metric === 'roe')).toEqual([]);
  });
});

describe('I.3 / E8 — basis-break detection', () => {
  it('flags a line that re-bases while the lines it is tied to do not', () => {
    const periods = [
      period('FY25', 0, { interestExpense: 22, longTermDebt: 500, shortTermDebt: 100 }),
      period('FY26', 1, { interestExpense: 5.79, longTermDebt: 505, shortTermDebt: 102 }),
    ];
    const breaks = detectBasisBreaks(periods);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]?.key).toBe('interestExpense');
    expect(breaks[0]?.changePct).toBeCloseTo(-73.68, 1);
    expect(breaks[0]?.referenceLabels).toContain('long-term debt');
  });

  it('stays silent when the related lines moved too', () => {
    const periods = [
      period('FY25', 0, { interestExpense: 22, longTermDebt: 500, shortTermDebt: 100 }),
      period('FY26', 1, { interestExpense: 5.79, longTermDebt: 120, shortTermDebt: 25 }),
    ];
    expect(detectBasisBreaks(periods)).toEqual([]);
  });

  it('does not fire on the healthy sample', () => {
    expect(detectBasisBreaks(buildSampleDataset().periods)).toEqual([]);
  });
});

describe('G2 / G4 — narrative discipline', () => {
  it('G4: treats an all-zero sentence as vacuous', () => {
    const verdict = assessNarrative(
      'Net debt / EBITDA stands at 0.00x against 0.00x a year earlier, a reduction of 0.00x.',
    );
    expect(verdict.vacuous).toBe(true);
    expect(verdict.reason).toMatch(/zero/);
  });

  it('G4: keeps a single-figure statement of fact', () => {
    expect(assessNarrative('Net debt is 0.00x of EBITDA.').vacuous).toBe(false);
  });

  it('G4: treats identical figures with movement language as vacuous', () => {
    expect(assessNarrative('Margin rose to 14.2% from 14.2%.').vacuous).toBe(true);
  });

  it('G2: reports opposite claims about the same measure, with both windows', () => {
    const flag = (id: string, title: string, sentiment: Flag['sentiment'], from: string, to: string): Flag => ({
      id, rule: id, title, detail: 'detail', sentiment, severity: 'medium', category: 'profitability', period: to,
      evidence: {
        lines: [
          { label: 'Operating margin', display: '9.1%', period: from },
          { label: 'Operating margin', display: '8.4%', period: to },
        ],
      },
    });
    const contradictions = findContradictions(
      withWindows([flag('a', 'Operating margins are deteriorating', 'negative', 'FY24', 'FY26')]),
      withWindows([flag('b', 'Operating margins have expanded', 'positive', 'FY22', 'FY26')]),
    );
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.measure).toBe('operating margin');
    expect(contradictions[0]?.findings.map((f) => f.window?.from)).toEqual(['FY24', 'FY22']);
  });

  it('G2: does not report two findings that merely cite the same figure', () => {
    // The healthy sample reports both concerns and positives; none of them contradict.
    expect(analyze(buildSampleDataset()).contradictions).toEqual([]);
  });
});

/**
 * Pending acceptance criteria. Each needs HAL's real FY22–FY25 statements, which the specification
 * does not reproduce. Asserting them against the fixture's placeholder columns would test invented
 * data, so they are recorded here instead of being written as passing tests.
 *
 *   J3  ROCE reported on both bases, equity-plus-debt at 31.9% ± 0.5pp — needs FY25 capital employed.
 *   J4  Operating Efficiency above 60 after explanation — needs COGS, current liabilities and CFO
 *       so that the ROCE and cash-conversion-cycle checks can be rated at all. With the figures
 *       available the pillar reports "Not rated" rather than the false "Critical" it used to.
 *   J8  ROIC suppressed for FY26 — invested capital is −5,085.34 on the supplied figures, but the
 *       fixture lacks the current liabilities the ROIC denominator needs to reach that path.
 *   J9  FCF of 8,357 with intangible capex supplied — needs FY26 CFO and PP&E capex.
 */

describe('Part C — template v2 inputs are reachable', () => {
  it('offers an Excel mapping for every canonical line item', () => {
    // A line item with no synonym can only be typed in by hand, so an imported workbook never
    // populates it — which silently disables every explanation test that depends on that input.
    const unmapped = LINE_ITEM_KEYS.filter((key) => (SYNONYMS[key] ?? []).length === 0);
    expect(unmapped).toEqual([]);
  });

  it('maps the v2 rows to their own targets rather than the generic v1 buckets', () => {
    const cases: [string, string][] = [
      ['Advances from Customers - Non Current', 'customerAdvancesNonCurrent'],
      ['Unbilled Revenue', 'unbilledRevenue'],
      ['Capital Work in Progress', 'capitalWorkInProgress'],
      ['Purchase of Intangible Assets', 'purchaseOfIntangibles'],
      ['Income Taxes Paid', 'incomeTaxesPaid'],
      ['Interest Received', 'interestReceived'],
      ['Lease Liabilities - Current', 'leaseLiabilitiesCurrent'],
    ];
    for (const [label, expected] of cases) {
      expect(suggestMappings(label)[0]?.targetKey, label).toBe(expected);
    }
  });

  it('derives the trade-receivables split from a v1-shaped import', () => {
    // A workbook that reports total receivables and unbilled revenue implies the billed figure.
    const { periods } = normalizePeriods([period('FY26', 0, { accountsReceivable: 25022, unbilledRevenue: 20956 })]);
    expect(periods[0]?.values.tradeReceivables).toBeCloseTo(4066, 2);
    expect(periods[0]?.sources.tradeReceivables).toBe('calculated');
  });
});

describe('data-quality checks are emitted once each', () => {
  it('does not repeat a check per period', () => {
    const ids = analyze(buildSampleDataset()).dataQuality.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
