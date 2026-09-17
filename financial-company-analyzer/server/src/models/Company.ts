import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { LINE_ITEM_KEYS } from '@fca/core';

/**
 * Persistence model.
 *
 * A Company owns its financial periods, peers and threshold overrides. Calculated metrics are
 * NOT stored as the source of truth — they are recomputed by the engine from the raw data on
 * every request, so a change to a formula can never leave stale numbers behind. A snapshot of
 * the last analysis is cached separately for reporting and audit.
 */

/** One financial year of raw line items, with provenance for each value. */
const FinancialPeriodSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 32 },
    endDate: { type: String, default: null },
    order: { type: Number, required: true },
    isPartial: { type: Boolean, default: false },
    // Stored as a free-form map keyed by canonical line-item key so new line items can be
    // added to the registry without a schema migration.
    values: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    sources: { type: Map, of: String, default: () => new Map() },
  },
  { _id: false },
);

const PeerCompanySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    source: { type: String, default: null, maxlength: 200 },
    metrics: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
  },
  { _id: false },
);

const CompanySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    industry: { type: String, required: true, default: 'general' },
    sector: { type: String, default: null, maxlength: 120 },
    country: { type: String, default: null, maxlength: 80 },
    currency: { type: String, required: true, default: 'INR' },
    currencyLabel: { type: String, default: null, maxlength: 20 },
    fiscalYearEnd: { type: String, default: null, maxlength: 40 },
    reportingPeriod: { type: String, enum: ['annual', 'half_yearly', 'quarterly'], default: 'annual' },
    annualizeInterimMetrics: { type: Boolean, default: false },
    units: { type: String, required: true, default: 'units' },
    ticker: { type: String, default: null, maxlength: 20 },
    benchmark: { type: String, default: null, maxlength: 80 },
    marketCap: { type: Number, default: null },
    sharePrice: { type: Number, default: null },
    sharesOutstanding: { type: Number, default: null },
    notes: { type: String, default: null, maxlength: 2000 },
    isSample: { type: Boolean, default: false },

    periods: { type: [FinancialPeriodSchema], default: [] },
    peers: { type: [PeerCompanySchema], default: [] },
    /** Per-company overrides layered on top of the engine and industry defaults. */
    thresholds: { type: Map, of: Number, default: () => new Map() },
  },
  { timestamps: true, versionKey: false },
);

CompanySchema.index({ name: 1, createdAt: -1 });

export type CompanyDocument = InferSchemaType<typeof CompanySchema>;

// Guard against re-registration under a dev-server hot reload, and pin the type so callers get
// a single Model signature rather than a union of every overload.
export const CompanyModel: mongoose.Model<CompanyDocument> =
  (mongoose.models.Company as mongoose.Model<CompanyDocument>) ??
  mongoose.model<CompanyDocument>('Company', CompanySchema);

/**
 * Cached analysis snapshot.
 *
 * Kept for report history and traceability. It records the engine version that produced it so a
 * stale snapshot is never mistaken for a current one.
 */
const AnalysisSnapshotSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    engineVersion: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
    latestPeriod: { type: String, default: null },
    healthScore: { type: Number, default: null },
    healthLabel: { type: String, default: null },
    redFlagCount: { type: Number, default: 0 },
    fingerprint: { type: String, required: true, index: true },
    /** Full AnalysisResult, stored opaquely for report regeneration. */
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

type AnalysisSnapshotDocument = InferSchemaType<typeof AnalysisSnapshotSchema>;

export const AnalysisSnapshotModel: mongoose.Model<AnalysisSnapshotDocument> =
  (mongoose.models.AnalysisSnapshot as mongoose.Model<AnalysisSnapshotDocument>) ??
  mongoose.model<AnalysisSnapshotDocument>('AnalysisSnapshot', AnalysisSnapshotSchema);

/** Application-level settings, stored as a single document. */
const UserSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    defaultCurrency: { type: String, default: 'INR' },
    defaultUnits: { type: String, default: 'crores' },
    defaultIndustry: { type: String, default: 'general' },
    thresholds: { type: Map, of: Number, default: () => new Map() },
    llmNarrativeEnabled: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

type UserSettingsDocument = InferSchemaType<typeof UserSettingsSchema>;

export const UserSettingsModel: mongoose.Model<UserSettingsDocument> =
  (mongoose.models.UserSettings as mongoose.Model<UserSettingsDocument>) ??
  mongoose.model<UserSettingsDocument>('UserSettings', UserSettingsSchema);

/** Line-item keys accepted by the persistence layer, mirrored from the engine registry. */
export const PERSISTED_LINE_ITEM_KEYS = new Set(LINE_ITEM_KEYS);
