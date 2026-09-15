import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Currency, IndustryKey, Units } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { api } from '../api/client';
import { Badge, Banner, Card, EmptyState, Field, Modal, PageHeader, Spinner } from '../components/ui/primitives';

const UNITS: { value: Units; label: string }[] = [
  { value: 'units', label: 'Units' },
  { value: 'thousands', label: 'Thousands' },
  { value: 'lakhs', label: 'Lakhs' },
  { value: 'millions', label: 'Millions' },
  { value: 'crores', label: 'Crores' },
  { value: 'billions', label: 'Billions' },
];

const CURRENCIES: Currency[] = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'OTHER'];

interface SetupForm {
  name: string;
  industry: IndustryKey;
  sector: string;
  country: string;
  currency: Currency;
  units: Units;
  fiscalYearEnd: string;
  reportingPeriod: 'annual' | 'half_yearly' | 'quarterly';
  ticker: string;
  benchmark: string;
  marketCap: string;
  sharePrice: string;
  sharesOutstanding: string;
  peers: string;
}

const EMPTY_FORM: SetupForm = {
  name: '', industry: 'general', sector: '', country: '', currency: 'INR', units: 'crores',
  fiscalYearEnd: '31 March', reportingPeriod: 'annual', ticker: '', benchmark: '',
  marketCap: '', sharePrice: '', sharesOutstanding: '', peers: '',
};

function numberOrNull(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export default function Landing() {
  const { companies, current, meta, openCompany, createCompany, loadSample, deleteCompany, loading, closeCompany } = useWorkspace();
  const navigate = useNavigate();
  const [setupOpen, setSetupOpen] = useState(false);
  const [form, setForm] = useState<SetupForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (destination: '/data' | '/dashboard') => {
    if (!form.name.trim()) {
      setFormError('A company name is required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await createCompany({
        name: form.name.trim(),
        industry: form.industry,
        sector: form.sector.trim() || null,
        country: form.country.trim() || null,
        currency: form.currency,
        units: form.units,
        fiscalYearEnd: form.fiscalYearEnd.trim() || null,
        reportingPeriod: form.reportingPeriod,
        ticker: form.ticker.trim() || null,
        benchmark: form.benchmark.trim() || null,
        marketCap: numberOrNull(form.marketCap),
        sharePrice: numberOrNull(form.sharePrice),
        sharesOutstanding: numberOrNull(form.sharesOutstanding),
        peers: form.peers
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 20)
          .map((name) => ({ name, metrics: {} })),
        periods: [],
      });
      setSetupOpen(false);
      setForm(EMPTY_FORM);
      navigate(destination);
    } catch {
      // The workspace surfaces the error banner; keep the dialog open so the user can correct it.
    } finally {
      setBusy(false);
    }
  };

  const openSample = async () => {
    setBusy(true);
    try {
      await loadSample();
      navigate('/dashboard');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Financial Company Analyzer"
        description="Transform raw company financials into structured financial analysis, trends, ratios, and actionable insights."
      />

      <div className="grid gap-3 md:grid-cols-3">
        <button type="button" onClick={() => setSetupOpen(true)} className="surface px-4 py-3.5 text-left transition-colors hover:border-accent-300">
          <p className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">Create a new analysis</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            Set up the company, then enter financial data in the spreadsheet-style grid or import it from Excel.
          </p>
        </button>

        <button type="button" onClick={() => { if (current) navigate('/data'); else setSetupOpen(true); }} className="surface px-4 py-3.5 text-left transition-colors hover:border-accent-300">
          <p className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">Upload an Excel file</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            Any workbook is accepted. Terminology is matched against a financial dictionary and you confirm the mapping before anything is imported.
          </p>
        </button>

        <a href={api.urls.template()} className="surface px-4 py-3.5 text-left transition-colors hover:border-accent-300" download>
          <p className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">Download the Excel template</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            Six sheets covering company information, the three statements, share data and optional segment data.
          </p>
        </a>
      </div>

      {meta?.config.storage === 'memory' && (
        <Banner tone="caution" title="Running without a database">
          No <code className="font-mono">MONGODB_URI</code> is configured, so analyses are held in memory and will be lost when the
          server restarts. Export your work, or set a connection string in <code className="font-mono">.env</code> to persist it.
        </Banner>
      )}

      <Card
        title="Your analyses"
        description={companies.length ? `${companies.length} saved` : undefined}
        actions={
          <button type="button" className="btn-secondary" onClick={openSample} disabled={busy || loading}>
            Load sample dataset
          </button>
        }
        padded={false}
      >
        {loading && companies.length === 0 ? (
          <div className="p-4"><Spinner label="Loading analyses" /></div>
        ) : companies.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No analyses yet"
              message="Create your first company analysis, or load the fictional Apex Consumer Products dataset to see every feature working against realistic five-year financials."
              action={
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" onClick={() => setSetupOpen(true)}>Create analysis</button>
                  <button type="button" className="btn-secondary" onClick={openSample} disabled={busy}>Load sample</button>
                </div>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="text-left">Company</th>
                  <th className="text-left">Industry</th>
                  <th>Periods</th>
                  <th>Latest</th>
                  <th className="text-left">Units</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((entry) => (
                  <tr key={entry.id}>
                    <th>
                      <span className="flex items-center gap-2">
                        {entry.name}
                        {entry.isSample && <Badge tone="caution">Sample</Badge>}
                        {current?.id === entry.id && <Badge tone="accent">Open</Badge>}
                      </span>
                    </th>
                    <td className="text-left text-ink-600 dark:text-ink-300">
                      {meta?.industries.find((i) => i.key === entry.industry)?.label ?? entry.industry}
                    </td>
                    <td className="tnum">{entry.periodCount}</td>
                    <td className="tnum">{entry.latestPeriod ?? 'n/a'}</td>
                    <td className="text-left text-ink-600 dark:text-ink-300">{entry.currency} · {entry.units}</td>
                    <td>
                      <span className="flex justify-end gap-1.5">
                        <button type="button" className="btn-secondary" onClick={async () => { await openCompany(entry.id); navigate('/dashboard'); }}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => {
                            if (window.confirm(`Delete "${entry.name}" and all of its financial data? This cannot be undone.`)) {
                              void deleteCompany(entry.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {current && (
        <Card title="Currently open" actions={<button type="button" className="btn-ghost" onClick={closeCompany}>Close</button>}>
          <div className="flex flex-wrap items-center gap-4 text-[12.5px]">
            <span className="font-semibold">{current.company.name}</span>
            <span className="text-ink-500 dark:text-ink-400">{current.periods.length} periods</span>
            <button type="button" className="btn-primary" onClick={() => navigate('/dashboard')}>Open dashboard</button>
            <button type="button" className="btn-secondary" onClick={() => navigate('/data')}>Edit data</button>
          </div>
        </Card>
      )}

      <Card title="How the analysis works">
        <ol className="grid gap-3 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300 md:grid-cols-3">
          <li>
            <span className="label-caps block">1 · Raw data</span>
            Figures you enter or import are stored exactly as supplied and marked as entered. Nothing is inferred and a blank is never read as zero.
          </li>
          <li>
            <span className="label-caps block">2 · Calculated data</span>
            A deterministic engine derives totals, ratios, growth rates and scores. Every metric records its formula, the inputs it used, and whether the data was sufficient.
          </li>
          <li>
            <span className="label-caps block">3 · Interpretation</span>
            Flags and written insights are generated from those calculations only, and each one carries the evidence behind it so you can trace any statement back to the numbers.
          </li>
        </ol>
      </Card>

      <Modal open={setupOpen} title="New company analysis" onClose={() => setSetupOpen(false)} wide>
        <div className="space-y-4">
          {formError && <Banner tone="negative">{formError}</Banner>}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Company name" required hint="Used throughout the analysis and on exported reports.">
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Northwind Manufacturing Ltd." autoFocus />
            </Field>
            <Field label="Industry" hint="Sets structure-aware thresholds. Leverage limits and inventory metrics differ materially by industry.">
              <select className="input" value={form.industry} onChange={(e) => set('industry', e.target.value as IndustryKey)}>
                {meta?.industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              </select>
            </Field>
            <Field label="Sector"><input className="input" value={form.sector} onChange={(e) => set('sector', e.target.value)} placeholder="Optional" /></Field>
            <Field label="Country"><input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="Optional" /></Field>
            <Field label="Currency">
              <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Units" required hint="Every figure you enter must use these units. Ratios are unaffected by the choice.">
              <select className="input" value={form.units} onChange={(e) => set('units', e.target.value as Units)}>
                {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </Field>
            <Field label="Financial year end"><input className="input" value={form.fiscalYearEnd} onChange={(e) => set('fiscalYearEnd', e.target.value)} placeholder="e.g. 31 March" /></Field>
            <Field label="Reporting period">
              <select className="input" value={form.reportingPeriod} onChange={(e) => set('reportingPeriod', e.target.value as SetupForm['reportingPeriod'])}>
                <option value="annual">Annual</option>
                <option value="half_yearly">Half yearly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </Field>
          </div>

          <div>
            <p className="label-caps mb-2">Market data (optional)</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Market capitalisation" hint="In the units above."><input className="input tnum" value={form.marketCap} onChange={(e) => set('marketCap', e.target.value)} inputMode="decimal" /></Field>
              <Field label="Share price"><input className="input tnum" value={form.sharePrice} onChange={(e) => set('sharePrice', e.target.value)} inputMode="decimal" /></Field>
              <Field label="Shares outstanding"><input className="input tnum" value={form.sharesOutstanding} onChange={(e) => set('sharesOutstanding', e.target.value)} inputMode="decimal" /></Field>
              <Field label="Stock ticker"><input className="input" value={form.ticker} onChange={(e) => set('ticker', e.target.value)} /></Field>
              <Field label="Benchmark index"><input className="input" value={form.benchmark} onChange={(e) => set('benchmark', e.target.value)} /></Field>
              <Field label="Peer companies" hint="Comma separated. Add their metrics later on the Peer Comparison screen.">
                <input className="input" value={form.peers} onChange={(e) => set('peers', e.target.value)} placeholder="Peer A, Peer B" />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-ink-200 pt-3 dark:border-ink-800">
            <button type="button" className="btn-secondary" onClick={() => setSetupOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={() => void submit('/data')} disabled={busy}>
              {busy ? 'Creating…' : 'Create and add financial data'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
