import { useState } from 'react';
import type { AnalysisResult, Anomaly, ExplanationResult, Severity } from '@fca/core';
import { Badge, Card } from '../ui/primitives';
import { formatMetric, fmtCtx } from '../../lib/display';

/**
 * The explanation trail (specification Part H).
 *
 * The point of showing this at all is that the user must be able to reject the engine's reasoning.
 * So the failed candidates are shown alongside the passing one: a reader who can see that four
 * explanations were tested and none held has learned something the verdict alone cannot tell them,
 * and a reader who disagrees with the one that passed can see exactly what evidence carried it.
 *
 * Nothing here recomputes or reinterprets anything — every figure shown is read off the anomaly.
 */

const STATUS_LABEL: Record<Anomaly['status'], string> = {
  explained_benign: 'Explained — structural',
  explained_concerning: 'Explained — still a concern',
  unexplained: 'Unexplained',
};

const STATUS_TONE: Record<Anomaly['status'], 'positive' | 'caution' | 'negative'> = {
  explained_benign: 'positive',
  explained_concerning: 'caution',
  unexplained: 'negative',
};

const SEVERITY_TONE: Record<Severity, 'neutral' | 'caution' | 'negative'> = {
  info: 'neutral',
  low: 'neutral',
  medium: 'caution',
  high: 'negative',
  critical: 'negative',
};

const CONFIDENCE_LABEL: Record<ExplanationResult['evidence']['confidence'], string> = {
  strong: 'strong evidence',
  moderate: 'moderate evidence',
  weak: 'no supporting evidence',
};

function Candidate({ candidate }: { candidate: ExplanationResult }) {
  const { passed, confidence, supportingFacts, missingInputs } = candidate.evidence;
  return (
    <li className="border-t border-ink-200 py-2 first:border-t-0 dark:border-ink-800">
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-[12px] ${passed ? 'font-semibold text-ink-900 dark:text-ink-100' : 'text-ink-500 dark:text-ink-400'}`}>
          {candidate.label}
        </p>
        <span className={`shrink-0 text-2xs ${passed ? 'text-positive-700 dark:text-positive-400' : 'text-ink-400 dark:text-ink-500'}`}>
          {passed ? `passed · ${CONFIDENCE_LABEL[confidence]}` : 'did not pass'}
        </span>
      </div>
      {passed && supportingFacts.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {supportingFacts.map((fact) => (
            <li key={fact} className="text-2xs text-ink-600 dark:text-ink-400">{fact}</li>
          ))}
        </ul>
      )}
      {!passed && missingInputs.length > 0 && (
        // Specification Part H: naming the field that would let the test run drives template
        // adoption better than documentation does.
        <p className="mt-1 text-2xs text-caution-700 dark:text-caution-400">
          Would need: {missingInputs.join(', ')}
        </p>
      )}
    </li>
  );
}

function AnomalyRow({ anomaly, label, unit, ctx }: {
  anomaly: Anomaly;
  label: string;
  unit: Parameters<typeof formatMetric>[1];
  ctx: Parameters<typeof formatMetric>[2];
}) {
  const [open, setOpen] = useState(false);
  const passing = anomaly.candidates.filter((c) => c.evidence.passed);
  const [low, high] = anomaly.genericBand;
  const missing = [...new Set(anomaly.candidates.filter((c) => !c.evidence.passed).flatMap((c) => c.evidence.missingInputs))];

  return (
    <div className="rounded-xl bg-ink-500/[0.06] px-3 py-2.5 dark:bg-ink-400/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">{label}</p>
          <p className="text-2xs text-ink-500 dark:text-ink-400">{anomaly.period}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={SEVERITY_TONE[anomaly.finalSeverity]}>{anomaly.finalSeverity}</Badge>
          <Badge tone={STATUS_TONE[anomaly.status]}>{STATUS_LABEL[anomaly.status]}</Badge>
        </div>
      </div>

      <p className="mt-1.5 text-[13px] font-semibold tnum text-ink-900 dark:text-ink-100">
        {formatMetric(anomaly.value, unit, ctx)}
        <span className="ml-2 text-2xs font-normal text-ink-500 dark:text-ink-400">
          assessed against {formatMetric(low, unit, ctx)}–{formatMetric(high, unit, ctx)}
          {anomaly.deviation >= 0.1 ? ` · ${anomaly.deviation.toFixed(1)} band-widths outside` : ''}
        </span>
      </p>

      <p className="mt-1 text-[12px] text-ink-600 dark:text-ink-400">
        {passing[0]?.narrative
          ?? 'No candidate explanation passed its evidence test. An anomaly nobody can account for is treated as more serious, not less.'}
      </p>

      {anomaly.status === 'unexplained' && missing.length > 0 && (
        <p className="mt-1.5 text-2xs text-caution-700 dark:text-caution-400">
          Supplying {missing.slice(0, 4).join(', ')} would let the remaining tests run.
        </p>
      )}

      <button
        type="button"
        className="btn-ghost mt-1.5 text-2xs"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide' : `Show all ${anomaly.candidates.length} test${anomaly.candidates.length === 1 ? '' : 's'}`}
      </button>

      {open && (
        <ul className="mt-1 border-t border-ink-200 pt-1 dark:border-ink-800">
          {anomaly.candidates.map((candidate) => <Candidate key={candidate.id} candidate={candidate} />)}
        </ul>
      )}
    </div>
  );
}

export function AnomalyTrail({ analysis }: { analysis: AnalysisResult }) {
  if (analysis.anomalies.length === 0) return null;
  const ctx = fmtCtx(analysis.company);
  const unexplained = analysis.anomalies.filter((a) => a.status === 'unexplained').length;

  return (
    <Card
      title="Anomaly explanation trail"
      description={
        'Values outside their generic band, and every explanation tested against them. Raw values are never adjusted — '
        + 'an explanation changes how a value is scored and described, not what it is.'
      }
      actions={
        unexplained > 0
          ? <Badge tone="negative">{unexplained} unexplained</Badge>
          : <Badge tone="positive">All accounted for</Badge>
      }
    >
      <div className="grid gap-2 lg:grid-cols-2">
        {analysis.anomalies.map((anomaly) => (
          <AnomalyRow
            key={`${anomaly.metric}-${anomaly.period}`}
            anomaly={anomaly}
            label={analysis.metrics[anomaly.metric]?.label ?? anomaly.metric}
            unit={analysis.metrics[anomaly.metric]?.unit ?? 'number'}
            ctx={ctx}
          />
        ))}
      </div>
      <p className="mt-3 text-2xs text-ink-500 dark:text-ink-400">
        A high share of unexplained anomalies is a finding about the data, not a defect in the explanation library.
      </p>
    </Card>
  );
}

/**
 * Specification G2. Two findings of opposite sentiment about the same measure are both shown with
 * the window each was drawn from, because both are usually true over their own window. The engine
 * does not pick one — that choice belongs to the reader, who needs to see the windows to make it.
 */
export function ContradictionPanel({ analysis }: { analysis: AnalysisResult }) {
  if (analysis.contradictions.length === 0) return null;
  return (
    <Card
      title="Claims measured over different windows"
      description="Findings that point in opposite directions on the same measure. Neither is suppressed; quote the window with the claim."
    >
      <div className="space-y-2">
        {analysis.contradictions.map((contradiction) => (
          <div key={contradiction.measure + contradiction.findings.map((f) => f.id).join('|')} className="rounded-xl bg-caution-500/[0.12] px-3 py-2 dark:bg-caution-400/[0.14]">
            <p className="label-caps">{contradiction.measure}</p>
            <p className="mt-0.5 text-[12px] text-ink-700 dark:text-ink-300">{contradiction.detail}</p>
            <ul className="mt-1.5 space-y-1">
              {contradiction.findings.map((finding) => (
                <li key={finding.id} className="text-[12px] text-ink-600 dark:text-ink-400">
                  <span className="font-semibold">{finding.title}</span>
                  {finding.window ? ` — ${finding.window.from}–${finding.window.to}` : ' — window not stated'}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
