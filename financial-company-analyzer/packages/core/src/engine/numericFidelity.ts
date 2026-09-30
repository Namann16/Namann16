/**
 * Numeric fidelity guard.
 *
 * The specification allows a language model to rephrase the engine's findings and forbids it from
 * producing figures (Part G1, Part K). Instructing a model not to invent numbers is necessary but
 * not sufficient — an instruction is a request, not a guarantee. This module is the guarantee.
 *
 * Every number in generated prose must be traceable to a number the engine actually computed.
 * Anything else means the model produced a figure, and the narrative is rejected rather than
 * shown: a plausible wrong number in a financial tool is worse than a plain sentence.
 *
 * The check is deliberately generous about presentation and strict about value. "18.8%" matches a
 * computed 18.79 because rounding for display is legitimate; 18.9 does not match anything and is
 * rejected. Nothing here trusts the model — the allowed set is built from engine output alone.
 */

/** Numbers written in prose: 1,980 · 18.8 · -4.72 · 0.41 */
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

/**
 * Small integers that carry no financial meaning on their own.
 *
 * Counts and ordinals ("three red flags", "the second pillar") are part of ordinary sentence
 * construction rather than reported figures, and requiring them to appear in the fact sheet would
 * reject correct prose. The ceiling is low on purpose: a real financial quantity above this is
 * still checked, and one below it cannot misstate a result on its own.
 */
const INCIDENTAL_INTEGER_CEILING = 12;

export interface FidelityFinding {
  /** The number as it appeared in the prose. */
  value: number;
  /** The sentence fragment it appeared in, for the rejection message. */
  context: string;
}

export interface FidelityResult {
  ok: boolean;
  /** Numbers in the prose that match nothing the engine computed. */
  unsupported: FidelityFinding[];
}

function parseNumbers(text: string): { value: number; index: number }[] {
  const out: { value: number; index: number }[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) out.push({ value, index: match.index ?? 0 });
  }
  return out;
}

/** Decimal places a number was written to, which is the precision a match must be judged at. */
function decimalsOf(token: string): number {
  const dot = token.indexOf('.');
  return dot === -1 ? 0 : token.length - dot - 1;
}

/**
 * Collect every number the engine produced, from anywhere in a structure.
 *
 * Walking the whole object rather than a hand-listed set of fields means a figure the fact sheet
 * legitimately contains can never be rejected because this function had not been updated.
 */
export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(value);
    return into;
  }
  if (typeof value === 'string') {
    // Period labels and pre-formatted displays hold real figures too ("FY26", "₹1,980 Cr").
    for (const { value: n } of parseNumbers(value)) into.add(n);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, into);
  }
  return into;
}

/**
 * Check generated prose against the numbers the engine computed.
 *
 * A prose number is supported when some computed number rounds to it at the precision the prose
 * used. That admits honest rounding in both directions — a fact sheet carrying 18.79 supports
 * "18.8%", and one carrying 1980 supports "1,980" — while a figure that matches nothing is
 * reported so the caller can discard the narrative.
 */
export function checkNumericFidelity(prose: string, facts: unknown): FidelityResult {
  const allowed = collectNumbers(facts);
  const unsupported: FidelityFinding[] = [];

  for (const match of prose.matchAll(NUMBER_PATTERN)) {
    const token = match[0];
    const value = Number(token.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;

    // Ordinary counting words, and any figure the engine reported exactly.
    if (Number.isInteger(value) && Math.abs(value) <= INCIDENTAL_INTEGER_CEILING) continue;
    if (allowed.has(value)) continue;

    const decimals = decimalsOf(token);
    const factor = 10 ** decimals;
    const supported = [...allowed].some((candidate) => Math.round(candidate * factor) / factor === value);
    if (supported) continue;

    const at = match.index ?? 0;
    unsupported.push({
      value,
      context: prose.slice(Math.max(0, at - 40), at + token.length + 40).replace(/\s+/g, ' ').trim(),
    });
  }

  return { ok: unsupported.length === 0, unsupported };
}
