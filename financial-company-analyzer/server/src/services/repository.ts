import { createHash, randomUUID } from 'node:crypto';
import type { BusinessContext, CompanyDataset, CompanyProfile, FinancialPeriod, PeerCompany, ThresholdConfig } from '@fca/core';
import { AnalysisSnapshotModel, CompanyModel, UserSettingsModel } from '../models/Company.js';
import { isDatabaseConnected } from '../db/connect.js';

/**
 * Storage layer with two backends.
 *
 * When MongoDB is reachable, companies are persisted through Mongoose. When it is not, the same
 * interface is served from an in-memory store so the application remains fully functional for
 * evaluation. The caller never needs to know which is in use; `storageMode()` reports it so the
 * UI can tell the user their data will not survive a restart.
 */

export interface StoredCompany extends CompanyDataset {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const memory = new Map<string, StoredCompany>();

export function storageMode(): 'mongodb' | 'memory' {
  return isDatabaseConnected() ? 'mongodb' : 'memory';
}

/**
 * Mongoose returns schema maps as `Map` instances from a document and as plain objects from
 * `.lean()`, so both shapes have to be handled. Exported for testing: this conversion is the
 * seam where a persisted analysis could silently lose line items.
 */
export function mapToObject<T>(value: unknown): Record<string, T> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, T>;
  if (typeof value === 'object') return { ...(value as Record<string, T>) };
  return {};
}

/** Convert a persisted document into the shape the engine consumes. Exported for testing. */
export function fromDocument(doc: any): StoredCompany {
  const company: CompanyProfile = {
    id: String(doc._id),
    name: doc.name,
    industry: doc.industry,
    sector: doc.sector ?? undefined,
    country: doc.country ?? undefined,
    currency: doc.currency,
    currencyLabel: doc.currencyLabel ?? undefined,
    fiscalYearEnd: doc.fiscalYearEnd ?? undefined,
    reportingPeriod: doc.reportingPeriod ?? 'annual',
    annualizeInterimMetrics: Boolean(doc.annualizeInterimMetrics),
    units: doc.units,
    ticker: doc.ticker ?? null,
    benchmark: doc.benchmark ?? null,
    marketCap: doc.marketCap ?? null,
    sharePrice: doc.sharePrice ?? null,
    sharesOutstanding: doc.sharesOutstanding ?? null,
    notes: doc.notes ?? undefined,
    isSample: Boolean(doc.isSample),
    ...(doc.metricConfig ? { metricConfig: doc.metricConfig } : {}),
    ...(doc.sectorProfile ? { sectorProfile: doc.sectorProfile } : {}),
    ...(doc.companyStage ? { companyStage: doc.companyStage } : {}),
  };

  const periods: FinancialPeriod[] = (doc.periods ?? []).map((p: any) => ({
    label: p.label,
    endDate: p.endDate ?? null,
    order: p.order,
    isPartial: Boolean(p.isPartial),
    ...(p.unusual ? { unusual: true } : {}),
    ...(p.unusualReason ? { unusualReason: p.unusualReason } : {}),
    values: mapToObject<number | null>(p.values),
    sources: mapToObject<'entered' | 'calculated'>(p.sources),
  }));

  const peers: PeerCompany[] = (doc.peers ?? []).map((p: any) => ({
    name: p.name,
    source: p.source ?? undefined,
    metrics: mapToObject<number | null>(p.metrics),
  }));

  return {
    id: String(doc._id),
    company,
    periods,
    peers,
    thresholds: mapToObject<number>(doc.thresholds) as Partial<ThresholdConfig>,
    ...(doc.businessContext ? { businessContext: doc.businessContext } : {}),
    createdAt: doc.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

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

function toSummary(entry: StoredCompany): CompanySummary {
  const sorted = [...entry.periods].sort((a, b) => a.order - b.order);
  return {
    id: entry.id,
    name: entry.company.name,
    industry: entry.company.industry,
    currency: entry.company.currency,
    units: entry.company.units,
    periodCount: entry.periods.length,
    latestPeriod: sorted.length ? sorted[sorted.length - 1]!.label : null,
    isSample: Boolean(entry.company.isSample),
    updatedAt: entry.updatedAt,
  };
}

export async function listCompanies(): Promise<CompanySummary[]> {
  if (storageMode() === 'mongodb') {
    const docs = await CompanyModel.find().sort({ updatedAt: -1 }).limit(200).lean();
    return docs.map((d: any) => toSummary(fromDocument(d)));
  }
  return [...memory.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function getCompany(id: string): Promise<StoredCompany | null> {
  if (storageMode() === 'mongodb' && !id.startsWith('mem_')) {
    const doc = await CompanyModel.findById(id).lean().catch(() => null);
    return doc ? fromDocument(doc) : null;
  }
  return memory.get(id) ?? null;
}

export interface UpsertInput {
  company: CompanyProfile;
  periods?: FinancialPeriod[];
  peers?: PeerCompany[];
  thresholds?: Partial<ThresholdConfig>;
  businessContext?: BusinessContext;
}

export async function createCompany(input: UpsertInput): Promise<StoredCompany> {
  const defaultSettings = await getUserSettings();
  const thresholds = input.thresholds ?? defaultSettings.thresholds;
  if (storageMode() === 'mongodb') {
    const doc = await CompanyModel.create({
      ...input.company,
      periods: input.periods ?? [],
      peers: input.peers ?? [],
      thresholds,
      ...(input.businessContext ? { businessContext: input.businessContext } : {}),
    });
    return fromDocument(doc.toObject());
  }

  const now = new Date().toISOString();
  const id = `mem_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const entry: StoredCompany = {
    id,
    company: { ...input.company, id },
    periods: input.periods ?? [],
    peers: input.peers ?? [],
    thresholds,
    ...(input.businessContext ? { businessContext: input.businessContext } : {}),
    createdAt: now,
    updatedAt: now,
  };
  memory.set(id, entry);
  return entry;
}

export async function updateCompany(id: string, input: Partial<UpsertInput>): Promise<StoredCompany | null> {
  if (storageMode() === 'mongodb' && !id.startsWith('mem_')) {
    const update: Record<string, unknown> = {};
    if (input.company) Object.assign(update, input.company);
    if (input.periods) update['periods'] = input.periods;
    if (input.peers) update['peers'] = input.peers;
    if (input.thresholds) update['thresholds'] = input.thresholds;
    if (input.businessContext) update['businessContext'] = input.businessContext;
    delete update['id'];

    const doc = await CompanyModel.findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .lean()
      .catch(() => null);
    return doc ? fromDocument(doc) : null;
  }

  const existing = memory.get(id);
  if (!existing) return null;
  const updated: StoredCompany = {
    ...existing,
    company: { ...existing.company, ...(input.company ?? {}), id },
    periods: input.periods ?? existing.periods,
    peers: input.peers ?? existing.peers,
    thresholds: input.thresholds ?? existing.thresholds,
    businessContext: input.businessContext ?? existing.businessContext,
    updatedAt: new Date().toISOString(),
  };
  memory.set(id, updated);
  return updated;
}

export async function deleteCompany(id: string): Promise<boolean> {
  if (storageMode() === 'mongodb' && !id.startsWith('mem_')) {
    const result = await CompanyModel.findByIdAndDelete(id).catch(() => null);
    return Boolean(result);
  }
  return memory.delete(id);
}

export async function companyCount(): Promise<number> {
  if (storageMode() === 'mongodb') return CompanyModel.countDocuments();
  return memory.size;
}

/** Convert a stored record into the shape the engine consumes. */
export function toDataset(entry: StoredCompany): CompanyDataset {
  return {
    company: entry.company,
    periods: entry.periods,
    peers: entry.peers,
    thresholds: entry.thresholds,
    businessContext: entry.businessContext,
  };
}

export interface UserSettings {
  key: string;
  theme: 'light' | 'dark' | 'system';
  defaultCurrency: string;
  defaultUnits: string;
  defaultIndustry: string;
  thresholds: Partial<ThresholdConfig>;
  llmNarrativeEnabled: boolean;
}

const memorySettings: UserSettings = {
  key: 'default',
  theme: 'system',
  defaultCurrency: 'INR',
  defaultUnits: 'crores',
  defaultIndustry: 'general',
  thresholds: {},
  llmNarrativeEnabled: false,
};

const memorySnapshots = new Map<string, { summary: SnapshotSummary; payload: any; fingerprint: string }>();
const MAX_SNAPSHOTS_PER_COMPANY = 20;

function fromSettingsDocument(doc: any): UserSettings {
  return {
    key: doc.key ?? 'default',
    theme: doc.theme ?? 'system',
    defaultCurrency: doc.defaultCurrency ?? 'INR',
    defaultUnits: doc.defaultUnits ?? 'crores',
    defaultIndustry: doc.defaultIndustry ?? 'general',
    thresholds: mapToObject<number>(doc.thresholds) as Partial<ThresholdConfig>,
    llmNarrativeEnabled: Boolean(doc.llmNarrativeEnabled),
  };
}

export async function getUserSettings(): Promise<UserSettings> {
  if (storageMode() === 'mongodb') {
    const doc = await UserSettingsModel.findOne({ key: 'default' }).lean();
    return doc ? fromSettingsDocument(doc) : memorySettings;
  }
  return memorySettings;
}

export async function updateUserSettings(input: Partial<UserSettings>): Promise<UserSettings> {
  const next = { ...memorySettings, ...input, key: 'default' };
  if (storageMode() === 'mongodb') {
    const doc = await UserSettingsModel.findOneAndUpdate(
      { key: 'default' },
      { $set: next },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();
    return fromSettingsDocument(doc);
  }
  Object.assign(memorySettings, next);
  return memorySettings;
}

export interface SnapshotSummary {
  id: string;
  companyId: string;
  engineVersion: string;
  generatedAt: string;
  latestPeriod: string | null;
  healthScore: number | null;
  healthLabel: string | null;
  redFlagCount: number;
}

function snapshotSummary(doc: any): SnapshotSummary {
  return {
    id: String(doc._id),
    companyId: String(doc.company),
    engineVersion: doc.engineVersion,
    generatedAt: doc.generatedAt?.toISOString?.() ?? new Date().toISOString(),
    latestPeriod: doc.latestPeriod ?? null,
    healthScore: doc.healthScore ?? null,
    healthLabel: doc.healthLabel ?? null,
    redFlagCount: doc.redFlagCount ?? 0,
  };
}

export async function createAnalysisSnapshot(companyId: string, analysis: any): Promise<SnapshotSummary> {
  const payload = JSON.parse(JSON.stringify(analysis));
  const fingerprint = createHash('sha256').update(JSON.stringify({
    engineVersion: analysis.engineVersion,
    latestPeriod: analysis.latestPeriod,
    health: analysis.health,
    redFlags: analysis.redFlags,
    metrics: analysis.metrics,
  })).digest('hex');
  if (storageMode() === 'mongodb') {
    const existing = await AnalysisSnapshotModel.findOne({ company: companyId, fingerprint }).lean();
    if (existing) return snapshotSummary(existing);
    const doc = await AnalysisSnapshotModel.create({
      company: companyId,
      engineVersion: analysis.engineVersion,
      generatedAt: new Date(),
      latestPeriod: analysis.latestPeriod,
      healthScore: analysis.health.overall,
      healthLabel: analysis.health.label,
      redFlagCount: analysis.redFlags.length,
      fingerprint,
      payload,
    });
    const old = await AnalysisSnapshotModel.find({ company: companyId })
      .sort({ generatedAt: -1 }).skip(MAX_SNAPSHOTS_PER_COMPANY).select({ _id: 1 }).lean();
    if (old.length) await AnalysisSnapshotModel.deleteMany({ _id: { $in: old.map((entry) => entry._id) } });
    return snapshotSummary(doc.toObject());
  }
  const existing = [...memorySnapshots.values()].find((entry) => entry.summary.companyId === companyId && entry.fingerprint === fingerprint);
  if (existing) return existing.summary;
  const summary = {
    id: `mem_snapshot_${randomUUID().slice(0, 12)}`,
    companyId,
    engineVersion: analysis.engineVersion,
    generatedAt: new Date().toISOString(),
    latestPeriod: analysis.latestPeriod,
    healthScore: analysis.health.overall,
    healthLabel: analysis.health.label,
    redFlagCount: analysis.redFlags.length,
  };
  memorySnapshots.set(summary.id, { summary, payload, fingerprint });
  const companySnapshots = [...memorySnapshots.values()]
    .filter((entry) => entry.summary.companyId === companyId)
    .sort((a, b) => b.summary.generatedAt.localeCompare(a.summary.generatedAt));
  companySnapshots.slice(MAX_SNAPSHOTS_PER_COMPANY).forEach((entry) => memorySnapshots.delete(entry.summary.id));
  return summary;
}

export async function listAnalysisSnapshots(companyId: string): Promise<SnapshotSummary[]> {
  if (storageMode() === 'mongodb') {
    const docs = await AnalysisSnapshotModel.find({ company: companyId }).sort({ generatedAt: -1 }).limit(100).lean();
    return docs.map(snapshotSummary);
  }
  return [...memorySnapshots.values()]
    .filter((entry) => entry.summary.companyId === companyId)
    .sort((a, b) => b.summary.generatedAt.localeCompare(a.summary.generatedAt))
    .map((entry) => entry.summary);
}

export async function getAnalysisSnapshot(companyId: string, snapshotId: string): Promise<any | null> {
  if (storageMode() !== 'mongodb') {
    const entry = memorySnapshots.get(snapshotId);
    return entry?.summary.companyId === companyId ? entry.payload : null;
  }
  const doc = await AnalysisSnapshotModel.findOne({ _id: snapshotId, company: companyId }).lean();
  return doc?.payload ?? null;
}
