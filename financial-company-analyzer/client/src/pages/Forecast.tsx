import { useEffect, useState } from 'react';
import type { ForecastSeries } from '@fca/core';
import { api } from '../api/client';
import { useWorkspace } from '../state/WorkspaceContext';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui/primitives';
import { formatCurrency, formatMetric, fmtCtx } from '../lib/display';

export default function Forecast() {
  const { current } = useWorkspace();
  const [forecasts, setForecasts] = useState<ForecastSeries[]>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    void api.forecasts(current.id, 3)
      .then(({ forecasts: result }) => setForecasts(result))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load forecasts.'))
      .finally(() => setLoading(false));
  }, [current]);

  if (!current) return null;
  const ctx = fmtCtx(current.company);

  const generateNarrative = async () => {
    setAiLoading(true);
    setError(null);
    try {
      const result = await api.aiNarrative(current.id);
      setNarrative(result.narrative);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not generate the AI explanation.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="stagger space-y-4">
      <PageHeader
        title="AI Forecast & Explanation"
        description="Transparent trend projections and optional AI wording built only from the deterministic analysis facts."
      />
      {error && <Card><p className="text-negative-700 dark:text-negative-300">{error}</p></Card>}
      <Card
        title="Evidence-backed explanation"
        description="The AI provider never calculates metrics. It receives the same verified facts shown in the analysis."
        actions={<button type="button" className="btn-primary" onClick={() => void generateNarrative()} disabled={aiLoading}>{aiLoading ? 'Generating…' : 'Generate AI explanation'}</button>}
      >
        {narrative ? <p className="whitespace-pre-wrap text-callout leading-relaxed text-ink-700 dark:text-ink-300">{narrative}</p> : <p className="text-callout text-ink-500 dark:text-ink-400">Generate an explanation when you want an analyst-style summary. Your configured server-side AI key is never sent to the browser.</p>}
      </Card>
      <Card title="Directional forecasts" description="A linear trend with a 95% residual band. Forecasts are not guarantees and should be reviewed against business context.">
        {loading ? <Spinner label="Calculating forecasts" /> : forecasts.length === 0 ? (
          <EmptyState title="Not enough history" message="At least three comparable historical periods are required to create a forecast." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {forecasts.map((forecast) => (
              <div key={forecast.key} className="surface p-3">
                <h2 className="font-semibold">{forecast.label}</h2>
                <p className="mt-1 text-2xs text-ink-500 dark:text-ink-400">{forecast.model} · {Math.round(forecast.confidence * 100)}% model confidence</p>
                <div className="mt-3 space-y-2">
                  {forecast.points.map((point) => (
                    <div key={point.period} className="flex items-baseline justify-between gap-2 text-callout">
                      <span className="text-ink-500 dark:text-ink-400">{point.period}</span>
                      <span className="tnum font-semibold">{forecast.unit === 'currency' ? formatCurrency(point.value, ctx) : formatMetric(point.value, forecast.unit, ctx)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-2xs leading-relaxed text-ink-500 dark:text-ink-400">{forecast.limitation}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
