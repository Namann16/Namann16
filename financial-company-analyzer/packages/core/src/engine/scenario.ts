import type { AnalysisResult, CompanyDataset, ScenarioDiff, ScenarioModification } from '../types.js';
import { analyze } from './analyze.js';
import { isLineItemKey } from './lineItems.js';

export function applyScenario(dataset: CompanyDataset, modifications: ScenarioModification[]): CompanyDataset {
  const byPeriod = new Map<string, ScenarioModification['values']>();
  for (const modification of modifications) {
    const periodKey = modification.period.trim().toLowerCase();
    if (byPeriod.has(periodKey)) {
      throw new Error(`Scenario period "${modification.period}" appears more than once.`);
    }
    byPeriod.set(periodKey, modification.values);
  }
  const periods = dataset.periods.map((period) => {
    const changes = byPeriod.get(period.label.trim().toLowerCase());
    if (!changes) return { ...period, values: { ...period.values }, sources: { ...period.sources } };
    for (const key of Object.keys(changes)) {
      if (!isLineItemKey(key)) throw new Error(`Scenario field "${key}" is not a recognised line item.`);
    }
    return {
      ...period,
      values: { ...period.values, ...changes },
      sources: { ...period.sources, ...Object.fromEntries(Object.keys(changes).map((key) => [key, 'entered' as const])) },
    };
  });
  for (const label of byPeriod.keys()) {
    if (!dataset.periods.some((period) => period.label.trim().toLowerCase() === label)) throw new Error(`Scenario period "${label}" does not exist.`);
  }
  return { ...dataset, periods };
}

export function diffAnalysisResults(base: AnalysisResult, scenario: AnalysisResult): ScenarioDiff {
  const metricChanges: ScenarioDiff['metricChanges'] = [];
  for (const [key, series] of Object.entries(scenario.metrics)) {
    const before = base.metrics[key];
    for (const point of series.points) {
      const prior = before?.points.find((candidate) => candidate.period === point.period);
      if (prior && prior.value !== point.value) {
        metricChanges.push({
          key,
          label: series.label,
          period: point.period,
          base: prior.value,
          scenario: point.value,
          delta: prior.value !== null && point.value !== null ? point.value - prior.value : null,
          unit: series.unit,
        });
      }
    }
  }
  const baseFlags = new Set(base.redFlags.map((flag) => flag.id));
  const scenarioFlags = new Set(scenario.redFlags.map((flag) => flag.id));
  return {
    base,
    scenario,
    metricChanges,
    healthDelta: base.health.overall !== null && scenario.health.overall !== null ? scenario.health.overall - base.health.overall : null,
    addedRedFlags: scenario.redFlags.filter((flag) => !baseFlags.has(flag.id)).map((flag) => flag.title),
    removedRedFlags: base.redFlags.filter((flag) => !scenarioFlags.has(flag.id)).map((flag) => flag.title),
  };
}

export function analyzeScenario(dataset: CompanyDataset, modifications: ScenarioModification[]): ScenarioDiff {
  return diffAnalysisResults(analyze(dataset), analyze(applyScenario(dataset, modifications)));
}
