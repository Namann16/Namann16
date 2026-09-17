import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnalysisResult, FinancialPeriod, PeerCompany } from '@fca/core';
import { api, ApiError, type AppMeta, type CompanySummary, type StoredCompany } from '../api/client';

/**
 * Workspace state.
 *
 * Holds the company currently open, its raw data, and the analysis the server computed from it.
 * The analysis is never mutated here and is never computed in the browser: the client displays
 * what the engine produced, so there is exactly one implementation of every formula.
 */

export type Theme = 'light' | 'dark' | 'system';

interface WorkspaceState {
  meta: AppMeta | null;
  metaError: string | null;
  companies: CompanySummary[];
  current: StoredCompany | null;
  analysis: AnalysisResult | null;
  loading: boolean;
  analysing: boolean;
  error: string | null;
  /** True when the local data has edits that have not been saved to the server. */
  dirty: boolean;
  /** True while the initial connection to the API is in flight. */
  connecting: boolean;
  theme: Theme;
}

interface WorkspaceActions {
  /** Re-attempt the initial connection to the API. */
  retryConnection: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  openCompany: (id: string) => Promise<void>;
  closeCompany: () => void;
  createCompany: (profile: Record<string, unknown>) => Promise<StoredCompany>;
  loadSample: () => Promise<StoredCompany>;
  deleteCompany: (id: string) => Promise<void>;
  updateProfile: (patch: Record<string, unknown>) => Promise<void>;
  setPeriodsLocal: (periods: FinancialPeriod[]) => void;
  savePeriods: (periods?: FinancialPeriod[]) => Promise<void>;
  savePeers: (peers: PeerCompany[]) => Promise<void>;
  saveThresholds: (thresholds: Record<string, number>) => Promise<void>;
  reanalyse: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  clearError: () => void;
}

const WorkspaceContext = createContext<(WorkspaceState & WorkspaceActions) | null>(null);

const LAST_COMPANY_KEY = 'fca.lastCompanyId';
const THEME_KEY = 'fca.theme';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch { /* storage unavailable */ }
  return 'system';
}

function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.issues?.length) {
      return `${error.message} ${error.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [current, setCurrent] = useState<StoredCompany | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  }, []);

  const refreshCompanies = useCallback(async () => {
    try {
      const { companies: list } = await api.listCompanies();
      setCompanies(list);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const loadAnalysis = useCallback(async (id: string) => {
    setAnalysing(true);
    try {
      const { analysis: result } = await api.analysis(id);
      setAnalysis(result);
      setDirty(false);
    } catch (e) {
      setError(describe(e));
      setAnalysis(null);
    } finally {
      setAnalysing(false);
    }
  }, []);

  const openCompany = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { company } = await api.getCompany(id);
      setCurrent(company);
      try { localStorage.setItem(LAST_COMPANY_KEY, id); } catch { /* storage unavailable */ }
      await loadAnalysis(id);
    } catch (e) {
      setError(describe(e));
      setCurrent(null);
      setAnalysis(null);
      try { localStorage.removeItem(LAST_COMPANY_KEY); } catch { /* storage unavailable */ }
    } finally {
      setLoading(false);
    }
  }, [loadAnalysis]);

  const [connecting, setConnecting] = useState(false);

  /** Load metadata, the company list, and reopen whatever was last in view. */
  const bootstrap = useCallback(async () => {
    setConnecting(true);
    setMetaError(null);
    try {
      const loaded = await api.meta();
      setMeta(loaded);
    } catch (e) {
      setMetaError(describe(e));
      return;
    } finally {
      setConnecting(false);
    }
    await refreshCompanies();
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_COMPANY_KEY); } catch { /* storage unavailable */ }
    if (last) await openCompany(last);
  }, [refreshCompanies, openCompany]);

  useEffect(() => {
    void bootstrap();
    // Bootstrap runs once on mount; the retry button calls it again on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeCompany = useCallback(() => {
    setCurrent(null);
    setAnalysis(null);
    setDirty(false);
    try { localStorage.removeItem(LAST_COMPANY_KEY); } catch { /* storage unavailable */ }
  }, []);

  const createCompany = useCallback(async (profile: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const { company } = await api.createCompany(profile as never);
      setCurrent(company);
      try { localStorage.setItem(LAST_COMPANY_KEY, company.id); } catch { /* storage unavailable */ }
      await refreshCompanies();
      await loadAnalysis(company.id);
      return company;
    } catch (e) {
      setError(describe(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [refreshCompanies, loadAnalysis]);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { company } = await api.createSample();
      setCurrent(company);
      try { localStorage.setItem(LAST_COMPANY_KEY, company.id); } catch { /* storage unavailable */ }
      await refreshCompanies();
      await loadAnalysis(company.id);
      return company;
    } catch (e) {
      setError(describe(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [refreshCompanies, loadAnalysis]);

  const deleteCompany = useCallback(async (id: string) => {
    try {
      await api.deleteCompany(id);
      if (current?.id === id) closeCompany();
      await refreshCompanies();
    } catch (e) {
      setError(describe(e));
    }
  }, [current?.id, closeCompany, refreshCompanies]);

  const updateProfile = useCallback(async (patch: Record<string, unknown>) => {
    if (!current) return;
    try {
      const { company } = await api.updateCompany(current.id, patch);
      setCurrent(company);
      await refreshCompanies();
      await loadAnalysis(company.id);
    } catch (e) {
      setError(describe(e));
    }
  }, [current, refreshCompanies, loadAnalysis]);

  /** Update the grid without a round trip. The user saves explicitly. */
  const setPeriodsLocal = useCallback((periods: FinancialPeriod[]) => {
    setCurrent((prev) => (prev ? { ...prev, periods } : prev));
    setDirty(true);
  }, []);

  const savePeriods = useCallback(async (periods?: FinancialPeriod[]) => {
    if (!current) return;
    const payload = periods ?? current.periods;
    setLoading(true);
    try {
      const { company } = await api.savePeriods(current.id, payload);
      setCurrent(company);
      setDirty(false);
      await refreshCompanies();
      await loadAnalysis(company.id);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, [current, refreshCompanies, loadAnalysis]);

  const savePeers = useCallback(async (peers: PeerCompany[]) => {
    if (!current) return;
    try {
      const { company } = await api.savePeers(current.id, peers);
      setCurrent(company);
      await loadAnalysis(company.id);
    } catch (e) {
      setError(describe(e));
    }
  }, [current, loadAnalysis]);

  const saveThresholds = useCallback(async (thresholds: Record<string, number>) => {
    if (!current) return;
    try {
      const { company } = await api.updateCompany(current.id, { thresholds });
      setCurrent(company);
      await loadAnalysis(company.id);
    } catch (e) {
      setError(describe(e));
    }
  }, [current, loadAnalysis]);

  const reanalyse = useCallback(async () => {
    if (current) await loadAnalysis(current.id);
  }, [current, loadAnalysis]);

  const value = useMemo(
    () => ({
      meta, metaError, companies, current, analysis, loading, analysing, error, dirty, theme, connecting, retryConnection: bootstrap,
      refreshCompanies, openCompany, closeCompany, createCompany, loadSample, deleteCompany,
      updateProfile, setPeriodsLocal, savePeriods, savePeers, saveThresholds, reanalyse,
      setTheme, clearError: () => setError(null),
    }),
    [
      meta, metaError, companies, current, analysis, loading, analysing, error, dirty, theme, connecting, bootstrap,
      refreshCompanies, openCompany, closeCompany, createCompany, loadSample, deleteCompany,
      updateProfile, setPeriodsLocal, savePeriods, savePeers, saveThresholds, reanalyse, setTheme,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside a WorkspaceProvider.');
  return context;
}
