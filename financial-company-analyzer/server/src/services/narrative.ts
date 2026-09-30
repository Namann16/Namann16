import { checkNumericFidelity, type AnalysisResult, type ExecutiveSummary } from '@fca/core';
import { buildLlmFacts } from '@fca/core';
import { config } from '../config/env.js';
import { completeStructured } from './llm.js';

/**
 * Optional narrative layer.
 *
 * The specification draws a hard line (Part G1, Part D3, Part K): the engine decides every number,
 * threshold and severity, and a language model may only rephrase a verdict that is already fixed.
 * Two runs on the same file must reach the same conclusions. This module sits entirely on the
 * far side of that line.
 *
 * Three things keep it there:
 *
 *   1. The model is handed `buildLlmFacts()` — calculated values only. It never sees raw input,
 *      is never asked to compute, and cannot reach the data that produced the figures.
 *   2. Its output is checked against the numbers the engine produced. A figure that traces to
 *      nothing gets the whole narrative discarded, because an instruction not to invent numbers
 *      is a request and this is the guarantee.
 *   3. Every failure — no key, an API error, a refusal, a failed check — returns null, and the
 *      caller keeps the deterministic summary. The analysis never depends on this working.
 *
 * What the model changes is how findings read, never what they are.
 */

/**
 * The shape the model must return.
 *
 * Declared as raw JSON Schema rather than through the SDK's Zod helper, which expects Zod v4
 * while this workspace is on v3. Structured output makes the contract enforceable either way:
 * the response either matches this shape or it does not parse, so there is no prose to scrape.
 */
const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overallAssessment', 'takeaways'],
  properties: {
    headline: {
      type: 'string',
      description: 'One sentence naming the company and the overall assessment.',
    },
    overallAssessment: {
      type: 'string',
      description: 'Two or three sentences expanding the headline, drawn only from the supplied facts.',
    },
    takeaways: {
      type: 'array',
      items: { type: 'string' },
      description: 'The most decision-relevant points, one sentence each, in order of importance.',
    },
  },
} as const;

interface NarrativeShape {
  headline: string;
  overallAssessment: string;
  takeaways: string[];
}

/** Narrow an unknown parsed payload to the declared shape before trusting any field. */
function asNarrative(value: unknown): NarrativeShape | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const takeaways = candidate.takeaways;
  if (typeof candidate.headline !== 'string') return null;
  if (typeof candidate.overallAssessment !== 'string') return null;
  if (!Array.isArray(takeaways) || takeaways.some((t) => typeof t !== 'string')) return null;
  return {
    headline: candidate.headline,
    overallAssessment: candidate.overallAssessment,
    takeaways: takeaways as string[],
  };
}

const SYSTEM_PROMPT = `You rewrite the findings of a deterministic financial analysis engine into clear prose for an analyst.

The engine has already done every calculation and reached every verdict. Your job is presentation, nothing else.

Rules, in order of importance:
1. Never compute, estimate, infer or adjust a figure. Every number you write must appear verbatim in the facts you were given, or be that number rounded for readability.
2. Never introduce a fact that is not in the input — no forecasts, no industry comparisons, no causes the evidence does not establish, no context from your own knowledge of the company.
3. Never change a verdict. If the engine called something a concern, it stays a concern.
4. Where the facts say a figure was unavailable, say it was unavailable. Never treat a missing value as zero.
5. Write plainly, in the past or present tense, for a reader who understands finance. No filler, no hedging, no exhortation.

If the facts are too thin to say something useful, say that instead of padding.`;

export interface NarrativeResult {
  summary: ExecutiveSummary;
  /** Which model wrote it, so the output is attributable. */
  model: string;
}

/** Why a narrative was not produced. Surfaced so the UI can say something true about the fallback. */
export type NarrativeSkipReason =
  | 'not_configured'
  | 'disabled'
  | 'no_analysis'
  | 'api_error'
  | 'refused'
  | 'unparsable'
  | 'failed_numeric_check';

export interface NarrativeOutcome {
  result: NarrativeResult | null;
  reason?: NarrativeSkipReason;
  /** Populated when the numeric check rejected the narrative, for the server log. */
  detail?: string;
}

/**
 * Rewrite an analysis's executive summary.
 *
 * Returns null on every failure path rather than throwing: the narrative is a presentation
 * nicety, and no analysis should fail because a third-party API did.
 */
export async function generateNarrative(
  analysis: AnalysisResult,
  options: { enabled: boolean },
): Promise<NarrativeOutcome> {
  // Order matters: with no key at all, "not configured" is the useful answer and the toggle is
  // beside the point. completeStructured() would also report it, but only after the toggle check.
  if (!config.hasLlm) return { result: null, reason: 'not_configured' };
  if (!options.enabled) return { result: null, reason: 'disabled' };
  if (!analysis.latestPeriod) return { result: null, reason: 'no_analysis' };

  const facts = buildLlmFacts(analysis);

  // Compact JSON, not pretty-printed: indentation was 43% of this payload and carries no
  // information. Nothing is dropped — what is sent is exactly `facts`, which is also what the
  // numeric fidelity check below runs against, so the two can never disagree about what was seen.
  const outcome = await completeStructured({
    system: SYSTEM_PROMPT,
    user: `Rewrite this analysis as an executive summary. These are the only facts you may use.\n\n${JSON.stringify(facts)}`,
    schemaName: 'executive_summary',
    schema: NARRATIVE_SCHEMA,
    maxTokens: 16000,
  });

  if (!outcome.ok) {
    return { result: null, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) };
  }

  const parsed = asNarrative(outcome.value);
  if (!parsed) return { result: null, reason: 'unparsable' };

  // The guarantee. Any figure that traces to nothing the engine computed discards the lot —
  // a narrative is worth having only while every number in it is the engine's. This is also what
  // makes a cheaper or weaker model safe to use here: it cannot put a figure on the screen.
  const prose = [parsed.headline, parsed.overallAssessment, ...parsed.takeaways].join('\n');
  const fidelity = checkNumericFidelity(prose, facts);
  if (!fidelity.ok) {
    return {
      result: null,
      reason: 'failed_numeric_check',
      detail: fidelity.unsupported.map((u) => `${u.value} in "${u.context}"`).join('; '),
    };
  }

  return {
    result: {
      model: outcome.model,
      summary: {
        ...analysis.executiveSummary,
        headline: parsed.headline,
        overallAssessment: parsed.overallAssessment,
        takeaways: parsed.takeaways,
      },
    },
  };
}
