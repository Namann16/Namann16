import { Router } from 'express';
import { analyze } from '@fca/core';
import { getCompany, toDataset } from '../services/repository.js';
import { exportMetricsCsv, exportStatementsCsv, exportWorkbookBuffer } from '../services/exportData.js';
import { buildReportHtml } from '../services/report.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { objectIdSchema } from '../validation/schemas.js';

export const exportsRouter = Router();

/** Replace anything that could break a Content-Disposition header or a filesystem path. */
function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'analysis';
}

async function loadAnalysis(id: string) {
  const company = await getCompany(objectIdSchema.parse(id));
  if (!company) throw notFound('No analysis exists with that identifier.');
  return analyze(toDataset(company));
}

exportsRouter.get(
  '/:id/excel',
  asyncHandler(async (req, res) => {
    const analysis = await loadAnalysis(req.params.id!);
    const buffer = exportWorkbookBuffer(analysis);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(analysis.company.name)}-analysis.xlsx"`);
    res.send(buffer);
  }),
);

exportsRouter.get(
  '/:id/csv',
  asyncHandler(async (req, res) => {
    const analysis = await loadAnalysis(req.params.id!);
    const kind = req.query.kind === 'metrics' ? 'metrics' : 'statements';
    const csv = kind === 'metrics' ? exportMetricsCsv(analysis) : exportStatementsCsv(analysis);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(analysis.company.name)}-${kind}.csv"`);
    // A BOM keeps Excel from mangling non-ASCII currency symbols on open.
    res.send(`﻿${csv}`);
  }),
);

/**
 * The analysis report, as print-ready HTML.
 *
 * The client opens this in a new tab where the user prints to PDF. Producing HTML rather than a
 * binary keeps the output searchable and avoids shipping a headless browser with the server.
 */
exportsRouter.get(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const analysis = await loadAnalysis(req.params.id!);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    res.send(buildReportHtml(analysis));
  }),
);
