# API reference

Base URL `http://localhost:4000/api` by default. All responses are JSON unless stated otherwise.

Every request body is validated server-side with Zod. Validation failures return `400` with a
field-keyed list so the interface can point at the offending input:

```json
{
  "error": {
    "message": "The data supplied did not pass validation.",
    "issues": [{ "path": "periods.0.values.revenu", "message": "\"revenu\" is not a recognised financial line item." }]
  }
}
```

---

## Metadata

### `GET /meta`
Everything the client needs to render input forms, ratio explanations and the Settings screen:
line-item registry, metric definitions with formulas and meanings, industry profiles, threshold
defaults and descriptions, the rule list, and public configuration.

Serving this from the engine keeps the interface in step automatically — a line item or metric
added to the registry appears in the input grid and the glossary with no frontend change.

### `GET /meta/health`
Liveness probe. `{ "status": "ok", "storage": "mongodb" | "memory", "uptime": 42 }`

---

## Companies

### `GET /companies`
All saved analyses, newest first, with period counts and the latest period.

### `POST /companies`
Create an analysis. Accepts the company profile plus optional `periods`, `peers` and `thresholds`.

```json
{
  "name": "Northwind Manufacturing Ltd.",
  "industry": "manufacturing",
  "currency": "INR",
  "units": "crores",
  "periods": [
    { "label": "FY25", "order": 0, "values": { "revenue": 1200, "cogs": 720 } }
  ]
}
```

### `POST /companies/sample`
Load the fictional Apex Consumer Products dataset as a new analysis.

### `GET /companies/:id` · `PATCH /companies/:id` · `DELETE /companies/:id`
Read, update and delete. `PATCH` accepts a partial profile, and `thresholds` to override the
engine and industry defaults for this company.

### `PUT /companies/:id/periods`
Replace all financial periods. Rejects duplicate labels and duplicate ordering positions.

### `PUT /companies/:id/peers`
Replace the peer set.

### `GET /companies/:id/analysis`
Run the full pipeline and return the `AnalysisResult`: normalized statements, all metrics with
provenance, CAGRs, DuPont, health score, red flags, positive signals, insights, executive summary,
data quality and peer comparison.

The analysis is **recomputed from raw data on every request**, never read from a cache, so a
change to a formula can never leave stale numbers behind.

### `GET /companies/:id/facts`
The structured fact package an optional LLM layer would receive: calculated metrics with their
formulas, rule outcomes, health scores and data-quality findings — plus an explicit instruction
not to compute new figures or assert causality the evidence does not establish. Raw line items are
deliberately excluded.

### `POST /analyze`
Analyse a dataset without persisting it. Same response shape as `/companies/:id/analysis`.

---

## Excel import

### `GET /import/template`
The six-sheet import template as `.xlsx`. Optional `?years=FY22,FY23,FY24` to set the columns.

### `POST /import/parse`
`multipart/form-data` with `file` (and optionally `units`). **Parses and proposes; writes nothing.**

Returns an `importId`, the detected company information, the period columns it recognised, and a
mapping proposal — each row with its suggested field, a confidence score, and the reason for the
suggestion. The parsed workbook is held server-side for 30 minutes.

Accepts `.xlsx`, `.xlsm`, `.xls`, `.csv` up to `MAX_UPLOAD_BYTES`. Files are held in memory and
never written to disk; formula and HTML evaluation is disabled in the parser.

`400` if the file is not a readable spreadsheet, or if no financial-year columns could be
identified anywhere in it — the error names the sheets that were examined.

### `POST /import/commit`
Apply the mapping the user confirmed.

```json
{
  "importId": "…",
  "mappings": { "P&L::4": "revenue", "P&L::5": "cogs", "P&L::9": null },
  "periods": ["FY24", "FY25", "FY26"],
  "mode": "replace",
  "companyId": "…"
}
```

`mode` is `replace` (discard existing periods) or `merge` (overlay onto matching labels). Omit
`companyId` to receive the periods without persisting them.

Returns the periods produced, what was applied, what was skipped and why, and any warnings —
including sign conventions that were normalised.

### `DELETE /import/:importId`
Abandon a staged import.

---

## Exports

### `GET /export/:id/excel`
Workbook: statements with each value marked Entered or Calculated, metrics with formulas and
trends, CAGRs, the written analysis, the data-quality register, and peer comparison where present.

### `GET /export/:id/csv?kind=statements|metrics`
Flat CSV. Unavailable figures are left blank, never written as zero. Leading `= + - @` is escaped
so a crafted company name cannot execute when the file is opened.

### `GET /export/:id/report`
The analysis report as print-ready HTML covering all 14 sections. Open it in a browser and print
to PDF. Produced as HTML rather than a binary so the output stays selectable and searchable and
the server ships no headless browser.

---

## Errors

| Status | Meaning |
|---|---|
| `400` | Validation failure, unreadable upload, or a workbook with no identifiable periods |
| `404` | No analysis with that identifier, or an expired import token |
| `413` | Upload exceeds `MAX_UPLOAD_BYTES` |
| `429` | Rate limit exceeded |
| `500` | Unexpected error. The message is suppressed in production; the stack is logged server-side |
