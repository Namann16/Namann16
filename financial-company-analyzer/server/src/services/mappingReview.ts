import {
  LINE_ITEM_MAP,
  applyMappingReview,
  rowsNeedingReview,
  type MappingCandidate,
  type MappingReviewOutcome,
  type MappingReviewVerdict,
} from '@fca/core';
import { config } from '../config/env.js';
import { completeStructured } from './llm.js';

/**
 * Second opinion on the import mapping.
 *
 * The string matcher in `@fca/core` resolves most filing labels correctly, but it compares text,
 * so it cannot tell a label that *is* a concept from one that merely mentions it, nor a balance
 * sheet stock from a cash flow. Those failures score in the low 80s — above the auto-map
 * threshold — so they are applied without the user being asked, and the engine then computes
 * flawless ratios from the wrong line. Nothing downstream can catch it: the provenance trail
 * records the mis-mapped line just as faithfully as a correct one.
 *
 * Deciding which of 99 canonical fields a phrase like "Profit before exceptional items and tax"
 * belongs to is a language judgement, which is the one thing a model is better at than a
 * Levenshtein distance. So it is asked — but only ever to object.
 *
 * `applyMappingReview` enforces the shape of that: a verdict can clear a selection and can
 * volunteer an alternative below the auto-map threshold, and can do nothing else. So the worst
 * case for a wrong, confused or malicious verdict is one extra confirmation the user was
 * arguably owed anyway, and the worst case for an outage is today's behaviour.
 *
 * Determinism is unaffected. The review runs once, at import, on a plan the user then confirms;
 * the confirmed mapping is what persists. Re-running an analysis makes no call here.
 */

/**
 * Most rows in a workbook are exact matches or obvious non-items, so the band is small in
 * practice. The cap bounds a pathological sheet rather than a normal one.
 */
const MAX_REVIEW_ROWS = 40;

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // Every property is listed, including the nullable one: constrained decoding (Groq's
        // strict mode) rejects a schema whose `properties` and `required` disagree. Anthropic is
        // unaffected, and asVerdicts() already treats a null betterKey as "no alternative".
        required: ['index', 'agrees', 'betterKey', 'why'],
        properties: {
          index: { type: 'integer', description: 'The row index given in the input.' },
          agrees: {
            type: 'boolean',
            description: 'True if the proposed field is right for this label.',
          },
          betterKey: {
            type: ['string', 'null'],
            description:
              'When agrees is false, the canonical key that fits better, or null if none of the listed alternatives do.',
          },
          why: {
            type: 'string',
            description: 'One short sentence for the user. State the distinction, not your reasoning.',
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You check proposed mappings from financial-statement row labels onto a fixed set of canonical fields.

A text-similarity matcher has already proposed a field for each row. It is usually right. You are asked only about the rows where it was confident but could still be wrong, and your only job is to catch the errors it cannot see. It compares strings, so it makes two kinds of mistake:

1. MENTIONS vs IS. A label that contains a term is not necessarily that term. "Profit before exceptional items and tax" is a profit line — it merely mentions exceptional items. "Provision for doubtful debts" is a provision, not receivables.
2. STOCK vs FLOW. A balance-sheet position is not a cash-flow movement. "Borrowings (non-current)" is a liability you hold; "Proceeds from borrowings" is cash you raised. "Property, plant and equipment" is an asset; "Purchase of property, plant and equipment" is capital expenditure.

Also watch for a component being mapped to a total, or an expense to income.

For each row, answer whether the proposed field is right.

- Agree unless you have a specific reason. A row you are unsure about is a row you agree with: a false objection costs the user a needless confirmation, and objecting to everything makes you useless.
- When you disagree, name the better field using one of the canonical keys listed for that row, or the key of any field in the provided list. If none fits, set betterKey to null and say so — a row mapped to nothing is better than a row mapped wrongly.
- Judge only the label against the field. You are not given values, and you must not reason about amounts.
- Keep "why" to one sentence naming the distinction, phrased for the person reviewing the import.`;

interface RawVerdict {
  index: number;
  agrees: boolean;
  betterKey?: string | null;
  why: string;
}

/** Narrow the parsed payload before any field is trusted. */
function asVerdicts(value: unknown): RawVerdict[] | null {
  if (!value || typeof value !== 'object') return null;
  const verdicts = (value as Record<string, unknown>).verdicts;
  if (!Array.isArray(verdicts)) return null;
  const out: RawVerdict[] = [];
  for (const entry of verdicts) {
    if (!entry || typeof entry !== 'object') return null;
    const v = entry as Record<string, unknown>;
    if (typeof v.index !== 'number' || !Number.isInteger(v.index)) return null;
    if (typeof v.agrees !== 'boolean') return null;
    if (typeof v.why !== 'string') return null;
    const better = v.betterKey;
    if (better !== undefined && better !== null && typeof better !== 'string') return null;
    out.push({
      index: v.index,
      agrees: v.agrees,
      why: v.why,
      ...(typeof better === 'string' ? { betterKey: better } : {}),
    });
  }
  return out;
}

/** Describe one field well enough that a stock/flow confusion is visible without the values. */
function describeTarget(key: string): string {
  const item = LINE_ITEM_MAP[key];
  if (!item) return key;
  const parts = [`${key} — "${item.label}"`, `statement: ${item.statement}`];
  if (item.section) parts.push(`section: ${item.section}`);
  if (item.description) parts.push(item.description);
  return parts.join(' · ');
}

export type MappingReviewSkipReason =
  | 'not_configured'
  | 'disabled'
  | 'nothing_to_review'
  | 'api_error'
  | 'refused'
  | 'unparsable';

export interface MappingReviewResult extends MappingReviewOutcome {
  /** Set when no review ran, so the caller can say something true about why. */
  reason?: MappingReviewSkipReason;
  /** Which model reviewed, when one did. */
  model?: string;
}

/**
 * Review the confident mappings in a plan and return the plan with any objections applied.
 *
 * Never throws and never rejects: on any failure the original candidates come back untouched,
 * which is exactly the behaviour of a deployment with no key configured.
 */
export async function reviewMappingPlan(
  candidates: MappingCandidate[],
  options: { enabled: boolean },
): Promise<MappingReviewResult> {
  const unchanged = { candidates, reviewed: 0, demoted: 0 };
  if (!config.hasLlm) return { ...unchanged, reason: 'not_configured' };
  if (!options.enabled) return { ...unchanged, reason: 'disabled' };

  const band = rowsNeedingReview(candidates).slice(0, MAX_REVIEW_ROWS);
  if (band.length === 0) return { ...unchanged, reason: 'nothing_to_review' };

  const rows = band.map(({ index, candidate }) => ({
    index,
    label: candidate.sourceLabel,
    sheet: candidate.sheet,
    proposed: describeTarget(candidate.selected!),
    alternatives: candidate.suggestions
      .filter((s) => s.targetKey !== candidate.selected)
      .slice(0, 4)
      .map((s) => describeTarget(s.targetKey)),
  }));

  const response = await completeStructured({
    system: SYSTEM_PROMPT,
    user: `Check these proposed mappings.\n\n${JSON.stringify(rows)}`,
    schemaName: 'mapping_review',
    schema: REVIEW_SCHEMA,
    maxTokens: 8000,
  });

  // Any failure keeps the text-matched plan, which is what a deployment with no key does.
  if (!response.ok) return { ...unchanged, reason: response.reason };

  const parsed = asVerdicts(response.value);
  if (!parsed) return { ...unchanged, reason: 'unparsable' };

  // applyMappingReview discards anything out of range or out of band, so a verdict about a row
  // that was never asked about cannot take effect — which is why a weaker model is safe here.
  const verdicts: MappingReviewVerdict[] = parsed;
  const outcome = applyMappingReview(candidates, verdicts);
  if (outcome.demoted > 0) {
    console.info(
      `[mappingReview] ${outcome.demoted} of ${band.length} confident mapping(s) demoted for confirmation.`,
    );
  }
  return { ...outcome, model: response.model };
}
