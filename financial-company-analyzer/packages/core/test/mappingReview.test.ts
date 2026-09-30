import { describe, expect, it } from 'vitest';
import {
  AUTO_MAP_CONFIDENCE,
  REVIEWER_SUGGESTION_CONFIDENCE,
  REVIEW_BAND_MAX,
  applyMappingReview,
  buildMappingPlan,
  needsReview,
  rowsNeedingReview,
  type MappingCandidate,
  type MappingReviewVerdict,
} from '../src/index.js';

/** A candidate at a chosen confidence, shaped as buildMappingPlan would produce it. */
function candidate(overrides: Partial<MappingCandidate> & { confidence: number; target: string }): MappingCandidate {
  const { confidence, target, ...rest } = overrides;
  return {
    sourceLabel: 'A label',
    sourceRow: 1,
    sheet: 'Sheet1',
    suggestions: [{ targetKey: target, targetLabel: target, confidence, reason: 'because' }],
    selected: confidence >= AUTO_MAP_CONFIDENCE ? target : null,
    requiresConfirmation: confidence < AUTO_MAP_CONFIDENCE,
    isSectionHeader: false,
    ...rest,
  };
}

describe('the review band', () => {
  it('covers the confident-but-wrong range and nothing else', () => {
    expect(needsReview(candidate({ confidence: 79, target: 'revenue' }))).toBe(false);
    expect(needsReview(candidate({ confidence: AUTO_MAP_CONFIDENCE, target: 'revenue' }))).toBe(true);
    expect(needsReview(candidate({ confidence: REVIEW_BAND_MAX, target: 'revenue' }))).toBe(true);
    // An exact synonym hit scores 100 and is not worth second-guessing.
    expect(needsReview(candidate({ confidence: 100, target: 'revenue' }))).toBe(false);
  });

  it('leaves section headers and unmapped rows alone', () => {
    expect(needsReview(candidate({ confidence: 85, target: 'revenue', isSectionHeader: true }))).toBe(false);
    expect(needsReview(candidate({ confidence: 85, target: 'revenue', selected: null }))).toBe(false);
  });

  it('holds the three real mis-maps this exists for, and not the correct ones', () => {
    // Confidences as scoreMatch actually returns them for these filing labels.
    const plan = buildMappingPlan([
      { label: 'Profit before exceptional items and tax', row: 1, sheet: 'P&L' },
      { label: 'Borrowings (non-current)', row: 2, sheet: 'BS' },
      { label: 'Purchases of stock-in-trade', row: 3, sheet: 'P&L' },
      { label: 'Revenue from operations', row: 4, sheet: 'P&L' },
      { label: 'Trade payables', row: 5, sheet: 'BS' },
    ]);
    const flagged = rowsNeedingReview(plan).map(({ candidate }) => candidate.sourceLabel);
    expect(flagged).toContain('Profit before exceptional items and tax');
    expect(flagged).toContain('Borrowings (non-current)');
    expect(flagged).toContain('Purchases of stock-in-trade');
    // Exact matches are left out, so the reviewer is not asked about what text already settled.
    expect(flagged).not.toContain('Revenue from operations');
    expect(flagged).not.toContain('Trade payables');
  });
});

describe('applying verdicts', () => {
  const plan = [
    candidate({ confidence: 81, target: 'exceptionalItems', sourceLabel: 'Profit before exceptional items and tax' }),
    candidate({ confidence: 83, target: 'cfo', sourceLabel: 'Net cash generated from operating activities' }),
    candidate({ confidence: 100, target: 'revenue', sourceLabel: 'Revenue from operations' }),
  ];

  it('demotes a rejected row to needing confirmation', () => {
    const { candidates, demoted, reviewed } = applyMappingReview(plan, [
      { index: 0, agrees: false, betterKey: 'ebit', why: 'This is a profit line; it only mentions exceptional items.' },
    ]);
    expect(demoted).toBe(1);
    expect(reviewed).toBe(1);
    expect(candidates[0]!.selected).toBeNull();
    expect(candidates[0]!.requiresConfirmation).toBe(true);
    expect(candidates[0]!.review).toMatchObject({
      state: 'disagreed',
      rejectedKey: 'exceptionalItems',
      suggestedInstead: 'ebit',
    });
  });

  it('records the alternative below the auto-map threshold so it cannot apply by itself', () => {
    const { candidates } = applyMappingReview(plan, [
      { index: 0, agrees: false, betterKey: 'ebit', why: 'A profit line.' },
    ]);
    const added = candidates[0]!.suggestions.find((s) => s.targetKey === 'ebit');
    expect(added).toBeDefined();
    expect(added!.confidence).toBe(REVIEWER_SUGGESTION_CONFIDENCE);
    expect(added!.confidence).toBeLessThan(AUTO_MAP_CONFIDENCE);
  });

  it('keeps the selection when the reviewer agrees', () => {
    const { candidates, demoted } = applyMappingReview(plan, [
      { index: 1, agrees: true, why: 'Operating cash flow, correctly matched.' },
    ]);
    expect(demoted).toBe(0);
    expect(candidates[1]!.selected).toBe('cfo');
    expect(candidates[1]!.review).toMatchObject({ state: 'agreed' });
  });

  it('discards an unknown alternative rather than inventing a line item', () => {
    const { candidates } = applyMappingReview(plan, [
      { index: 0, agrees: false, betterKey: 'notALineItem', why: 'Wrong.' },
    ]);
    // Still demoted — the disagreement stands on its own — but no phantom target is offered.
    expect(candidates[0]!.selected).toBeNull();
    expect(candidates[0]!.review?.suggestedInstead).toBeUndefined();
    expect(candidates[0]!.suggestions.some((s) => s.targetKey === 'notALineItem')).toBe(false);
  });

  it('ignores a verdict about a row outside the band', () => {
    const { candidates, reviewed, demoted } = applyMappingReview(plan, [
      { index: 2, agrees: false, betterKey: 'cogs', why: 'Trying to overturn an exact match.' },
    ]);
    expect(reviewed).toBe(0);
    expect(demoted).toBe(0);
    expect(candidates[2]!.selected).toBe('revenue');
    expect(candidates[2]!.review).toBeUndefined();
  });

  it('ignores a verdict about a row that does not exist', () => {
    const { candidates, reviewed } = applyMappingReview(plan, [
      { index: 99, agrees: false, why: 'Out of range.' },
    ]);
    expect(reviewed).toBe(0);
    expect(candidates).toHaveLength(plan.length);
  });

  it('leaves the plan untouched when no verdicts come back', () => {
    const { candidates, reviewed, demoted } = applyMappingReview(plan, []);
    expect(reviewed).toBe(0);
    expect(demoted).toBe(0);
    expect(candidates).toEqual(plan);
  });
});

describe('the invariant that makes a model safe here', () => {
  /**
   * A review may only lower confidence. Whatever verdicts come back — including adversarial or
   * malformed ones — no row may end up auto-selected unless the string matcher selected that same
   * target first. This is the property that makes a failed, confused or hostile reviewer harmless.
   */
  it('never creates or changes an auto-selection, for any verdict', () => {
    const plan = buildMappingPlan([
      { label: 'Profit before exceptional items and tax', row: 1, sheet: 'P&L' },
      { label: 'Borrowings (non-current)', row: 2, sheet: 'BS' },
      { label: 'Employee benefits expense', row: 3, sheet: 'P&L' },
      { label: 'Revenue from operations', row: 4, sheet: 'P&L' },
      { label: 'Total assets', row: 5, sheet: 'BS' },
    ]);

    const hostile: MappingReviewVerdict[][] = [
      // Claim agreement everywhere.
      plan.map((_, index) => ({ index, agrees: true, why: 'yes' })),
      // Reject everything and propose a different real key each time.
      plan.map((_, index) => ({ index, agrees: false, betterKey: 'revenue', why: 'no' })),
      // Reject everything and propose nonsense.
      plan.map((_, index) => ({ index, agrees: false, betterKey: '__injected__', why: 'no' })),
      // Contradict itself about the same row.
      [
        { index: 0, agrees: true, why: 'a' },
        { index: 0, agrees: false, betterKey: 'cogs', why: 'b' },
      ],
      // Out-of-range and negative indices.
      [
        { index: -1, agrees: false, betterKey: 'cogs', why: 'x' },
        { index: 9999, agrees: false, betterKey: 'cogs', why: 'y' },
      ],
    ];

    for (const verdicts of hostile) {
      const { candidates } = applyMappingReview(plan, verdicts);
      expect(candidates).toHaveLength(plan.length);
      candidates.forEach((after, i) => {
        const before = plan[i]!;
        if (after.selected !== null) {
          // The only selection that may survive is the one the string matcher made.
          expect(after.selected).toBe(before.selected);
        }
        // And a row can only ever become more cautious, never less.
        if (before.requiresConfirmation) expect(after.requiresConfirmation).toBe(true);
      });
    }
  });

  it('is idempotent — reviewing an already-reviewed plan changes nothing further', () => {
    const plan = [candidate({ confidence: 81, target: 'exceptionalItems' })];
    const once = applyMappingReview(plan, [{ index: 0, agrees: false, betterKey: 'ebit', why: 'profit line' }]);
    const twice = applyMappingReview(once.candidates, [
      { index: 0, agrees: false, betterKey: 'ebit', why: 'profit line' },
    ]);
    // The row is no longer selected, so it is no longer in the band and no longer reviewable.
    expect(twice.reviewed).toBe(0);
    expect(twice.demoted).toBe(0);
    expect(twice.candidates).toEqual(once.candidates);
  });
});
