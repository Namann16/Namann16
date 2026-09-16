import type {
  AnalysisResult,
  CompanyProfile,
  FinancialPeriod,
  IndustryKey,
  LineItemDef,
  MetricGroup,
  PeerCompany,
  ThresholdConfig,
} from '@fca/core';

/**
 * API access layer.
 *
 * By default the client calls /api on its own origin: in development the Vite proxy forwards it
 * to the server, and in a normal deployment the API is served behind the same host. Nothing about
 * the API location is then compiled into the bundle.
 *
 * VITE_API_BASE_URL is only needed when the API genuinely lives on a different origin, and that
 * origin must be listed in the server's CORS_ORIGIN. No secret is ever read here.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      'Could not reach the analysis server. Check that the API is running and try again.',
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(error.message ?? `Request failed with status ${response.status}.`, response.status, error.issues);
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Types shared with the server                                       */
/* ------------------------------------------------------------------ */

export interface CompanySummary {
  id: string;
  name: string;
  industry: string;
  currency: string;
  units: string;
  periodCount: number;
  latestPeriod: string | null;
  isSample: boolean;
  updatedAt: string;
}

export interface StoredCompany {
  id: string;
  company: CompanyProfile;
  periods: FinancialPeriod[];
  peers: PeerCompany[];
  thresholds: Partial<ThresholdConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface MetricMeta {
  key: string;
  label: string;
  group: MetricGroup;
  unit: string;
  formula: string;
  meaning: string;
  higherIsBetter: boolean | null;
}

export interface IndustryMeta {
  key: IndustryKey;
  label: string;
  note: string;
  overrides: Partial<ThresholdConfig>;
  suppressedMetrics: string[];
}

export interface AppMeta {
  config: { hasDatabase: boolean; llmEnabled: boolean; maxUploadBytes: number; environment: string; storage: 'mongodb' | 'memory' };
  statements: { key: string; label: string }[];
  lineItems: LineItemDef[];
  metricGroups: Record<MetricGroup, string>;
  metrics: MetricMeta[];
  industries: IndustryMeta[];
  thresholds: { defaults: ThresholdConfig; descriptions: Record<string, string> };
  rules: { id: string; kind: 'red_flag' | 'positive_signal'; description: string }[];
}

export interface MappingSuggestion {
  targetKey: string;
  targetLabel: string;
  confidence: number;
  reason: string;
}

export interface MappingCandidate {
  rowKey: string;
  sourceLabel: string;
  sourceRow: number;
  sheet: string;
  suggestions: MappingSuggestion[];
  selected: string | null;
  requiresConfirmation: boolean;
  isSectionHeader: boolean;
  preview: Record<string, number | null>;
}

export interface ParseResponse {
  importId: string;
  fileName: string;
  sheets: string[];
  detectedCompany: Partial<CompanyProfile>;
  periods: { label: string; header: string; sheet: string; column: number; year: number | null }[];
  mappings: MappingCandidate[];
  warnings: { level: 'warning' | 'error'; message: string; sheet?: string; row?: number }[];
  summary: {
    rowsRead: number; fieldsDetected: number; mapped: number; needsConfirmation: number;
    unmapped: number; periodsDetected: number; warnings: number; errors: number;
  };
}

export interface CommitResponse {
  periods: FinancialPeriod[];
  applied: { rowKey: string; label: string; target: string; periodsFilled: number }[];
  skipped: { rowKey: string; label: string; reason: string }[];
  warnings: { level: 'warning' | 'error'; message: string }[];
  detectedCompany: Partial<CompanyProfile>;
  company: StoredCompany | null;
  summary: { fieldsImported: number; rowsSkipped: number; periodsCreated: number; warnings: number };
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                          */
/* ------------------------------------------------------------------ */

export const api = {
  meta: () => request<AppMeta>('/meta'),

  listCompanies: () => request<{ companies: CompanySummary[]; storage: string }>('/companies'),

  getCompany: (id: string) => request<{ company: StoredCompany }>(`/companies/${id}`),

  createCompany: (body: Partial<CompanyProfile> & { periods?: FinancialPeriod[]; peers?: PeerCompany[] }) =>
    request<{ company: StoredCompany }>('/companies', { method: 'POST', body: JSON.stringify(body) }),

  createSample: () => request<{ company: StoredCompany }>('/companies/sample', { method: 'POST' }),

  updateCompany: (id: string, body: Record<string, unknown>) =>
    request<{ company: StoredCompany }>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  savePeriods: (id: string, periods: FinancialPeriod[]) =>
    request<{ company: StoredCompany }>(`/companies/${id}/periods`, { method: 'PUT', body: JSON.stringify({ periods }) }),

  savePeers: (id: string, peers: PeerCompany[]) =>
    request<{ company: StoredCompany }>(`/companies/${id}/peers`, { method: 'PUT', body: JSON.stringify({ peers }) }),

  deleteCompany: (id: string) => request<void>(`/companies/${id}`, { method: 'DELETE' }),

  analysis: (id: string) => request<{ analysis: AnalysisResult }>(`/companies/${id}/analysis`),

  analyzeAdHoc: (body: { company: Partial<CompanyProfile>; periods: FinancialPeriod[]; peers?: PeerCompany[]; thresholds?: Partial<ThresholdConfig> }) =>
    request<{ analysis: AnalysisResult }>('/analyze', { method: 'POST', body: JSON.stringify(body) }),

  parseUpload: (file: File, units?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (units) form.append('units', units);
    return request<ParseResponse>('/import/parse', { method: 'POST', body: form });
  },

  commitImport: (body: {
    importId: string;
    mappings: Record<string, string | null>;
    periods: string[];
    mode: 'replace' | 'merge';
    companyId?: string;
  }) => request<CommitResponse>('/import/commit', { method: 'POST', body: JSON.stringify(body) }),

  /** Direct file URLs, opened by the browser rather than fetched. */
  urls: {
    template: () => `${BASE}/api/import/template`,
    excel: (id: string) => `${BASE}/api/export/${id}/excel`,
    csv: (id: string, kind: 'statements' | 'metrics') => `${BASE}/api/export/${id}/csv?kind=${kind}`,
    report: (id: string) => `${BASE}/api/export/${id}/report`,
  },
};
