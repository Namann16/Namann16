import { z } from 'zod';
import { LINE_ITEM_KEYS, DEFAULT_THRESHOLDS, INDUSTRY_PROFILES } from '@fca/core';

/**
 * Server-side validation.
 *
 * Every request body is validated here before it reaches a model or the engine. Client-side
 * validation exists for usability only; this layer is the one that is trusted.
 */

const industryKeys = Object.keys(INDUSTRY_PROFILES) as [string, ...string[]];
const lineItemKeys = new Set(LINE_ITEM_KEYS);

/** A financial value: a finite number, or explicitly null meaning "not available". */
export const financialValue = z
  .union([z.number(), z.null()])
  .refine((v) => v === null || Number.isFinite(v), { message: 'Must be a finite number or null.' })
  .refine((v) => v === null || Math.abs(v) < 1e15, { message: 'Value is implausibly large — check the units.' });

/** Only keys in the canonical line-item registry are accepted; unknown keys are rejected, not ignored. */
export const valuesRecord = z
  .record(z.string(), financialValue)
  .superRefine((record, ctx) => {
    for (const key of Object.keys(record)) {
      if (!lineItemKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${key}" is not a recognised financial line item.`,
          path: [key],
        });
      }
    }
  });

export const periodSchema = z.object({
  label: z.string().trim().min(1, 'A period label is required.').max(32),
  endDate: z.string().max(40).nullable().optional(),
  order: z.number().int().min(0).max(100),
  isPartial: z.boolean().optional(),
  values: valuesRecord.default({}),
  sources: z.record(z.string(), z.enum(['entered', 'calculated'])).optional(),
});

export const peerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.string().max(200).nullable().optional(),
  metrics: z.record(z.string(), financialValue).default({}),
});

export const thresholdsSchema = z
  .record(z.string(), z.number().finite())
  .superRefine((record, ctx) => {
    for (const key of Object.keys(record)) {
      if (!(key in DEFAULT_THRESHOLDS)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${key}" is not a configurable threshold.`, path: [key] });
      }
    }
  });

export const companyProfileSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required.').max(160),
  industry: z.enum(industryKeys).default('general'),
  sector: z.string().max(120).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'OTHER']).default('INR'),
  currencyLabel: z.string().max(20).nullable().optional(),
  fiscalYearEnd: z.string().max(40).nullable().optional(),
  reportingPeriod: z.enum(['annual', 'half_yearly', 'quarterly']).default('annual'),
  units: z.enum(['units', 'thousands', 'lakhs', 'millions', 'crores', 'billions']).default('units'),
  ticker: z.string().max(20).nullable().optional(),
  benchmark: z.string().max(80).nullable().optional(),
  marketCap: financialValue.optional(),
  sharePrice: financialValue.optional(),
  sharesOutstanding: financialValue.optional(),
  notes: z.string().max(2000).nullable().optional(),
  isSample: z.boolean().optional(),
});

export const createCompanySchema = companyProfileSchema.extend({
  periods: z.array(periodSchema).max(20, 'At most 20 periods are supported.').default([]),
  peers: z.array(peerSchema).max(20).default([]),
  thresholds: thresholdsSchema.optional(),
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  name: z.string().trim().min(1).max(160).optional(),
});

/** Periods must be uniquely labelled and consistently ordered before they reach the engine. */
export const replacePeriodsSchema = z
  .object({ periods: z.array(periodSchema).max(20) })
  .superRefine(({ periods }, ctx) => {
    const labels = periods.map((p) => p.label.trim().toLowerCase());
    const duplicate = labels.find((l, i) => labels.indexOf(l) !== i);
    if (duplicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate period label "${duplicate}". Each financial year must appear exactly once.`,
        path: ['periods'],
      });
    }
    const orders = periods.map((p) => p.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Two periods share the same position.', path: ['periods'] });
    }
  });

/** An ad-hoc analysis request: data is analysed without being persisted. */
export const analyzeRequestSchema = z.object({
  company: companyProfileSchema,
  periods: z.array(periodSchema).max(20).default([]),
  peers: z.array(peerSchema).max(20).default([]),
  thresholds: thresholdsSchema.optional(),
});

export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  defaultCurrency: z.string().max(10).optional(),
  defaultUnits: z.enum(['units', 'thousands', 'lakhs', 'millions', 'crores', 'billions']).optional(),
  defaultIndustry: z.enum(industryKeys).optional(),
  thresholds: thresholdsSchema.optional(),
  llmNarrativeEnabled: z.boolean().optional(),
});

/** The confirmed mapping a user submits from the import review screen. */
export const commitImportSchema = z.object({
  /** Token identifying the parsed upload held server-side. */
  importId: z.string().min(8).max(64),
  /** sourceRowKey -> canonical line item key, or null to skip the row. */
  mappings: z.record(z.string(), z.string().nullable()),
  /** Period columns the user chose to import, by header label. */
  periods: z.array(z.string().min(1).max(40)).min(1, 'Select at least one period to import.'),
  mode: z.enum(['replace', 'merge']).default('replace'),
  companyId: z.string().optional(),
});

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$|^mem_[a-z0-9]{8,}$/i, 'Invalid identifier.');

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type AnalyzeRequestInput = z.infer<typeof analyzeRequestSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
