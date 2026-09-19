import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/primitives';
import type { HealthLabel } from '@fca/core';

const TONE: Record<HealthLabel, 'positive' | 'negative' | 'neutral' | 'caution'> = {
  Excellent: 'positive', Strong: 'positive', Healthy: 'positive',
  Watch: 'caution', Concern: 'negative', Critical: 'negative', 'Not rated': 'neutral',
};

/** A bar rather than a gauge: easier to compare across pillars at a glance. */
function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return <div className="h-1.5 w-full rounded-full bg-ink-200 dark:bg-ink-800" aria-hidden="true" />;
  }
  const colour = score >= 72 ? 'bg-positive-500' : score >= 58 ? 'bg-accent-600/[0.08]0' : score >= 44 ? 'bg-caution-500' : 'bg-negative-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${score}%` }} />
    </div>
  );
}

export default function FinancialHealth() {
  const { analysis } = useWorkspace();
  if (!analysis) return null;

  const { health } = analysis;

  if (health.overall === null) {
    return (
      <>
        <PageHeader title="Financial Health" />
        <EmptyState
          title="Not enough data to rate financial health"
          message="Every scoring check needs the metric it measures. None could be evaluated from the data supplied, so no score is shown rather than one built on assumptions. The Data Quality panel lists the line items that are missing."
          action={<a className="btn-primary" href="/data">Go to Data Input</a>}
        />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Health"
        description="Each pillar is scored from named checks that map a metric onto a configurable band. Every contributing factor is shown, so no score is a black box, and every threshold can be changed in Settings."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="label-caps">Overall assessment</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="tnum text-4xl font-semibold text-ink-900 dark:text-ink-50">{health.overall}</span>
              <span className="text-lg text-ink-400">/ 100</span>
              <Badge tone={TONE[health.label]}>{health.label}</Badge>
            </div>
          </div>
          <div className="min-w-[14rem] flex-1">
            <ScoreBar score={health.overall} />
            <p className="mt-2 text-2xs text-ink-500 dark:text-ink-400">
              Coverage-weighted average of the pillar scores below.
              {health.unratedChecks > 0 && ` ${health.unratedChecks} checks could not be evaluated and were excluded rather than scored as zero.`}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {health.pillars.map((pillar) => {
          const supports = pillar.factors.filter((f) => f.direction === 'supports');
          const offsets = pillar.factors.filter((f) => f.direction === 'offsets');
          const neutral = pillar.factors.filter((f) => f.direction === 'neutral');

          return (
            <Card
              key={pillar.key}
              title={pillar.label}
              description={`Weight ${pillar.weight.toFixed(2)} · ${Math.round(pillar.coverage * 100)}% of checks had data`}
              actions={
                <div className="flex items-center gap-2">
                  <span className="tnum text-lg font-semibold">{pillar.score ?? '—'}</span>
                  <Badge tone={TONE[pillar.label_]}>{pillar.label_}</Badge>
                </div>
              }
            >
              <ScoreBar score={pillar.score} />

              {supports.length > 0 && (
                <div className="mt-3">
                  <p className="label-caps text-positive-700 dark:text-positive-500">Driven by</p>
                  <ul className="mt-1 space-y-1">
                    {supports.map((factor) => (
                      <li key={factor.label} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
                        <span className="text-positive-600" aria-hidden="true">✓</span>
                        <span><strong className="font-medium">{factor.label}</strong> — {factor.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {offsets.length > 0 && (
                <div className="mt-3">
                  <p className="label-caps text-caution-700 dark:text-caution-500">Offset by</p>
                  <ul className="mt-1 space-y-1">
                    {offsets.map((factor) => (
                      <li key={factor.label} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
                        <span className="text-caution-600" aria-hidden="true">⚠</span>
                        <span><strong className="font-medium">{factor.label}</strong> — {factor.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {neutral.length > 0 && (
                <div className="mt-3">
                  <p className="label-caps">Neutral or not rated</p>
                  <ul className="mt-1 space-y-1">
                    {neutral.map((factor) => (
                      <li key={factor.label} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
                        <span className="text-ink-400" aria-hidden="true">·</span>
                        <span><strong className="font-medium">{factor.label}</strong> — {factor.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Methodology">
        <p className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{health.methodology}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['Excellent', 'Strong', 'Healthy', 'Watch', 'Concern', 'Critical'] as HealthLabel[]).map((label) => (
            <Badge key={label} tone={TONE[label]}>{label}</Badge>
          ))}
        </div>
        <p className="mt-2 text-2xs text-ink-500 dark:text-ink-400">
          Bands: Excellent 85+, Strong 72–84, Healthy 58–71, Watch 44–57, Concern 28–43, Critical below 28.
        </p>
      </Card>
    </div>
  );
}
