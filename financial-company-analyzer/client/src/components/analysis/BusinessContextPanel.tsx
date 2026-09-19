import { useMemo, useState } from 'react';
import type { BusinessContext, FinancialPeriod } from '@fca/core';
import { Badge, Card, Field } from '../ui/primitives';

/**
 * The business-context sheet (specification C3) and the unusual-period flag (C4).
 *
 * These are the inputs the five statements cannot yield, and several explanation tests cannot run
 * without them — an order book turns an inventory build into a production ramp, a recognition basis
 * turns high inventory days into a structural fact, and a flag on an exceptional year stops the
 * next year's comparison against it from reading as a collapse.
 *
 * Every field is optional. The panel says which explanations each one unlocks rather than asking
 * for data without a reason, because a field whose purpose is unclear does not get filled in.
 */

type PeriodContext = NonNullable<BusinessContext['periods']>[string];

const RECOGNITION_OPTIONS: { value: PeriodContext['revenueRecognitionBasis'] | ''; label: string }[] = [
  { value: '', label: 'Not stated' },
  { value: 'point_in_time', label: 'Point in time' },
  { value: 'over_time_milestone', label: 'Over time — milestone' },
  { value: 'over_time_cost_to_cost', label: 'Over time — cost to cost' },
  { value: 'subscription', label: 'Subscription' },
];

const CUSTOMER_OPTIONS: { value: PeriodContext['customerType'] | ''; label: string }[] = [
  { value: '', label: 'Not stated' },
  { value: 'government', label: 'Government' },
  { value: 'enterprise_b2b', label: 'Enterprise / B2B' },
  { value: 'consumer', label: 'Consumer' },
  { value: 'mixed', label: 'Mixed' },
];

function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function BusinessContextPanel({
  periods,
  businessContext,
  unitsLabel,
  onSaveContext,
  onSavePeriods,
  busy,
}: {
  periods: FinancialPeriod[];
  businessContext: BusinessContext | undefined;
  unitsLabel: string;
  onSaveContext: (context: BusinessContext) => Promise<void> | void;
  onSavePeriods: (periods: FinancialPeriod[]) => Promise<void> | void;
  busy?: boolean;
}) {
  const ordered = useMemo(() => [...periods].sort((a, b) => a.order - b.order), [periods]);
  const [draft, setDraft] = useState<BusinessContext>(() => ({ periods: { ...(businessContext?.periods ?? {}) } }));
  const [saved, setSaved] = useState(false);

  if (ordered.length === 0) return null;

  const contextFor = (label: string): PeriodContext => draft.periods?.[label] ?? {};

  const patch = (label: string, values: Partial<PeriodContext>) => {
    setSaved(false);
    setDraft((current) => ({
      periods: { ...(current.periods ?? {}), [label]: { ...(current.periods?.[label] ?? {}), ...values } },
    }));
  };

  const save = async () => {
    // The unusual flag lives on the period record as well as here, because the engine reads it
    // from whichever the user supplied; both are written so the two cannot disagree.
    const flagged = ordered.map((period) => {
      const context = contextFor(period.label);
      const unusual = context.unusual === true;
      const reason = context.unusualReason?.trim();
      return {
        ...period,
        ...(unusual ? { unusual: true } : { unusual: false }),
        ...(unusual && reason ? { unusualReason: reason } : { unusualReason: undefined }),
      };
    });
    await onSaveContext(draft);
    await onSavePeriods(flagged);
    setSaved(true);
  };

  return (
    <Card
      title="Business context (optional)"
      description="Facts the five statements cannot express. Leaving these blank is fine — the engine reports which explanation tests could not run and why."
      actions={
        <>
          {saved && <Badge tone="positive">Saved</Badge>}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save context'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {ordered.map((period) => {
          const context = contextFor(period.label);
          const unusual = context.unusual === true || period.unusual === true;
          return (
            <div key={period.label} className="rounded-lg border border-ink-200 px-3 py-2.5 dark:border-ink-800">
              <p className="label-caps">{period.label}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={`Order book, closing (${unitsLabel})`}>
                  <input
                    className="input tnum"
                    type="number"
                    value={context.orderBook ?? ''}
                    onChange={(e) => patch(period.label, { orderBook: numberOrNull(e.target.value) })}
                  />
                </Field>
                <Field label={`Order inflow (${unitsLabel})`}>
                  <input
                    className="input tnum"
                    type="number"
                    value={context.orderInflow ?? ''}
                    onChange={(e) => patch(period.label, { orderInflow: numberOrNull(e.target.value) })}
                  />
                </Field>
                <Field label="Revenue recognition basis">
                  <select
                    className="input"
                    value={context.revenueRecognitionBasis ?? ''}
                    onChange={(e) => patch(period.label, {
                      revenueRecognitionBasis: (e.target.value || undefined) as PeriodContext['revenueRecognitionBasis'],
                    })}
                  >
                    {RECOGNITION_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ''}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Customer type">
                  <select
                    className="input"
                    value={context.customerType ?? ''}
                    onChange={(e) => patch(period.label, {
                      customerType: (e.target.value || undefined) as PeriodContext['customerType'],
                    })}
                  >
                    {CUSTOMER_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ''}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Largest customer, % of revenue">
                  <input
                    className="input tnum"
                    type="number"
                    min={0}
                    max={100}
                    value={context.largestCustomerPct ?? ''}
                    onChange={(e) => patch(period.label, { largestCustomerPct: numberOrNull(e.target.value) })}
                  />
                </Field>
                <Field label="Employee count">
                  <input
                    className="input tnum"
                    type="number"
                    min={0}
                    value={context.employeeCount ?? ''}
                    onChange={(e) => patch(period.label, { employeeCount: numberOrNull(e.target.value) })}
                  />
                </Field>
                <Field label={`R&D expensed (${unitsLabel})`}>
                  <input
                    className="input tnum"
                    type="number"
                    value={context.rdExpensed ?? ''}
                    onChange={(e) => patch(period.label, { rdExpensed: numberOrNull(e.target.value) })}
                  />
                </Field>
                <Field label={`R&D capitalised (${unitsLabel})`}>
                  <input
                    className="input tnum"
                    type="number"
                    value={context.rdCapitalised ?? ''}
                    onChange={(e) => patch(period.label, { rdCapitalised: numberOrNull(e.target.value) })}
                  />
                </Field>
              </div>

              <label className="mt-2 flex items-start gap-2 text-[12px] text-ink-700 dark:text-ink-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={unusual}
                  onChange={(e) => patch(period.label, { unusual: e.target.checked })}
                />
                <span>
                  This year was not representative.
                  <span className="block text-2xs text-ink-500 dark:text-ink-400">
                    The engine excludes it from trend baselines and says so, instead of reading the next year’s
                    comparison against it as a deterioration.
                  </span>
                </span>
              </label>
              {unusual && (
                <div className="mt-1.5">
                  <Field label="Why it was not representative">
                    <input
                      className="input"
                      maxLength={500}
                      placeholder="e.g. CFO inflated by a one-off surge in customer advances after contract signings"
                      value={context.unusualReason ?? period.unusualReason ?? ''}
                      onChange={(e) => patch(period.label, { unusualReason: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-2xs text-ink-500 dark:text-ink-400">
        Order book and revenue recognition basis let the engine test whether an inventory or working-capital build is a
        production ramp against contracted demand. Customer type and concentration separate collection risk from
        concentration risk. None of these change a calculated number — they decide which explanations can be tested.
      </p>
    </Card>
  );
}
