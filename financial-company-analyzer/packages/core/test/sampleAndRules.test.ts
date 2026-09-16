import { describe, expect, it } from 'vitest';
import {
  analyze,
  balanceSheetDifference,
  buildLlmFacts,
  buildSampleDataset,
  normalizePeriods,
} from '../src/index.js';
import { dataset, period } from './helpers.js';

const sample = analyze(buildSampleDataset());

describe('sample dataset integrity', () => {
  it('is clearly labelled as fictional', () => {
    expect(sample.company.isSample).toBe(true);
    expect(sample.company.notes).toMatch(/[Ff]ictional/);
  });

  it('balances in every period', () => {
    for (const p of sample.statements) {
      const diff = balanceSheetDifference(p)!;
      const assets = p.values['totalAssets'] as number;
      expect(Math.abs(diff)).toBeLessThanOrEqual(Math.abs(assets) * 0.005);
    }
    expect(sample.dataQuality.checks.filter((c) => c.id.startsWith('balance.') && c.status === 'fail')).toHaveLength(0);
  });

  it('reconciles the cash flow statement against balance sheet cash', () => {
    const unreconciled = sample.dataQuality.checks.filter(
      (c) => c.id.startsWith('cashflow.') && c.status === 'warn',
    );
    expect(unreconciled).toHaveLength(0);
  });

  it('produces a full set of headline metrics', () => {
    for (const key of ['revenueGrowth', 'ebitdaMargin', 'netMargin', 'roe', 'roic', 'currentRatio', 'netDebtToEbitda', 'fcf', 'cashConversionCycle']) {
      expect(sample.metrics[key]!.latest, `${key} should be calculable`).not.toBeNull();
    }
  });

  it('rates overall financial health', () => {
    expect(sample.health.overall).not.toBeNull();
    expect(sample.health.label).not.toBe('Not rated');
    for (const pillar of sample.health.pillars) {
      // Every pillar must be explainable: a score without named factors is not acceptable.
      if (pillar.score !== null) expect(pillar.factors.length).toBeGreaterThan(0);
    }
  });
});

describe('rule engine on the sample data', () => {
  it('detects the FY26 receivables stretch', () => {
    const flagged = sample.redFlags.find((f) => f.id === 'receivables_vs_revenue');
    expect(flagged, 'the receivables-vs-revenue rule should fire on the sample data').toBeDefined();
    expect(flagged!.evidence.lines.length).toBeGreaterThan(3);
    expect(flagged!.thresholdUsed).toHaveProperty('receivablesVsRevenueGapPp');
  });

  it('recognises the genuine positives in the data', () => {
    const ids = sample.positiveSignals.map((s) => s.id);
    expect(ids).toContain('margin_expansion');
    expect(ids).toContain('coverage_improving');
    expect(ids).toContain('debt_reduction');
  });

  it('does not claim deleveraging in a period where leverage rose', () => {
    // Net debt / EBITDA falls steadily FY21-FY25 but ticks up in FY26 as receivables absorb
    // cash. The rule compares the latest period with its predecessor, so it must stay silent.
    const nde = sample.metrics['netDebtToEbitda']!;
    expect(nde.latest!.value as number).toBeGreaterThan(nde.previous!.value as number);
    expect(sample.positiveSignals.map((s) => s.id)).not.toContain('deleveraging');
  });

  it('detects the divergence between earnings growth and cash generation in FY26', () => {
    const divergence = sample.redFlags.find((f) => f.id === 'earnings_vs_cash_flow');
    expect(divergence).toBeDefined();
    expect(divergence!.sentiment).toBe('investigate');
  });

  it('attaches traceable evidence to every flag and signal', () => {
    for (const item of [...sample.redFlags, ...sample.positiveSignals]) {
      expect(item.evidence.lines.length, `${item.id} must carry evidence`).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(40);
    }
  });

  it('never asserts causality it cannot establish', () => {
    const investigative = sample.redFlags.filter((f) => f.sentiment === 'investigate');
    for (const item of investigative) {
      expect(item.detail).toMatch(/may |could |warrants|should be/i);
    }
  });
});

describe('insights and executive summary', () => {
  it('generates specific narratives rather than restating a single number', () => {
    const growth = sample.insights.find((i) => i.id === 'growth.cagr')!;
    expect(growth.narrative).toMatch(/compounded at/);
    expect(growth.narrative.length).toBeGreaterThan(120);
    expect(growth.evidence.lines.length).toBeGreaterThan(0);
  });

  it('builds an executive summary with strengths, concerns and takeaways', () => {
    const summary = sample.executiveSummary;
    expect(summary.headline).toContain('Apex Consumer Products');
    expect(summary.strengths.length).toBeGreaterThan(0);
    expect(summary.takeaways.length).toBeGreaterThan(2);
    expect(summary.sections.map((s) => s.key)).toContain('cashFlow');
  });
});

describe('LLM fact package', () => {
  it('exposes calculated facts only, with an instruction not to compute', () => {
    const facts = buildLlmFacts(sample);
    expect(facts.instructions).toMatch(/deterministic/i);
    expect(facts.metrics.every((m) => typeof m.formula === 'string')).toBe(true);
    // Raw line items must not be handed to the language layer.
    expect(JSON.stringify(facts)).not.toContain('retainedEarnings');
  });
});

describe('data quality surfaces problems rather than hiding them', () => {
  it('reports an unbalanced balance sheet with the exact difference', () => {
    const result = analyze(dataset([period('FY24', 0, {
      totalAssets: 1000, totalLiabilities: 500, totalEquity: 450, revenue: 800,
    })]));
    const check = result.dataQuality.checks.find((c) => c.id === 'balance.FY24')!;
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/Balance sheet difference/i);
    expect(check.evidence!.lines.some((l) => l.label === 'Difference' && l.value === 50)).toBe(true);
  });

  it('tolerates rounding within the configured allowance', () => {
    const result = analyze(dataset([period('FY24', 0, {
      totalAssets: 1000, totalLiabilities: 500, totalEquity: 499.9, revenue: 800,
    })]));
    expect(result.dataQuality.checks.find((c) => c.id === 'balance.FY24')!.status).toBe('pass');
  });

  it('skips the check when the data cannot support it', () => {
    const result = analyze(dataset([period('FY24', 0, { revenue: 800 })]));
    expect(result.dataQuality.checks.find((c) => c.id === 'balance.FY24')!.status).toBe('skipped');
  });

  it('warns when a reported total disagrees with its components', () => {
    const result = analyze(dataset([period('FY24', 0, {
      cash: 100, shortTermInvestments: 20, accountsReceivable: 150, inventory: 120, otherCurrentAssets: 30,
      totalCurrentAssets: 500, revenue: 1000,
    })]));
    expect(result.dataQuality.checks.some((c) => c.id.startsWith('total.totalCurrentAssets'))).toBe(true);
  });
});

describe('cross-period carry forward', () => {
  it('carries closing cash into the next period as opening cash', () => {
    const { periods } = normalizePeriods([
      period('FY23', 0, { cash: 120 }),
      period('FY24', 1, { cash: 150, cfo: 100, cfi: -60, cff: -10 }),
    ]);
    expect(periods[1]!.values['openingCash']).toBe(120);
    expect(periods[1]!.sources['openingCash']).toBe('calculated');
  });
});
