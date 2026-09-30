import type { AnalysisResult, CompanyDataset, MetricGroup } from '../types.js';
import { normalizePeriods } from './normalize.js';
import { calculateCagr, calculateMetrics, groupMetrics } from './calculate.js';
import { analyzeDuPont } from './dupont.js';
import { scoreHealth } from './health.js';
import { runRules } from './rules.js';
import { buildExecutiveSummary, buildInsights } from './insights.js';
import { assessDataQuality } from './dataQuality.js';
import { comparePeers } from './peers.js';
import { resolveThresholds } from './thresholds.js';
import { detectAnomalies } from './anomalies.js';
import { findContradictions, suppressEmptyFlags, suppressEmptyInsights, withWindows } from './narrative.js';

export const ENGINE_VERSION = '1.0.0';

/**
 * Run the complete deterministic analysis pipeline.
 *
 *   raw data -> normalization -> metrics -> rules -> insights -> summary
 *
 * Everything downstream of `calculateMetrics` consumes calculated facts only. No formula is
 * evaluated outside the engine, and no narrative is produced without the evidence behind it.
 */
export function analyze(dataset: CompanyDataset): AnalysisResult {
  const thresholds = resolveThresholds(dataset.company.industry, dataset.thresholds);
  const { periods } = normalizePeriods(dataset.periods ?? []);

  const metrics = calculateMetrics(periods, dataset.company.industry, {
    reportingPeriod: dataset.company.reportingPeriod,
    annualizeInterimMetrics: dataset.company.annualizeInterimMetrics,
    metricConfig: dataset.company.metricConfig,
  });
  const metricsByGroup = groupMetrics(metrics);
  const cagr = calculateCagr(periods, {
    reportingPeriod: dataset.company.reportingPeriod,
    annualizeInterimMetrics: dataset.company.annualizeInterimMetrics,
  });
  const duPont = analyzeDuPont(periods, metrics);
  const dataQuality = assessDataQuality(periods, dataset.company, metrics, thresholds);
  const anomalies = detectAnomalies({ ...dataset, periods }, metrics, thresholds);
  const health = scoreHealth(metrics, thresholds, anomalies);

  const latestPeriod = periods.length ? periods[periods.length - 1]!.label : null;

  const ruleOutput = latestPeriod
    ? runRules({
        company: dataset.company,
        periods,
        metrics,
        thresholds,
        latestPeriod,
        fmtCtx: { currency: dataset.company.currency, units: dataset.company.units },
      })
    : { redFlags: [], positiveSignals: [] };

  // Specification G4. A finding whose numeric slots are all zero or all identical is removed
  // before anything downstream reads it, so the summary, the export and the LLM fact sheet all
  // see the same set of findings a reader sees.
  const redFlags = withWindows(suppressEmptyFlags(ruleOutput.redFlags));
  const positiveSignals = withWindows(suppressEmptyFlags(ruleOutput.positiveSignals));
  // Specification G2: the contradiction check runs over the finished finding set, before export.
  const contradictions = findContradictions(redFlags, positiveSignals);

  const insightContext = {
    company: dataset.company,
    periods,
    metrics,
    cagr,
    duPont,
    health,
    redFlags,
    positiveSignals,
    thresholds,
  };

  const insights = suppressEmptyInsights(buildInsights(insightContext));
  const executiveSummary = buildExecutiveSummary(insightContext, insights);
  const peerComparison = comparePeers(metrics, dataset.peers ?? []);

  return {
    company: dataset.company,
    periods: periods.map((p) => ({ label: p.label, order: p.order, ...(p.isPartial ? { isPartial: true } : {}) })),
    latestPeriod,
    statements: periods,
    metrics,
    metricsByGroup: metricsByGroup as Record<MetricGroup, AnalysisResult['metricsByGroup'][MetricGroup]>,
    cagr,
    duPont,
    health,
    redFlags,
    positiveSignals,
    insights,
    executiveSummary,
    dataQuality,
    anomalies,
    contradictions,
    peerComparison,
    thresholds,
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * Structured facts handed to an optional LLM layer.
 *
 * The LLM never sees raw unvalidated input and is never asked to compute anything: it receives
 * only calculated metrics, rule outcomes and evidence, so it cannot hallucinate a number.
 *
 * This is also what `GET /:id/facts` returns, so the two must not drift: that endpoint exists to
 * show exactly what a model would be given, and it would be worthless if it showed something else.
 *
 * Deliberately excluded: the per-metric `points` series. It was 80% of the payload — six points
 * across seventy metrics — and an executive summary does not narrate a series. Trajectory is
 * already carried by `change`, `trend` and `cagr`, and the findings state multi-period patterns in
 * words. Sending a bare array of values to save space was rejected: `points` is not guaranteed to
 * hold one entry per period, so positional alignment against `periods` could attribute a figure to
 * the wrong year, which is a worse failure than a vaguer summary.
 *
 * The exclusion also tightens the numeric fidelity check, which draws its set of permitted figures
 * from this object: fewer values means fewer coincidental matches, and the model cannot cite a
 * historical point it was never shown.
 */
export function buildLlmFacts(result: AnalysisResult) {
  return {
    company: {
      name: result.company.name,
      industry: result.company.industry,
      currency: result.company.currency,
      units: result.company.units,
      isSample: result.company.isSample ?? false,
    },
    periods: result.periods.map((p) => p.label),
    latestPeriod: result.latestPeriod,
    metrics: Object.values(result.metrics)
      .filter((m) => m.latest)
      .map((m) => ({
        key: m.key,
        label: m.label,
        unit: m.unit,
        formula: m.formula,
        latest: m.latest?.value ?? null,
        latestPeriod: m.latest?.period ?? null,
        previous: m.previous?.value ?? null,
        change: m.change,
        trend: m.trend,
      })),
    cagr: result.cagr.map((c) => ({ key: c.key, label: c.label, value: c.value, status: c.status, note: c.note ?? null })),
    duPont: result.duPont.attribution,
    health: {
      overall: result.health.overall,
      label: result.health.label,
      pillars: result.health.pillars.map((p) => ({ key: p.key, score: p.score, label: p.label_, coverage: p.coverage })),
    },
    redFlags: result.redFlags.map((f) => ({ id: f.id, title: f.title, severity: f.severity, detail: f.detail })),
    positiveSignals: result.positiveSignals.map((f) => ({ id: f.id, title: f.title, detail: f.detail })),
    dataQuality: {
      completeness: result.dataQuality.completeness,
      failures: result.dataQuality.checks.filter((c) => c.status === 'fail').map((c) => c.detail),
      warnings: result.dataQuality.checks.filter((c) => c.status === 'warn').map((c) => c.detail),
    },
    instructions:
      'These are calculated facts produced by a deterministic financial engine. Do not compute new figures, do not restate a number that is not present here, and do not assert causality that the evidence does not establish.',
  };
}
