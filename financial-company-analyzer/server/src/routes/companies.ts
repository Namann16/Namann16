import { Router } from 'express';
import {
  analyze,
  analyzeScenario,
  buildLlmFacts,
  buildSampleDataset,
  type CompanyDataset,
  type FinancialPeriod,
  type PeerCompany,
} from '@fca/core';
import {
  analyzeRequestSchema,
  createCompanySchema,
  objectIdSchema,
  replacePeriodsSchema,
  updateCompanySchema,
  peerSchema,
  scenarioRequestSchema,
} from '../validation/schemas.js';
import { z } from 'zod';
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  storageMode,
  toDataset,
  updateCompany,
  createAnalysisSnapshot,
  getAnalysisSnapshot,
  listAnalysisSnapshots,
} from '../services/repository.js';
import { asyncHandler, notFound } from '../middleware/errors.js';

export const companiesRouter = Router();

/** Normalise a validated period payload into the engine's shape. */
function toPeriods(input: z.infer<typeof replacePeriodsSchema>['periods']): FinancialPeriod[] {
  return input.map((p) => ({
    label: p.label.trim(),
    endDate: p.endDate ?? null,
    order: p.order,
    isPartial: p.isPartial ?? false,
    // Specification C4. These flags were validated and then dropped here, so a period marked
    // unusual never reached the engine and the "prior period was exceptional" test could not pass.
    ...(p.unusual ? { unusual: true } : {}),
    ...(p.unusualReason ? { unusualReason: p.unusualReason } : {}),
    values: p.values,
    // Anything arriving from a client is treated as entered data; the engine re-derives the rest,
    // so a client cannot pass off a made-up figure as an engine calculation.
    sources: Object.fromEntries(Object.keys(p.values).map((k) => [k, 'entered' as const])),
  }));
}

function toPeers(input: z.infer<typeof peerSchema>[]): PeerCompany[] {
  return input.map((p) => ({ name: p.name.trim(), source: p.source ?? undefined, metrics: p.metrics }));
}

companiesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ companies: await listCompanies(), storage: storageMode() });
  }),
);

companiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createCompanySchema.parse(req.body);
    const { periods, peers, thresholds, businessContext, ...profile } = body;
    const created = await createCompany({
      company: profile as CompanyDataset['company'],
      periods: toPeriods(periods),
      peers: toPeers(peers),
      ...(thresholds ? { thresholds } : {}),
      ...(businessContext ? { businessContext } : {}),
    });
    res.status(201).json({ company: created });
  }),
);

/** Load the bundled fictional dataset as a new company. */
companiesRouter.post(
  '/sample',
  asyncHandler(async (_req, res) => {
    const sample = buildSampleDataset();
    const created = await createCompany({
      company: sample.company,
      periods: sample.periods,
      peers: sample.peers ?? [],
    });
    res.status(201).json({ company: created });
  }),
);

companiesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    res.json({ company });
  }),
);

companiesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const body = updateCompanySchema.parse(req.body);
    const existing = await getCompany(id);
    if (!existing) throw notFound('No analysis exists with that identifier.');

    const { periods, peers, thresholds, businessContext, ...profile } = body;
    const updated = await updateCompany(id, {
      company: { ...existing.company, ...profile } as CompanyDataset['company'],
      ...(periods ? { periods: toPeriods(periods) } : {}),
      ...(peers ? { peers: toPeers(peers) } : {}),
      ...(thresholds ? { thresholds } : {}),
      ...(businessContext ? { businessContext } : {}),
    });
    res.json({ company: updated });
  }),
);

companiesRouter.put(
  '/:id/periods',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const { periods } = replacePeriodsSchema.parse(req.body);
    const existing = await getCompany(id);
    if (!existing) throw notFound('No analysis exists with that identifier.');

    const updated = await updateCompany(id, { periods: toPeriods(periods) });
    res.json({ company: updated });
  }),
);

companiesRouter.put(
  '/:id/peers',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const { peers } = z.object({ peers: z.array(peerSchema).max(20) }).parse(req.body);
    const existing = await getCompany(id);
    if (!existing) throw notFound('No analysis exists with that identifier.');

    const updated = await updateCompany(id, { peers: toPeers(peers) });
    res.json({ company: updated });
  }),
);

companiesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const deleted = await deleteCompany(id);
    if (!deleted) throw notFound('No analysis exists with that identifier.');
    res.status(204).end();
  }),
);

/** Run the full analysis pipeline for a stored company. */
companiesRouter.get(
  '/:id/analysis',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    const result = analyze(toDataset(company));
    await createAnalysisSnapshot(id, result);
    res.json({ analysis: result });
  }),
);

companiesRouter.get(
  '/:id/snapshots',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    res.json({ snapshots: await listAnalysisSnapshots(id) });
  }),
);

companiesRouter.get(
  '/:id/snapshots/:snapshotId',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const snapshotId = req.params.snapshotId;
    if (!snapshotId) throw notFound('That analysis snapshot could not be found.');
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    const snapshot = await getAnalysisSnapshot(id, snapshotId);
    if (!snapshot) throw notFound('That analysis snapshot could not be found.');
    res.json({ analysis: snapshot });
  }),
);

companiesRouter.post(
  '/:id/scenario',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    const body = scenarioRequestSchema.parse(req.body);
    res.json({ scenario: analyzeScenario(toDataset(company), body.modifications) });
  }),
);

/** The structured fact package an optional language layer would receive. */
companiesRouter.get(
  '/:id/facts',
  asyncHandler(async (req, res) => {
    const id = objectIdSchema.parse(req.params.id);
    const company = await getCompany(id);
    if (!company) throw notFound('No analysis exists with that identifier.');
    res.json({ facts: buildLlmFacts(analyze(toDataset(company))) });
  }),
);

/** Analyse data without persisting it — used by the manual-input preview. */
export const analysisRouter = Router();

analysisRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = analyzeRequestSchema.parse(req.body);
    const dataset: CompanyDataset = {
      company: body.company as CompanyDataset['company'],
      periods: toPeriods(body.periods),
      peers: toPeers(body.peers),
      ...(body.thresholds ? { thresholds: body.thresholds } : {}),
    };
    res.json({ analysis: analyze(dataset) });
  }),
);
