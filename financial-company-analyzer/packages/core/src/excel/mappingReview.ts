import { LINE_ITEM_MAP } from '../engine/lineItems.js';
import { AUTO_MAP_CONFIDENCE, type MappingCandidate } from './mapping.js';

/**
 * Second-opinion review of the string matcher's confident mappings.
 *
 * `scoreMatch` compares labels as text, which cannot see two distinctions that matter here:
 *
 *   - whether a label *is* a concept or merely *mentions* it — "Profit before exceptional items
 *     and tax" contains "exceptional items" verbatim, and so scored 81 against the expense line
 *     while being a profit line;
 *   - whether a label is a stock or a flow — "Borrowings (non-current)" scored 85 against
 *     `debtIssued`, a financing cash flow, rather than the balance-sheet liability.
 *
 * Both land above AUTO_MAP_CONFIDENCE, so both were applied without the user being asked. The
 * engine then computes correct ratios from the wrong inputs, and its provenance trail faithfully
 * records the wrong line — determinism offers no protection against a mis-mapped input.
 *
 * A reviewer (see the server's mappingReview service) is asked about the rows in the band where
 * this failure lives. The invariant that makes it safe to consult a language model here:
 *
 *   ** a review can only ever LOWER confidence, never raise it **
 *
 * A disagreement demotes the row to `requiresConfirmation`, turning a silent corruption into a
 * question. It cannot select a target, and an alternative it proposes is recorded below the
 * auto-map threshold so it can never apply on its own. A reviewer that fails, times out or
 * returns nonsense therefore leaves the plan exactly as the string matcher built it.
 */

/**
 * Top of the review band. Above this the label matched a recognised term almost verbatim
 * (`scoreMatch` returns 100 only for an exact synonym hit), so there is nothing to second-guess.
 */
export const REVIEW_BAND_MAX = 95;

/** Confidence recorded for an alternative the reviewer proposed: below auto-map, by construction. */
export const REVIEWER_SUGGESTION_CONFIDENCE = AUTO_MAP_CONFIDENCE - 1;

/** True when a candidate sits in the band where a confident match may still be wrong. */
export function needsReview(candidate: MappingCandidate): boolean {
  if (candidate.isSectionHeader) return false;
  if (!candidate.selected) return false;
  const confidence = candidate.suggestions[0]?.confidence ?? 0;
  return confidence >= AUTO_MAP_CONFIDENCE && confidence <= REVIEW_BAND_MAX;
}

/**
 * The rows worth asking about, with their index in the original array.
 *
 * Indices rather than row keys: the caller owns whatever key scheme it exposes to clients, and
 * an index cannot be ambiguous between two rows carrying the same label.
 */
export function rowsNeedingReview(
  candidates: MappingCandidate[],
): { index: number; candidate: MappingCandidate }[] {
  return candidates
    .map((candidate, index) => ({ index, candidate }))
    .filter(({ candidate }) => needsReview(candidate));
}

export interface MappingReviewVerdict {
  /** Index into the candidate array the verdict is about. */
  index: number;
  /** True when the reviewer agrees with the proposed target. */
  agrees: boolean;
  /** A canonical line item key the reviewer considers a better fit. Ignored when it is unknown. */
  betterKey?: string | null;
  /** One sentence, shown to the user beside the row. */
  why: string;
}

export interface MappingReviewOutcome {
  candidates: MappingCandidate[];
  /** How many rows were in the band and had a verdict. */
  reviewed: number;
  /** How many auto-mapped rows were demoted to needing confirmation. */
  demoted: number;
}

/**
 * Apply reviewer verdicts to a mapping plan.
 *
 * Pure: the same candidates and verdicts always produce the same plan. Rows outside the review
 * band, and rows with no verdict, are returned untouched.
 */
export function applyMappingReview(
  candidates: MappingCandidate[],
  verdicts: MappingReviewVerdict[],
): MappingReviewOutcome {
  const byIndex = new Map<number, MappingReviewVerdict>();
  for (const verdict of verdicts) {
    // A verdict about a row nobody asked about is discarded rather than trusted.
    const candidate = candidates[verdict.index];
    if (candidate && needsReview(candidate)) byIndex.set(verdict.index, verdict);
  }

  let reviewed = 0;
  let demoted = 0;

  const next = candidates.map((candidate, index) => {
    const verdict = byIndex.get(index);
    if (!verdict) return candidate;
    reviewed += 1;

    if (verdict.agrees) {
      return { ...candidate, review: { state: 'agreed' as const, why: verdict.why } };
    }

    // Disagreement. Clear the selection so the user is asked, and record the reviewer's
    // alternative as information — never as a selection.
    const betterKey = verdict.betterKey && LINE_ITEM_MAP[verdict.betterKey] ? verdict.betterKey : null;
    const suggestions = [...candidate.suggestions];
    if (betterKey && !suggestions.some((s) => s.targetKey === betterKey)) {
      suggestions.push({
        targetKey: betterKey,
        targetLabel: LINE_ITEM_MAP[betterKey]?.label ?? betterKey,
        confidence: REVIEWER_SUGGESTION_CONFIDENCE,
        reason: 'Proposed by the mapping review, which disagreed with the closest text match.',
      });
      suggestions.sort((a, b) => b.confidence - a.confidence);
    }

    demoted += 1;
    return {
      ...candidate,
      suggestions,
      selected: null,
      requiresConfirmation: true,
      review: {
        state: 'disagreed' as const,
        why: verdict.why,
        rejectedKey: candidate.selected,
        ...(betterKey ? { suggestedInstead: betterKey } : {}),
      },
    };
  });

  return { candidates: next, reviewed, demoted };
}
