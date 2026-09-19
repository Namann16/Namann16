import { useState } from 'react';
import type { MetricConfig } from '@fca/core';
import { Badge, Card, Field } from '../ui/primitives';

/**
 * Metric definition switches (specification Part B).
 *
 * Several of these metrics have more than one defensible definition and the difference is not
 * cosmetic — on the reference company the two ROCE definitions differ by 3.3x and point to
 * opposite conclusions about capital productivity. Leaving the choice implicit in the code means
 * the user cannot see it, cannot change it, and cannot disagree with it.
 *
 * Nothing here is a threshold or a judgement: each switch selects which arithmetic runs. Whatever
 * is chosen, the resolved formula is printed beside every affected figure, and any alternative
 * that diverges by more than the tolerance is shown alongside rather than discarded.
 */

type Option<T extends string> = { value: T; label: string; hint: string };

const ROCE_NUMERATOR: Option<NonNullable<NonNullable<MetricConfig['roce']>['numerator']>>[] = [
  { value: 'ebit', label: 'EBIT', hint: 'Operating profit only — excludes treasury and other non-operating income.' },
  { value: 'ebit_plus_other_income', label: 'EBIT + other income', hint: 'Includes other income. Appropriate where treasury income is structural rather than incidental.' },
];

const ROCE_DENOMINATOR: Option<NonNullable<NonNullable<MetricConfig['roce']>['denominator']>>[] = [
  { value: 'assets_less_current_liabilities', label: 'Assets less current liabilities', hint: 'The textbook basis. Counts every source of long-term funding, including interest-free customer advances.' },
  { value: 'equity_plus_debt', label: 'Equity + debt', hint: 'Capital that was actually invested by shareholders and lenders. Excludes customer funding.' },
  { value: 'equity_plus_debt_less_surplus_cash', label: 'Equity + debt less surplus cash', hint: 'Strips idle cash out of the capital base, isolating the return on operating capital.' },
];

const ROIC_CASH: Option<NonNullable<NonNullable<MetricConfig['roic']>['surplusCashTreatment']>>[] = [
  { value: 'cash_and_liquid_investments', label: 'Cash + liquid investments', hint: 'Treats short-term investments as surplus. Matches how net debt is computed.' },
  { value: 'cash_only', label: 'Cash only', hint: 'Treats short-term investments as operating capital the business must earn a return on.' },
];

const ROIC_TAX: Option<NonNullable<NonNullable<MetricConfig['roic']>['nopatBasis']>>[] = [
  { value: 'effective_tax_rate', label: 'Effective rate', hint: 'The rate implied by the P&L. Reflects what the company actually paid.' },
  { value: 'statutory_rate', label: 'Statutory rate', hint: 'A fixed rate you supply. Removes the effect of one-off tax items from the comparison.' },
];

const FCF_CAPEX: Option<NonNullable<NonNullable<MetricConfig['freeCashFlow']>['capexBasis']>>[] = [
  { value: 'ppe_plus_intangibles', label: 'PP&E + intangibles', hint: 'Counts capitalised development spend as capital expenditure. Usually the truest picture.' },
  { value: 'ppe_only', label: 'PP&E only', hint: 'Tangible capital expenditure alone. Overstates free cash flow where development spend is capitalised.' },
  { value: 'total_investing_capex', label: 'All investing outflows', hint: 'Includes investments purchased. The most conservative reading.' },
];

const WC_BASIS: Option<NonNullable<NonNullable<MetricConfig['workingCapital']>['basis']>>[] = [
  { value: 'total_current', label: 'Total current', hint: 'Current assets less current liabilities, as reported.' },
  { value: 'operating_only', label: 'Operating only', hint: 'Receivables + inventory − payables. Excludes cash and short-term debt, which are financing decisions.' },
];

const DSO_BASIS: Option<NonNullable<NonNullable<MetricConfig['receivables']>['dsoBasis']>>[] = [
  { value: 'trade_plus_unbilled', label: 'All receivables', hint: 'Includes unbilled revenue. Not comparable with peers who report trade receivables alone.' },
  { value: 'trade_only', label: 'Trade receivables only', hint: 'Billed receivables alone. The peer-comparable basis.' },
  { value: 'both', label: 'Show both', hint: 'Reports the total-receivables figure and always prints the trade-only figure beside it.' },
];

const DIO_DENOMINATOR: Option<NonNullable<NonNullable<MetricConfig['inventory']>['dioDenominator']>>[] = [
  { value: 'cogs', label: 'Cost of goods sold', hint: 'The standard denominator.' },
  { value: 'total_operating_cost', label: 'Total operating cost', hint: 'For businesses that carry most of their cost below the gross-profit line.' },
  { value: 'revenue', label: 'Revenue', hint: 'A fallback where no reliable cost split is reported. Not comparable with a COGS-based figure.' },
];

function Choice<T extends string>({ label, options, value, fallback, onChange }: {
  label: string;
  options: Option<T>[];
  value: T | undefined;
  fallback: T;
  onChange: (value: T) => void;
}) {
  const active = value ?? fallback;
  const hint = options.find((o) => o.value === active)?.hint;
  return (
    <Field label={label} hint={hint}>
      <select className="input" value={active} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function MetricDefinitionPanel({
  config,
  onSave,
  busy,
}: {
  config: MetricConfig | undefined;
  onSave: (config: MetricConfig) => Promise<void> | void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState<MetricConfig>(() => config ?? {});
  const [saved, setSaved] = useState(false);

  const patch = (next: MetricConfig) => { setSaved(false); setDraft((current) => ({ ...current, ...next })); };
  const save = async () => { await onSave(draft); setSaved(true); };

  const statutorySelected = draft.roic?.nopatBasis === 'statutory_rate';

  return (
    <Card
      title="Metric definitions"
      description="Where a metric has more than one defensible definition, this chooses which one is reported. The resolved formula is printed beside every figure it affects, and any alternative that diverges materially is shown alongside it."
      actions={
        <>
          {saved && <Badge tone="positive">Saved</Badge>}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save definitions'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Choice
          label="ROCE numerator"
          options={ROCE_NUMERATOR}
          value={draft.roce?.numerator}
          fallback="ebit"
          onChange={(numerator) => patch({ roce: { ...draft.roce, numerator } })}
        />
        <Choice
          label="ROCE capital employed"
          options={ROCE_DENOMINATOR}
          value={draft.roce?.denominator}
          fallback="assets_less_current_liabilities"
          onChange={(denominator) => patch({ roce: { ...draft.roce, denominator } })}
        />

        <label className="flex items-start gap-2 text-callout md:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.roce?.excludeCustomerAdvances ?? false}
            onChange={(e) => patch({ roce: { ...draft.roce, excludeCustomerAdvances: e.target.checked } })}
          />
          <span>
            Exclude customer advances from capital employed
            <span className="mt-0.5 block text-footnote text-ink-500 dark:text-ink-400">
              Customer advances are interest-free funding from customers rather than capital the company raised.
              Counting them depresses ROCE for order-book businesses. Only affects the assets-less-current-liabilities basis.
            </span>
          </span>
        </label>

        <Choice
          label="ROIC surplus cash"
          options={ROIC_CASH}
          value={draft.roic?.surplusCashTreatment}
          fallback="cash_and_liquid_investments"
          onChange={(surplusCashTreatment) => patch({ roic: { ...draft.roic, surplusCashTreatment } })}
        />
        <Choice
          label="ROIC tax basis"
          options={ROIC_TAX}
          value={draft.roic?.nopatBasis}
          fallback="effective_tax_rate"
          onChange={(nopatBasis) => patch({ roic: { ...draft.roic, nopatBasis } })}
        />

        {statutorySelected && (
          <Field
            label="Statutory tax rate (%)"
            hint="Required for the statutory basis. There is no universal rate, so without one the engine uses the effective rate and says so on the metric rather than assuming a jurisdiction."
          >
            <input
              className="input tnum"
              type="number"
              min={0}
              max={60}
              step={0.1}
              value={draft.roic?.statutoryRatePercent ?? ''}
              onChange={(e) => patch({
                roic: {
                  ...draft.roic,
                  statutoryRatePercent: e.target.value === '' ? undefined : Number(e.target.value),
                },
              })}
            />
          </Field>
        )}

        <Choice
          label="Free cash flow capex"
          options={FCF_CAPEX}
          value={draft.freeCashFlow?.capexBasis}
          fallback="ppe_plus_intangibles"
          onChange={(capexBasis) => patch({ freeCashFlow: { capexBasis } })}
        />
        <Choice
          label="Working capital"
          options={WC_BASIS}
          value={draft.workingCapital?.basis}
          fallback="total_current"
          onChange={(basis) => patch({ workingCapital: { basis } })}
        />
        <Choice
          label="DSO receivables basis"
          options={DSO_BASIS}
          value={draft.receivables?.dsoBasis}
          fallback="trade_plus_unbilled"
          onChange={(dsoBasis) => patch({ receivables: { dsoBasis } })}
        />
        <Choice
          label="DIO denominator"
          options={DIO_DENOMINATOR}
          value={draft.inventory?.dioDenominator}
          fallback="cogs"
          onChange={(dioDenominator) => patch({ inventory: { dioDenominator } })}
        />

        <Field
          label="Show both definitions when they differ by more than (%)"
          hint="Below this, only the selected definition is reported. The specification suggests 25%."
        >
          <input
            className="input tnum"
            type="number"
            min={0}
            max={500}
            step={1}
            value={draft.definitionDivergencePercent ?? 25}
            onChange={(e) => patch({ definitionDivergencePercent: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </Field>
      </div>
    </Card>
  );
}
