import { useEffect, useMemo, useState } from 'react';
import type { Currency, IndustryKey, ThresholdConfig, Units } from '@fca/core';
import { api, type UserSettings } from '../api/client';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Banner, Card, EmptyState, Field, PageHeader, Spinner } from '../components/ui/primitives';

/** Thresholds grouped for presentation. Every one of them is editable per company. */
const THRESHOLD_GROUPS: { label: string; keys: (keyof ThresholdConfig)[] }[] = [
  { label: 'Working capital', keys: ['receivablesVsRevenueGapPp', 'inventoryVsRevenueGapPp', 'cccIncreaseDaysMaterial'] },
  { label: 'Profitability', keys: ['marginDeclinePeriods', 'marginMaterialPp', 'revenueGrowthStrong', 'revenueGrowthWeak'] },
  { label: 'Leverage and solvency', keys: ['netDebtToEbitdaHigh', 'netDebtToEbitdaCritical', 'interestCoverageLow', 'interestCoverageCritical', 'debtToEquityHigh'] },
  { label: 'Liquidity', keys: ['currentRatioLow', 'currentRatioStrong', 'quickRatioLow'] },
  { label: 'Returns and efficiency', keys: ['roeStrong', 'roicStrong', 'roicHurdle', 'assetsVsRevenueGapPp'] },
  { label: 'Cash flow', keys: ['cfoToNetIncomeLow', 'fcfConversionLow'] },
  { label: 'Data quality tolerances', keys: ['balanceToleranceRatio', 'balanceToleranceAbsolute'] },
];

const UNITS: Units[] = ['units', 'thousands', 'lakhs', 'millions', 'crores', 'billions'];
const CURRENCIES: Currency[] = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'OTHER'];

export default function Settings() {
  const { meta, current, analysis, updateProfile, saveThresholds, theme, setTheme } = useWorkspace();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<UserSettings | null>(null);
  const [defaultThresholds, setDefaultThresholds] = useState<Record<string, string>>({});
  const [defaultsSaving, setDefaultsSaving] = useState(false);

  useEffect(() => {
    void api.settings().then(({ settings }) => {
      setDefaults(settings);
      setDefaultThresholds(Object.fromEntries(Object.entries(settings.thresholds).map(([k, v]) => [k, String(v)])));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setOverrides(
      Object.fromEntries(Object.entries(current?.thresholds ?? {}).map(([k, v]) => [k, String(v)])),
    );
    setProfile({
      name: current?.company.name ?? '',
      industry: current?.company.industry ?? 'general',
      sector: current?.company.sector ?? '',
      country: current?.company.country ?? '',
      currency: current?.company.currency ?? 'INR',
      units: current?.company.units ?? 'crores',
      fiscalYearEnd: current?.company.fiscalYearEnd ?? '',
      ticker: current?.company.ticker ?? '',
      benchmark: current?.company.benchmark ?? '',
      reportingPeriod: current?.company.reportingPeriod ?? 'annual',
      annualizeInterimMetrics: String(current?.company.annualizeInterimMetrics ?? false),
    });
  }, [current?.id, current?.thresholds, current?.company]);

  const industry = useMemo(
    () => meta?.industries.find((i) => i.key === (profile.industry ?? 'general')),
    [meta?.industries, profile.industry],
  );

  if (!meta) return null;

  const effective = analysis?.thresholds ?? meta.thresholds.defaults;

  const saveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile({
        name: profile.name?.trim(),
        industry: profile.industry as IndustryKey,
        sector: profile.sector?.trim() || null,
        country: profile.country?.trim() || null,
        currency: profile.currency as Currency,
        units: profile.units as Units,
        fiscalYearEnd: profile.fiscalYearEnd?.trim() || null,
        ticker: profile.ticker?.trim() || null,
        benchmark: profile.benchmark?.trim() || null,
        reportingPeriod: profile.reportingPeriod,
        annualizeInterimMetrics: profile.annualizeInterimMetrics === 'true',
      });
      setSaved('Company settings saved and the analysis recalculated.');
    } finally {
      setSaving(false);
    }
  };

  const saveOverrides = async () => {
    const payload: Record<string, number> = {};
    for (const [key, text] of Object.entries(overrides)) {
      const value = Number(text);
      if (text.trim() !== '' && Number.isFinite(value)) payload[key] = value;
    }
    setSaving(true);
    try {
      await saveThresholds(payload);
      setSaved('Thresholds saved. Flags and health scores have been recalculated on the new basis.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Thresholds are judgement calls, not facts. Every one of them is shown here with what it controls, and every flag records the threshold that triggered it so you can see exactly why a statement was made."
      />

      {saved && <Banner tone="positive" onDismiss={() => setSaved(null)}>{saved}</Banner>}

      <Card
        title="Defaults for new analyses"
        description="These values are applied when you create a company without entering a company-specific override."
        actions={<button type="button" className="btn-primary" disabled={!defaults || defaultsSaving} onClick={async () => {
          if (!defaults) return;
          setDefaultsSaving(true);
          try {
            const thresholds: Record<string, number> = {};
            for (const [key, value] of Object.entries(defaultThresholds)) {
              if (value.trim() && Number.isFinite(Number(value))) thresholds[key] = Number(value);
            }
            const { settings } = await api.saveSettings({
              defaultCurrency: defaults.defaultCurrency,
              defaultUnits: defaults.defaultUnits,
              defaultIndustry: defaults.defaultIndustry,
              thresholds,
            });
            setDefaults(settings);
            setSaved('New-analysis defaults saved.');
          } finally {
            setDefaultsSaving(false);
          }
        }}>Save defaults</button>}
      >
        {defaults ? (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Default industry">
              <select className="input" value={defaults.defaultIndustry} onChange={(e) => setDefaults((s) => s && ({ ...s, defaultIndustry: e.target.value }))}>
                {meta.industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              </select>
            </Field>
            <Field label="Default currency">
              <select className="input" value={defaults.defaultCurrency} onChange={(e) => setDefaults((s) => s && ({ ...s, defaultCurrency: e.target.value }))}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </Field>
            <Field label="Default units">
              <select className="input" value={defaults.defaultUnits} onChange={(e) => setDefaults((s) => s && ({ ...s, defaultUnits: e.target.value }))}>
                {UNITS.map((units) => <option key={units} value={units}>{units}</option>)}
              </select>
            </Field>
            <div className="md:col-span-3">
              <p className="label-caps mb-2">Default threshold overrides</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.keys(meta.thresholds.defaults).map((key) => (
                  <label key={key} className="text-[11px] text-ink-600 dark:text-ink-300">
                    {key}
                    <input className="cell-input mt-1 w-full" value={defaultThresholds[key] ?? ''} placeholder={String(meta.thresholds.defaults[key as keyof ThresholdConfig])} onChange={(e) => setDefaultThresholds((values) => ({ ...values, [key]: e.target.value }))} />
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : <Spinner label="Loading defaults" />}
      </Card>

      <Card title="Appearance">
        <div className="flex items-center gap-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              aria-pressed={theme === option}
              className={theme === option ? 'btn-primary capitalize' : 'btn-secondary capitalize'}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="mt-2 text-2xs text-ink-500 dark:text-ink-400">
          Stored in this browser only. “System” follows your operating system setting.
        </p>
      </Card>

      {!current ? (
        <EmptyState
          title="No analysis is open"
          message="Company settings and threshold overrides apply to a specific analysis. Open one to configure it. The engine and industry defaults below apply to every new analysis."
          action={<a className="btn-primary" href="/">Go to Home</a>}
        />
      ) : (
        <>
          <Card
            title="Company"
            description="Changing the industry re-applies its structural threshold overrides and recalculates the analysis."
            actions={<button type="button" className="btn-primary" onClick={() => void saveProfile()} disabled={saving}>Save</button>}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Company name" required>
                <input className="input" value={profile.name ?? ''} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="Industry">
                <select className="input" value={profile.industry} onChange={(e) => setProfile((p) => ({ ...p, industry: e.target.value }))}>
                  {meta.industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
                </select>
              </Field>
              <Field label="Sector">
                <input className="input" value={profile.sector ?? ''} onChange={(e) => setProfile((p) => ({ ...p, sector: e.target.value }))} />
              </Field>
              <Field label="Country">
                <input className="input" value={profile.country ?? ''} onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))} />
              </Field>
              <Field label="Currency">
                <select className="input" value={profile.currency} onChange={(e) => setProfile((p) => ({ ...p, currency: e.target.value }))}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Units" hint="Changing this does not rescale figures already entered.">
                <select className="input" value={profile.units} onChange={(e) => setProfile((p) => ({ ...p, units: e.target.value }))}>
                  {UNITS.map((u) => <option key={u} value={u} className="capitalize">{u}</option>)}
                </select>
              </Field>
              <Field label="Financial year end">
                <input className="input" value={profile.fiscalYearEnd ?? ''} onChange={(e) => setProfile((p) => ({ ...p, fiscalYearEnd: e.target.value }))} />
              </Field>
              <Field label="Ticker">
                <input className="input" value={profile.ticker ?? ''} onChange={(e) => setProfile((p) => ({ ...p, ticker: e.target.value }))} />
              </Field>
              <Field label="Benchmark">
                <input className="input" value={profile.benchmark ?? ''} onChange={(e) => setProfile((p) => ({ ...p, benchmark: e.target.value }))} />
              </Field>
              <Field label="Reporting period" hint="Choose the cadence represented by each entered period.">
                <select className="input" value={profile.reportingPeriod} onChange={(e) => setProfile((p) => ({ ...p, reportingPeriod: e.target.value }))}>
                  <option value="annual">Annual</option>
                  <option value="half_yearly">Half-yearly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </Field>
              <label className="flex items-start gap-2 rounded-lg border border-accent-100 bg-accent-50/60 p-3 text-[12px] dark:border-accent-700/40 dark:bg-accent-700/10 md:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-accent-600"
                  checked={profile.annualizeInterimMetrics === 'true'}
                  onChange={(e) => setProfile((p) => ({ ...p, annualizeInterimMetrics: String(e.target.checked) }))}
                />
                <span><strong>Annualize interim metrics.</strong> Apply annualized growth and period-length-aware DSO, DIO, and DPO when using quarterly or half-yearly data.</span>
              </label>
            </div>
          </Card>

          {industry && (
            <Card title={`Industry treatment — ${industry.label}`}>
              <p className="text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{industry.note}</p>
              {Object.keys(industry.overrides).length > 0 && (
                <>
                  <p className="label-caps mt-3">Threshold overrides applied</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(industry.overrides).map(([key, value]) => (
                      <Badge key={key} tone="accent">{key} = {String(value)}</Badge>
                    ))}
                  </div>
                </>
              )}
              {industry.suppressedMetrics.length > 0 && (
                <>
                  <p className="label-caps mt-3">Metrics suppressed as not meaningful</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {industry.suppressedMetrics.map((key) => <Badge key={key} tone="neutral">{key}</Badge>)}
                  </div>
                </>
              )}
            </Card>
          )}

          <Card
            title="Thresholds"
            description="Leave a field blank to use the engine default as adjusted for the industry. A value here overrides both."
            actions={
              <>
                <button type="button" className="btn-secondary" onClick={() => setOverrides({})}>Reset all</button>
                <button type="button" className="btn-primary" onClick={() => void saveOverrides()} disabled={saving}>Save thresholds</button>
              </>
            }
          >
            <div className="space-y-5">
              {THRESHOLD_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="label-caps mb-2">{group.label}</p>
                  <div className="overflow-x-auto">
                    <table className="fin-table">
                      <thead>
                        <tr>
                          <th className="text-left">Threshold</th>
                          <th>Engine default</th>
                          <th>In force</th>
                          <th style={{ width: 120 }}>Your override</th>
                          <th className="text-left">What it controls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.keys.map((key) => (
                          <tr key={key}>
                            <th className="font-mono text-[11.5px]">{key}</th>
                            <td className="tnum text-ink-500 dark:text-ink-400">{meta.thresholds.defaults[key]}</td>
                            <td className="tnum font-semibold">{effective[key]}</td>
                            <td className="p-0">
                              <input
                                className="cell-input"
                                value={overrides[key] ?? ''}
                                placeholder={String(effective[key])}
                                onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                                inputMode="decimal"
                                aria-label={`Override ${key}`}
                              />
                            </td>
                            <td className="max-w-lg whitespace-normal text-left text-[12px] leading-snug text-ink-600 dark:text-ink-400">
                              {meta.thresholds.descriptions[key]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card title="Rules in the engine" description={`${meta.rules.filter((r) => r.kind === 'red_flag').length} risk rules and ${meta.rules.filter((r) => r.kind === 'positive_signal').length} positive-signal rules. Each fires only when the data supports it.`} padded={false}>
        <div className="overflow-x-auto">
          <table className="fin-table">
            <thead>
              <tr>
                <th className="text-left">Rule</th>
                <th className="text-left">Type</th>
                <th className="text-left">Condition</th>
              </tr>
            </thead>
            <tbody>
              {meta.rules.map((rule) => (
                <tr key={rule.id}>
                  <th className="font-mono text-[11.5px]">{rule.id}</th>
                  <td className="text-left">
                    <Badge tone={rule.kind === 'red_flag' ? 'negative' : 'positive'}>
                      {rule.kind === 'red_flag' ? 'Risk' : 'Positive'}
                    </Badge>
                  </td>
                  <td className="max-w-2xl whitespace-normal text-left text-[12px] leading-snug text-ink-600 dark:text-ink-300">
                    {rule.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Environment">
        <dl className="grid gap-x-6 gap-y-2 text-[12.5px] md:grid-cols-2">
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Storage</dt>
            <dd className="font-medium">{meta.config.storage === 'mongodb' ? 'MongoDB' : 'In-memory (not persisted)'}</dd>
          </div>
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Narrative generation</dt>
            <dd className="font-medium">{meta.config.llmEnabled ? 'LLM configured' : 'Deterministic templates'}</dd>
          </div>
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Maximum upload size</dt>
            <dd className="font-medium">{(meta.config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB</dd>
          </div>
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Line items in the registry</dt>
            <dd className="font-medium">{meta.lineItems.length}</dd>
          </div>
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Metrics defined</dt>
            <dd className="font-medium">{meta.metrics.length}</dd>
          </div>
          <div className="flex justify-between border-b border-ink-100 pb-1 dark:border-ink-800">
            <dt className="text-ink-600 dark:text-ink-400">Environment</dt>
            <dd className="font-medium">{meta.config.environment}</dd>
          </div>
        </dl>
        <p className="mt-3 text-2xs leading-relaxed text-ink-500 dark:text-ink-400">
          Financial metrics are always calculated by the deterministic engine. A language model, where one is configured, only
          rephrases facts the engine has already produced — it never computes a number, and it never sees raw unvalidated input.
          API keys are read by the server alone and are never sent to the browser.
        </p>
      </Card>
    </div>
  );
}
