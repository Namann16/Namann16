import multer from 'multer';
import { config } from '../config/env.js';
import { badRequest } from './errors.js';

/**
 * Upload handling for spreadsheet imports.
 *
 * Files are held in memory and never written to disk, so an uploaded file cannot be served back
 * or executed. Type, extension and size are all checked, and the parser itself is configured
 * not to evaluate formulas or HTML in the workbook.
 */

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
  'application/vnd.ms-excel.sheet.macroEnabled.12',                    // .xlsm — macros are never executed
  'text/csv',
  'application/csv',
  'application/octet-stream',                                          // some browsers send this; the extension check still applies
]);

const ALLOWED_EXTENSIONS = /\.(xlsx|xlsm|xls|csv)$/i;

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
      callback(badRequest(`"${file.originalname}" is not a spreadsheet. Upload an .xlsx, .xlsm, .xls or .csv file.`));
      return;
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      callback(badRequest(`Files of type "${file.mimetype}" are not accepted.`));
      return;
    }
    callback(null, true);
  },
}).single('file');
