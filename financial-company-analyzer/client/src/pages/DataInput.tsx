import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LineItemDef, Num, StatementKey } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { api, ApiError, type CommitResponse, type ParseResponse } from '../api/client';
import { Badge, Banner, Card, EmptyState, Field, Modal, PageHeader, SourceDot, Spinner } from '../components/ui/primitives';
import { fmtCtx, formatCurrency } from '../lib/display';

/** Parse a typed cell. Empty means "not available" and is stored as an absent value, never zero. */
function parseInput(text: string): { value: Num; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, error: null };

  let working = trimmed.replace(/[₹$€£¥,\s]/g, '');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(working);
  if (paren) { negative = true; working = paren[1]!; }

  if (!/^[-+]?\d*\.?\d+$/.test(working)) {
    return { value: null, error: `"${trimmed}" is not a number.` };
  }
  const value = Number(working);
  if (!Number.isFinite(value)) return { value: null, error: `"${trimmed}" is not a finite number.` };
  return { value: negative ? -value : value, error: null };
}

function nextPeriodLabel(existing: string[]): string {
  const years = existing
    .map((label) => /(\d{2,4})\s*$/.exec(label)?.[1])
    .filter(Boolean)
    .map((y) => (y!.length === 4 ? Number(y) : 2000 + Number(y)));
  const next = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
  return `FY${String(next).slice(-2)}`;
}

export default function DataInput() {
  const { current, analysis, meta, setPeriodsLocal, savePeriods, dirty, loading } = useWorkspace();
  const [statement, setStatement] = useState<StatementKey>('income');
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [importState, setImportState] = useState<ParseResponse | null>(null);
  const [importDecisions, setImportDecisions] = useState<Record<string, string | null>>({});
  const [importPeriods, setImportPeriods] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importResult, setImportResult] = useState<CommitResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const periods = useMemo(() => [...(current?.periods ?? [])].sort((a, b) => a.order - b.order), [current?.periods]);
  const lineItems = useMemo(
    () => (meta?.lineItems ?? []).filter((item) => item.statement === statement),
    [meta?.lineItems, statement],
  );

  if (!current) {
    return (
      <EmptyState
        title="No analysis is open"
        message="Create a company analysis or open an existing one before entering financial data."
        action={<Link className="btn-primary" to="/">Go to Home</Link>}
      />
    );
  }

  const ctx = fmtCtx(current.company);

  /* ---------------- Grid editing ---------------- */

  const updateCell = (periodLabel: string, key: string, text: string) => {
    const { value, error } = parseInput(text);
    const errorKey = `${periodLabel}:${key}`;

    setCellErrors((prev) => {
      const next = { ...prev };
      if (error) next[errorKey] = error;
      else delete next[errorKey];
      return next;
    });
    if (error) return;

    setPeriodsLocal(
      periods.map((period) => {
        if (period.label !== periodLabel) return period;
        const values = { ...period.values };
        const sources = { ...period.sources };
        if (value === null) {
          delete values[key];
          delete sources[key];
        } else {
          values[key] = value;
          sources[key] = 'entered';
        }
        return { ...period, values, sources };
      }),
    );
  };

  const addPeriod = () => {
    const label = nextPeriodLabel(periods.map((p) => p.label));
    setPeriodsLocal([...periods, { label, endDate: null, order: periods.length, values: {}, sources: {} }]);
  };

  const removePeriod = (label: string) => {
    if (!window.confirm(`Remove ${label} and every figure entered against it?`)) return;
    setPeriodsLocal(periods.filter((p) => p.label !== label).map((p, index) => ({ ...p, order: index })));
  };

  const renamePeriod = (oldLabel: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed || periods.some((p) => p.label === trimmed && p.label !== oldLabel)) return;
    setPeriodsLocal(periods.map((p) => (p.label === oldLabel ? { ...p, label: trimmed } : p)));
  };

  /** Copy every value from the previous period, as a starting point for the new year. */
  const copyPrevious = (label: string) => {
    const index = periods.findIndex((p) => p.label === label);
    if (index <= 0) return;
    const source = periods[index - 1]!;
    if (!window.confirm(`Copy all entered values from ${source.label} into ${label}? Existing values in ${label} will be overwritten.`)) return;
    const entered = Object.fromEntries(
      Object.entries(source.values).filter(([key]) => source.sources[key] === 'entered'),
    );
    setPeriodsLocal(
      periods.map((p) =>
        p.label === label
          ? { ...p, values: entered as Record<string, Num>, sources: Object.fromEntries(Object.keys(entered).map((k) => [k, 'entered' as const])) }
          : p,
      ),
    );
  };

  const clearPeriod = (label: string) => {
    if (!window.confirm(`Clear every value entered for ${label}? The period itself is kept.`)) return;
    setPeriodsLocal(periods.map((p) => (p.label === label ? { ...p, values: {}, sources: {} } : p)));
  };

  /* ---------------- Excel import ---------------- */

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const parsed = await api.parseUpload(file, current.company.units);
      setImportState(parsed);
      setImportDecisions(Object.fromEntries(parsed.mappings.map((m) => [m.rowKey, m.selected])));
      setImportPeriods(parsed.periods.map((p) => p.label));
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'The file could not be read.');
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImport = async () => {
    if (!importState) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await api.commitImport({
        importId: importState.importId,
        mappings: importDecisions,
        periods: importPeriods,
        mode: importMode,
        companyId: current.id,
      });
      setImportResult(result);
      setImportState(null);
      // Reload from the server so the grid shows exactly what was persisted.
      await savePeriods(result.company?.periods ?? result.periods);
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'The import could not be applied.');
    } finally {
      setImportBusy(false);
    }
  };

  const unresolved = importState?.mappings.filter(
    (m) => !m.isSectionHeader && importDecisions[m.rowKey] === null && m.suggestions.length > 0,
  ).length ?? 0;

  /* ---------------- Render ---------------- */

  const statements = meta?.statements ?? [];
  const errorCount = Object.keys(cellErrors).length;

  let section = '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data Input"
        description="Enter financial data year by year, or import it from a spreadsheet. Leave a cell blank when a figure is not available — a blank is never treated as zero, and totals you leave empty are derived automatically and marked as calculated."
        actions={
          <>
            <a className="btn-secondary" href={api.urls.template()} download>Download template</a>
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importBusy}>
              {importBusy ? 'Reading…' : 'Import Excel'}
            </button>
            <button type="button" className="btn-primary" onClick={() => void savePeriods()} disabled={!dirty || errorCount > 0 || loading}>
              {loading ? 'Saving…' : dirty ? 'Save and recalculate' : 'Saved'}
            </button>
          </>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        className="hidden"
        onChange={(e) => void onFileSelected(e.target.files?.[0])}
      />

      {importError && <Banner tone="negative" title="Import failed" onDismiss={() => setImportError(null)}>{importError}</Banner>}
      {errorCount > 0 && (
        <Banner tone="negative" title={`${errorCount} ${errorCount === 1 ? 'cell could' : 'cells could'} not be read`}>
          {Object.entries(cellErrors).slice(0, 4).map(([key, message]) => <span key={key} className="block">{key.replace(':', ' · ')}: {message}</span>)}
        </Banner>
      )}

      {importResult && (
        <Banner tone={importResult.warnings.length ? 'caution' : 'positive'} title="Import complete" onDismiss={() => setImportResult(null)}>
          <span className="block">
            Imported {importResult.summary.fieldsImported} fields across {importResult.summary.periodsCreated} periods.
            {importResult.summary.rowsSkipped > 0 && ` ${importResult.summary.rowsSkipped} rows were skipped because no field was selected for them.`}
          </span>
          {importResult.warnings.slice(0, 5).map((w, i) => <span key={i} className="mt-1 block">• {w.message}</span>)}
        </Banner>
      )}

      {periods.length === 0 ? (
        <EmptyState
          title="No financial years yet"
          message="Add a year to start entering data, or import a spreadsheet. At least two years are needed before growth rates, trends and average-balance ratios can be calculated."
          action={
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={addPeriod}>Add a financial year</button>
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>Import Excel</button>
            </div>
          }
        />
      ) : (
        <>
          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-3 py-2 dark:border-ink-800">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Statement">
                {statements.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={statement === s.key}
                    onClick={() => setStatement(s.key as StatementKey)}
                    className={`rounded px-2.5 py-1 text-[12.5px] transition-colors ${
                      statement === s.key ? 'bg-accent-700 font-medium text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-2xs text-ink-500 dark:text-ink-400">
                <span className="flex items-center gap-1"><SourceDot source="entered" /> entered</span>
                <span className="flex items-center gap-1"><SourceDot source="calculated" /> calculated</span>
                <button type="button" className="btn-secondary" onClick={addPeriod}>Add year</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="text-left" style={{ minWidth: 300 }}>Line item</th>
                    {periods.map((period) => (
                      <th key={period.label} style={{ minWidth: 130 }}>
                        <div className="flex flex-col items-end gap-0.5">
                          <input
                            className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-2xs font-semibold uppercase tracking-wider hover:border-ink-300 focus:border-accent-400 focus:outline-none"
                            defaultValue={period.label}
                            onBlur={(e) => renamePeriod(period.label, e.target.value)}
                            aria-label={`Rename ${period.label}`}
                          />
                          <span className="flex gap-1 text-[9px] font-normal normal-case tracking-normal">
                            <button type="button" className="text-accent-600 hover:underline" onClick={() => copyPrevious(period.label)} title="Copy values from the previous year">copy</button>
                            <button type="button" className="text-ink-500 hover:underline" onClick={() => clearPeriod(period.label)} title="Clear all values for this year">clear</button>
                            <button type="button" className="text-negative-600 hover:underline" onClick={() => removePeriod(period.label)} title="Remove this year">remove</button>
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item: LineItemDef) => {
                    const rows = [];
                    if (item.section !== section) {
                      section = item.section;
                      rows.push(
                        <tr key={`section-${item.section}`} className="row-section">
                          <td colSpan={periods.length + 1}>{item.section}</td>
                        </tr>,
                      );
                    }
                    rows.push(
                      <tr key={item.key} className={item.derivable ? 'row-total' : undefined}>
                        <th title={item.description}>
                          <span className="flex items-center gap-1.5">
                            {item.label}
                            {item.derivable && <Badge tone="neutral">derived if blank</Badge>}
                          </span>
                        </th>
                        {periods.map((period) => {
                          const analysed = analysis?.statements.find((p) => p.label === period.label);
                          const entered = period.values[item.key];
                          const derived = analysed && typeof analysed.values[item.key] === 'number' && analysed.sources[item.key] === 'calculated';
                          const errorKey = `${period.label}:${item.key}`;
                          return (
                            <td key={period.label} className="p-0">
                              <div className="relative">
                                <input
                                  className={`cell-input ${derived && typeof entered !== 'number' ? 'pr-4' : ''} ${
                                    cellErrors[errorKey] ? 'border-negative-400 bg-negative-50' : ''
                                  }`}
                                  defaultValue={typeof entered === 'number' ? String(entered) : ''}
                                  placeholder={derived ? formatCurrency(analysed!.values[item.key] as number, ctx) : ''}
                                  onBlur={(e) => updateCell(period.label, item.key, e.target.value)}
                                  inputMode="decimal"
                                  aria-label={`${item.label} for ${period.label}`}
                                  title={
                                    derived
                                      ? `Calculated by the engine as ${formatCurrency(analysed!.values[item.key] as number, ctx)}. Enter a value to override it.`
                                      : undefined
                                  }
                                />
                                {derived && typeof entered !== 'number' && (
                                  <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2"><SourceDot source="calculated" /></span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>,
                    );
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {analysis && <DataQualityPanel analysis={analysis} />}
        </>
      )}

      {/* Mapping review */}
      <Modal open={importState !== null} title={`Review import — ${importState?.fileName ?? ''}`} onClose={() => setImportState(null)} wide>
        {importState && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-[12.5px] md:grid-cols-5">
              {[
                { label: 'Rows read', value: importState.summary.rowsRead },
                { label: 'Fields detected', value: importState.summary.fieldsDetected },
                { label: 'Mapped', value: importState.summary.mapped },
                { label: 'Need confirmation', value: unresolved },
                { label: 'Warnings', value: importState.summary.warnings },
              ].map((stat) => (
                <div key={stat.label} className="rounded border border-ink-200 px-2.5 py-1.5 dark:border-ink-800">
                  <p className="label-caps">{stat.label}</p>
                  <p className="tnum text-base font-semibold">{stat.value}</p>
                </div>
              ))}
            </div>

            {importState.warnings.length > 0 && (
              <Banner tone="caution" title={`${importState.warnings.length} warnings while reading the file`}>
                {importState.warnings.slice(0, 6).map((w, i) => <span key={i} className="block">• {w.message}</span>)}
              </Banner>
            )}

            {unresolved > 0 && (
              <Banner tone="accent" title={`${unresolved} rows need your confirmation`}>
                These rows resemble a known field but not closely enough to map automatically. Choose a field or leave them
                unmapped — nothing uncertain is imported without your decision.
              </Banner>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Periods to import" hint="Deselect any year you do not want.">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {importState.periods.map((p) => (
                    <label key={p.label} className="flex items-center gap-1.5 rounded border border-ink-300 px-2 py-1 text-[12px] dark:border-ink-700">
                      <input
                        type="checkbox"
                        checked={importPeriods.includes(p.label)}
                        onChange={(e) =>
                          setImportPeriods((prev) => (e.target.checked ? [...prev, p.label] : prev.filter((x) => x !== p.label)))
                        }
                      />
                      {p.label}
                      <span className="text-ink-400">({p.header})</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Import mode" hint="Replace discards existing periods. Merge overlays imported values onto matching years.">
                <select className="input" value={importMode} onChange={(e) => setImportMode(e.target.value as 'replace' | 'merge')}>
                  <option value="replace">Replace all existing periods</option>
                  <option value="merge">Merge into existing periods</option>
                </select>
              </Field>
            </div>

            <div className="max-h-96 overflow-auto rounded border border-ink-200 dark:border-ink-800">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="text-left">Sheet field</th>
                    <th className="text-left" style={{ minWidth: 230 }}>Maps to</th>
                    <th>Confidence</th>
                    <th className="text-left">Why</th>
                    <th className="text-right">Sample value</th>
                  </tr>
                </thead>
                <tbody>
                  {importState.mappings.map((mapping) => {
                    const top = mapping.suggestions[0];
                    const chosen = importDecisions[mapping.rowKey] ?? '';
                    const firstPeriod = importPeriods[0] ?? importState.periods[0]?.label;
                    const preview = firstPeriod ? mapping.preview[firstPeriod] : null;
                    if (mapping.isSectionHeader) {
                      return (
                        <tr key={mapping.rowKey} className="row-section">
                          <td colSpan={5}>{mapping.sourceLabel} — treated as a section heading</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={mapping.rowKey}>
                        <th>
                          {mapping.sourceLabel}
                          <span className="ml-1 text-2xs font-normal text-ink-400">{mapping.sheet} row {mapping.sourceRow}</span>
                        </th>
                        <td className="text-left">
                          <select
                            className="input py-1"
                            style={{ minWidth: 210 }}
                            value={chosen}
                            onChange={(e) => setImportDecisions((prev) => ({ ...prev, [mapping.rowKey]: e.target.value || null }))}
                          >
                            <option value="">— do not import —</option>
                            {meta?.lineItems.map((item) => (
                              <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {top ? (
                            <Badge tone={top.confidence >= 80 ? 'positive' : top.confidence >= 60 ? 'caution' : 'neutral'}>
                              {top.confidence}%
                            </Badge>
                          ) : (
                            <span className="text-2xs text-ink-400">no match</span>
                          )}
                        </td>
                        <td className="max-w-xs whitespace-normal text-left text-2xs text-ink-500 dark:text-ink-400">
                          {top?.reason ?? 'No recognised financial term resembles this label.'}
                        </td>
                        <td className="tnum text-ink-600 dark:text-ink-300">
                          {typeof preview === 'number' ? formatCurrency(preview, ctx) : 'n/a'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-ink-200 pt-3 dark:border-ink-800">
              <p className="text-2xs text-ink-500 dark:text-ink-400">
                Detected company: {importState.detectedCompany.name ?? 'not found in the file'}
                {importState.detectedCompany.units ? ` · units ${importState.detectedCompany.units}` : ''}
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setImportState(null)} disabled={importBusy}>Cancel</button>
                <button type="button" className="btn-primary" onClick={() => void applyImport()} disabled={importBusy || importPeriods.length === 0}>
                  {importBusy ? 'Importing…' : `Import ${importPeriods.length} periods`}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {importBusy && !importState && <Spinner label="Working" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DataQualityPanel({ analysis }: { analysis: NonNullable<ReturnType<typeof useWorkspace>['analysis']> }) {
  const [showAll, setShowAll] = useState(false);
  const { dataQuality } = analysis;
  const ordered = [...dataQuality.checks].sort((a, b) => {
    const rank = { fail: 0, warn: 1, skipped: 2, pass: 3 } as const;
    return rank[a.status] - rank[b.status];
  });
  const visible = showAll ? ordered : ordered.slice(0, 10);

  const statusTone = { pass: 'positive', warn: 'caution', fail: 'negative', skipped: 'neutral' } as const;
  const statusIcon = { pass: '✓', warn: '⚠', fail: '✕', skipped: '·' } as const;

  return (
    <Card
      title="Data quality"
      description={`${dataQuality.passed} passed · ${dataQuality.warnings} warnings · ${dataQuality.failures} failures · ${dataQuality.skipped} skipped for lack of data. Core data completeness ${dataQuality.completeness}%.`}
      actions={
        dataQuality.checks.length > 10 ? (
          <button type="button" className="btn-ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${dataQuality.checks.length}`}
          </button>
        ) : undefined
      }
      padded={false}
    >
      <ul className="divide-y divide-ink-100 dark:divide-ink-800/60">
        {visible.map((check) => (
          <li key={check.id} className="flex gap-3 px-4 py-2">
            <Badge tone={statusTone[check.status]}>{statusIcon[check.status]}</Badge>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink-800 dark:text-ink-200">{check.label}</p>
              <p className="text-[12px] leading-relaxed text-ink-600 dark:text-ink-400">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
