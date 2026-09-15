import { Router } from 'express';
import { z } from 'zod';
import { commitImportSchema } from '../validation/schemas.js';
import { commitImport, discardImport, parseWorkbook, retrieveImport } from '../services/excelImport.js';
import { templateBuffer } from '../services/excelTemplate.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { uploadSpreadsheet } from '../middleware/upload.js';
import { getCompany, updateCompany } from '../services/repository.js';
import type { FinancialPeriod } from '@fca/core';

export const importsRouter = Router();

/** Download the blank import template. */
importsRouter.get(
  '/template',
  asyncHandler(async (req, res) => {
    const years = z
      .array(z.string().trim().min(1).max(20))
      .max(12)
      .optional()
      .parse(typeof req.query.years === 'string' ? req.query.years.split(',').filter(Boolean) : undefined);

    const buffer = templateBuffer(years && years.length >= 2 ? years : undefined);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="financial-analyzer-template.xlsx"');
    res.send(buffer);
  }),
);

/**
 * Stage 1 of the import: parse the upload and propose a mapping.
 *
 * Nothing is written anywhere at this point. The parsed workbook is held server-side against a
 * short-lived token and the proposal is returned for the user to review.
 */
importsRouter.post('/parse', (req, res, next) => {
  uploadSpreadsheet(req, res, (uploadError) => {
    if (uploadError) {
      next(uploadError);
      return;
    }
    try {
      const file = (req as typeof req & { file?: Express.Multer.File }).file;
      if (!file) {
        throw badRequest('No file was uploaded. Attach a spreadsheet in the "file" field.');
      }
      if (file.size === 0) {
        throw badRequest('The uploaded file is empty.');
      }

      const units = z
        .enum(['units', 'thousands', 'lakhs', 'millions', 'crores', 'billions'])
        .optional()
        .parse(req.body?.units || undefined);

      const parsed = parseWorkbook(file.buffer, {
        fileName: file.originalname,
        ...(units ? { units } : {}),
      });

      res.json({
        importId: parsed.importId,
        fileName: parsed.fileName,
        sheets: parsed.sheets,
        detectedCompany: parsed.detectedCompany,
        periods: parsed.periods,
        mappings: parsed.mappings.map((mapping, index) => ({
          ...mapping,
          // The row key lets the client return a decision that is unambiguous even when two
          // rows carry the same label.
          rowKey: parsed.rows[index]?.key ?? `${mapping.sheet}::${mapping.sourceRow}`,
          preview: parsed.rows[index]
            ? Object.fromEntries(
                Object.entries(parsed.rows[index]!.cells).map(([period, cell]) => [period, cell.value]),
              )
            : {},
        })),
        warnings: parsed.warnings,
        summary: parsed.summary,
      });
    } catch (error) {
      next(error);
    }
  });
});

/**
 * Stage 2: apply the mapping the user confirmed.
 *
 * Returns the periods that would be created. When a companyId is supplied the periods are also
 * written to that company; otherwise the caller holds them and creates a company separately.
 */
importsRouter.post(
  '/commit',
  asyncHandler(async (req, res) => {
    const body = commitImportSchema.parse(req.body);
    const parsed = retrieveImport(body.importId);
    if (!parsed) {
      throw notFound('That import has expired or was already applied. Upload the file again.');
    }

    const result = commitImport(parsed, body.mappings, body.periods);

    let company = null;
    if (body.companyId) {
      const existing = await getCompany(body.companyId);
      if (!existing) throw notFound('No analysis exists with that identifier.');

      let periods: FinancialPeriod[];
      if (body.mode === 'merge') {
        // Merge keeps existing periods and overlays imported values onto matching labels.
        const byLabel = new Map(existing.periods.map((p) => [p.label, p]));
        for (const imported of result.periods) {
          const current = byLabel.get(imported.label);
          if (current) {
            byLabel.set(imported.label, {
              ...current,
              values: { ...current.values, ...imported.values },
              sources: { ...current.sources, ...imported.sources },
            });
          } else {
            byLabel.set(imported.label, imported);
          }
        }
        periods = [...byLabel.values()]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((p, index) => ({ ...p, order: index }));
      } else {
        periods = result.periods;
      }

      company = await updateCompany(body.companyId, { periods });
    }

    discardImport(body.importId);

    res.json({
      periods: result.periods,
      applied: result.applied,
      skipped: result.skipped,
      warnings: [...parsed.warnings, ...result.warnings],
      detectedCompany: parsed.detectedCompany,
      company,
      summary: {
        fieldsImported: result.applied.length,
        rowsSkipped: result.skipped.length,
        periodsCreated: result.periods.length,
        warnings: result.warnings.length,
      },
    });
  }),
);

/** Abandon a staged import without applying it. */
importsRouter.delete(
  '/:importId',
  asyncHandler(async (req, res) => {
    discardImport(z.string().min(8).max(64).parse(req.params.importId));
    res.status(204).end();
  }),
);
