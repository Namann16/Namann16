# Extending the analyzer

Everything the application knows about financial data lives in a small number of registries in
`packages/core`. Adding to one of them propagates automatically: the input grid, statement views,
Excel template, import mapper, exports and the ratio glossary are all generated from them.

---

## Add a ratio

**One file: `packages/core/src/engine/metricDefs.ts`.**

Append a `MetricDefinition` to `METRIC_DEFINITIONS`:

```ts
{
  key: 'cashReturnOnAssets',
  label: 'Cash Return on Assets',
  group: 'returns',              // determines which screen and table it appears on
  unit: 'percent',               // currency | percent | times | days | number | per_share
  formula: 'CFO / Average Total Assets',
  meaning: 'Cash generated per unit of assets, before the accounting choices that shape profit.',
  higherIsBetter: true,
  absoluteChangeOnly: true,      // percent/days/times move in absolute terms, not % of a %
  compute: (ctx) => {
    const cfo = val(ctx.current, 'cfo');
    const assets = val(ctx.current, 'totalAssets');
    const prior = val(ctx.prior, 'totalAssets');
    const average = isNum(assets) && isNum(prior) ? (assets + prior) / 2 : assets;
    return {
      value: toPercent(safeDivPositiveDenominator(cfo, average)),
      // Every raw input must be listed: this is what the "view calculation" drawer shows.
      inputs: { cfo, 'totalAssets (opening)': prior, 'totalAssets (closing)': assets },
      ...(isNum(prior) ? {} : { note: 'Closing balance used — no prior-period balance available.' }),
    };
  },
}
```

That is the whole change. The metric now appears in the ratio table for its group, in the Excel
and CSV exports, in the PDF report, in the metadata the client reads, and in the `/facts` payload
handed to an optional LLM.

**Rules to follow:**

- Use `safeDiv` / `safeDivPositiveDenominator`. Never write `a / b`.
- List **every** input in `inputs`, including the ones that were missing. The drawer and the
  report read from it, and a metric whose inputs are incomplete is not traceable.
- Return `value: null` when the data is insufficient. `makeMetric` then infers the right status
  and writes a note naming what was required.
- Add a `note` for any methodology caveat — a fallback basis, an assumption, a suppression.
- Mark `absoluteChangeOnly: true` for percent, days and times units: a percentage change in a
  percentage is not a useful number.

To surface it in the health score, add a check to the relevant pillar in
`packages/core/src/engine/health.ts`. To add it to peer benchmarking, append its key to
`PEER_METRIC_KEYS` in `packages/core/src/engine/peers.ts`.

**Add a test.** `packages/core/test/calculations.test.ts` — with a hand-calculated expectation,
not a snapshot of what the engine currently returns.

---

## Add a line item

**`packages/core/src/engine/lineItems.ts`:**

```ts
{
  key: 'leaseLiabilities',
  label: 'Lease Liabilities',
  statement: 'balance',             // income | balance | cashFlow | share
  section: 'Non-current liabilities',
  sign: 'positive',                 // positive | negative | any
  description: 'Capitalised lease obligations under IFRS 16 / Ind AS 116.',
}
```

It immediately appears in the input grid, the statement views, the Excel template and the export.

Then:

1. **Synonyms** — `packages/core/src/excel/mapping.ts`, so the importer recognises it:
   ```ts
   leaseLiabilities: ['lease liabilities', 'lease obligations', 'finance lease liabilities'],
   ```
2. **Derivation** — if it feeds a total, update the relevant rule in
   `packages/core/src/engine/normalize.ts`.
3. **Core item** — if a meaningful analysis depends on it, add the key to `CORE_LINE_ITEMS`
   so the data-quality completeness score counts it.

No database migration is needed: values are stored as an open map keyed by line-item key.

---

## Add a red-flag or positive-signal rule

**`packages/core/src/engine/rules.ts`.** Append to `RED_FLAG_RULES` or `POSITIVE_SIGNAL_RULES`:

```ts
{
  id: 'goodwill_concentration',
  kind: 'red_flag',
  description: 'Goodwill exceeds the configured share of total assets.',   // shown in Settings
  evaluate: (ctx) => {
    const period = ctx.periods[ctx.periods.length - 1]!;
    const goodwill = val(period, 'goodwill');
    const assets = val(period, 'totalAssets');
    if (!isNum(goodwill) || !isNum(assets) || assets <= 0) return null;    // no data → no claim

    const share = (goodwill / assets) * 100;
    if (share < ctx.thresholds.goodwillShareHigh) return null;             // below threshold → silent

    return flag(ctx, {
      id: 'goodwill_concentration',
      rule: 'Goodwill share of total assets',
      title: 'A large share of the asset base is goodwill',
      detail:
        `Goodwill of ${formatCurrency(goodwill, ctx.fmtCtx)} represents ${share.toFixed(0)}% of total assets. ` +
        `This may indicate that past acquisitions carry impairment risk if the acquired businesses underperform.`,
      sentiment: 'investigate',          // positive | negative | neutral | investigate
      severity: 'medium',                // critical | high | medium | low | info
      category: 'solvency',
      thresholdUsed: { goodwillShareHigh: ctx.thresholds.goodwillShareHigh },
      evidence: {
        formula: 'Goodwill / Total Assets',
        lines: [
          line('Goodwill', goodwill, 'currency', ctx, period.label),
          line('Total assets', assets, 'currency', ctx, period.label),
          line('Goodwill share', share, 'percent', ctx, period.label),
        ],
        conclusion: `Goodwill is ${share.toFixed(0)}% of assets, above the ${ctx.thresholds.goodwillShareHigh}% threshold in force.`,
      },
    });
  },
}
```

**The rules that make a rule acceptable:**

- **Return `null` when the data is absent.** A rule must never fire on assumed numbers. A rule
  that cannot evaluate simply does not fire; `runRules` also catches a throwing rule so one bad
  rule can never take down the analysis.
- **Every threshold goes in `ThresholdConfig`** with an entry in `THRESHOLD_DESCRIPTIONS`, and is
  echoed in `thresholdUsed`. No magic numbers in a rule body.
- **Evidence is mandatory.** The `detail` text must be supported by the `evidence.lines` beside
  it. The tests assert that every flag carries evidence.
- **Hedge what the data does not prove.** Use *may indicate*, *could suggest*,
  *warrants investigation* for a correlation. Assert only what the arithmetic establishes. The
  test `never asserts causality it cannot establish` enforces this for `investigate` findings.

The rule appears in Settings automatically, with its `description`, so users can see what fires.

---

## Add an industry profile

**`packages/core/src/engine/thresholds.ts`:**

```ts
shipping: {
  key: 'shipping',
  label: 'Shipping',
  overrides: {
    netDebtToEbitdaHigh: 4.5,       // vessels are debt-financed by design
    interestCoverageLow: 2,
    assetsVsRevenueGapPp: 35,       // fleet additions lead revenue
    roicStrong: 9,
  },
  suppressedMetrics: ['inventoryTurnover', 'dio'],
  note: 'Highly cyclical and capital intensive. Vessel finance drives structurally high leverage, and there is no inventory cycle.',
},
```

Add the key to the `IndustryKey` union in `packages/core/src/types.ts`. The industry then appears
in company setup and Settings, with its overrides and suppressions listed for the user.

A suppressed metric is reported as `not_applicable` with the industry named, rather than being
hidden — the user can see it was deliberately excluded, not that it failed to calculate.

**Adding a threshold** means three places: the field in `ThresholdConfig` (`types.ts`), the
default in `DEFAULT_THRESHOLDS`, and the explanation in `THRESHOLD_DESCRIPTIONS`. The Settings
screen picks it up from there; add its key to a group in `client/src/pages/Settings.tsx` to place
it in the right section.

---

## Add an insight

**`packages/core/src/engine/insights.ts`**, in `buildInsights`. An insight is a longer-form
narrative than a flag; it should answer four questions:

1. What happened?
2. How significant was it?
3. What is the likely financial implication?
4. Is it positive, negative, or something to investigate?

```ts
insights.push({
  id: 'profitability.taxRate',
  title: 'Effective tax rate',
  narrative: `...`,          // specific, with the numbers in it
  sentiment: 'neutral',
  importance: 60,            // 0-100; orders the executive summary
  category: 'profitability',
  evidence: { formula: '...', lines: [...], conclusion: '...' },
});
```

Write the narrative the way an analyst would. Not *"ROE is 18%"* but *"ROE increased from 14% to
18% over three years, and the DuPont decomposition attributes the improvement primarily to
stronger net margins rather than increased leverage."*

If the data is insufficient, say so explicitly — `Insufficient data to perform this analysis.` —
rather than omitting the insight, so the user knows the analysis was attempted.

To place it in the executive summary, add its id to `SECTION_ORDER`.

---

## Where things are

| Change | File |
|---|---|
| Ratio or metric | `packages/core/src/engine/metricDefs.ts` |
| Statement line item | `packages/core/src/engine/lineItems.ts` |
| Statement derivation | `packages/core/src/engine/normalize.ts` |
| Risk / positive rule | `packages/core/src/engine/rules.ts` |
| Threshold | `packages/core/src/types.ts` + `engine/thresholds.ts` |
| Industry profile | `packages/core/src/engine/thresholds.ts` |
| Health check | `packages/core/src/engine/health.ts` |
| Written insight | `packages/core/src/engine/insights.ts` |
| Data-quality check | `packages/core/src/engine/dataQuality.ts` |
| Excel synonym | `packages/core/src/excel/mapping.ts` |
| Number/date parsing | `packages/core/src/excel/parseValue.ts` |
| Peer benchmark metric | `packages/core/src/engine/peers.ts` |
| Excel template sheet | `server/src/services/excelTemplate.ts` |
| Export contents | `server/src/services/exportData.ts` |
| PDF report section | `server/src/services/report.ts` |
| API endpoint | `server/src/routes/` |
| Request validation | `server/src/validation/schemas.ts` |
| Screen | `client/src/pages/` |
| Chart | `client/src/components/charts/Charts.tsx` |

---

## Before you commit

```bash
npm run typecheck
npm test
npm run build
```

Add a test for any new formula, with a **hand-calculated** expectation. A snapshot of the engine's
current output tests nothing: it will happily record a regression as the new correct answer.
