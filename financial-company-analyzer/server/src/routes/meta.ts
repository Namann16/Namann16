import { Router } from 'express';
import {
  DEFAULT_THRESHOLDS,
  INDUSTRY_PROFILES,
  LINE_ITEMS,
  METRIC_DEFINITIONS,
  METRIC_GROUP_LABELS,
  RED_FLAG_RULES,
  POSITIVE_SIGNAL_RULES,
  STATEMENT_ORDER,
  THRESHOLD_DESCRIPTIONS,
} from '@fca/core';
import { publicConfig } from '../config/env.js';
import { storageMode } from '../services/repository.js';
import { asyncHandler } from '../middleware/errors.js';

export const metaRouter = Router();

/**
 * Metadata the client needs to render input forms, ratio explanations and the settings screen.
 *
 * Serving this from the engine keeps the UI in step automatically: a line item or metric added
 * to the registry appears in the input grid and the ratio glossary with no frontend change.
 */
metaRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      config: { ...publicConfig(), storage: storageMode() },
      statements: STATEMENT_ORDER,
      lineItems: LINE_ITEMS,
      metricGroups: METRIC_GROUP_LABELS,
      metrics: METRIC_DEFINITIONS.map((m) => ({
        key: m.key,
        label: m.label,
        group: m.group,
        unit: m.unit,
        formula: m.formula,
        meaning: m.meaning,
        higherIsBetter: m.higherIsBetter ?? null,
      })),
      industries: Object.values(INDUSTRY_PROFILES).map((i) => ({
        key: i.key,
        label: i.label,
        note: i.note,
        overrides: i.overrides,
        suppressedMetrics: i.suppressedMetrics,
      })),
      thresholds: {
        defaults: DEFAULT_THRESHOLDS,
        descriptions: THRESHOLD_DESCRIPTIONS,
      },
      rules: [
        ...RED_FLAG_RULES.map((r) => ({ id: r.id, kind: r.kind, description: r.description })),
        ...POSITIVE_SIGNAL_RULES.map((r) => ({ id: r.id, kind: r.kind, description: r.description })),
      ],
    });
  }),
);

metaRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', storage: storageMode(), uptime: Math.round(process.uptime()) });
});
