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
  });
  const metricsByGroup = groupMetrics(metrics);
  const cagr = calculateCagr(periods, {
    reportingPeriod: dataset.company.reportingPeriod,
    annualizeInterimMetrics: dataset.company.annualizeInterimMetrics,
  });
  const duPont = analyzeDuPont(periods, metrics);
  const health = scoreHealth(metrics, thresholds);
  const dataQuality = assessDataQuality(periods, dataset.company, metrics, thresholds);

  const latestPeriod = periods.length ? periods[periods.length - 1]!.label : null;

  const { redFlags, positiveSignals } = latestPeriod
    ? runRules({
        company: dataset.company,
        periods,
        metrics,
        thresholds,
        latestPeriod,
        fmtCtx: { currency: dataset.company.currency, units: dataset.company.units },
      })
    : { redFlags: [], positiveSignals: [] };

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

  const insights = buildInsights(insightContext);
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
        series: m.points.map((p) => ({ period: p.period, value: p.value, status: p.status })),
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
