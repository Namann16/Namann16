import type { FindingWindow, Flag, Insight, NarrativeContradiction } from '../types.js';

/**
 * Narrative discipline (specification Part G).
 *
 * The engine decides the numbers, the thresholds and the severities; this module only decides
 * whether a finished sentence is worth rendering. It never changes a verdict and never computes
 * anything — a finding removed here is removed because the sentence carries no information, not
 * because the underlying fact was inconvenient.
 */

/** Numeric tokens inside a rendered narrative, including negatives, decimals and thousands separators. */
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

/** Wording that asserts a movement, and is therefore contentless when every figure is identical. */
const CHANGE_LANGUAGE = /\b(?:against|versus|vs|from|reduction|increase|decrease|decline|improv\w*|deteriorat\w*|expand\w*|contract\w*|rose|fell|grew|shrank|higher|lower|change[ds]?)\b/i;

export interface VacuousVerdict {
  vacuous: boolean;
  reason?: string;
}

/**
 * Specification G4: decide whether a narrative's numeric slots are all zero or all identical.
 *
 * "Net debt / EBITDA stands at 0.00x against 0.00x a year earlier, a reduction of 0.00x" is the
 * shipped example. It is three empty slots wearing the grammar of an assessment.
 *
 * The rule is deliberately narrow, because dropping a real finding is worse than printing a dull
 * one. A sentence is vacuous only when it carries at least two figures AND either every figure is
 * zero, or every figure is the same number while the wording claims a movement. A single-figure
 * statement of fact ("Net debt is 0.00x") is not vacuous — it is true and worth saying.
 */
export function assessNarrative(text: string): VacuousVerdict {
  const tokens = text.match(NUMBER_PATTERN) ?? [];
  const numbers = tokens
    .map((token) => Number(token.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
  if (numbers.length < 2) return { vacuous: false };

  if (numbers.every((value) => value === 0)) {
    return { vacuous: true, reason: 'every figure in the sentence is zero' };
  }

  const first = numbers[0] as number;
  if (numbers.every((value) => value === first) && CHANGE_LANGUAGE.test(text)) {
    return {
      vacuous: true,
      reason: `the sentence claims a movement while every figure is ${first}`,
    };
  }

  return { vacuous: false };
}

/** Convenience predicate over the same rule. */
export function isVacuousNarrative(text: string): boolean {
  return assessNarrative(text).vacuous;
}

/**
 * Drop insights whose narrative says nothing. Evidence is not consulted: an insight is kept or
 * dropped on the strength of the sentence a reader actually sees.
 */
export function suppressEmptyInsights(insights: Insight[]): Insight[] {
  return insights.filter((insight) => !isVacuousNarrative(`${insight.title} ${insight.narrative}`));
}

/** The same rule for red flags and positive signals, which render `detail` rather than a narrative. */
export function suppressEmptyFlags(flags: Flag[]): Flag[] {
  return flags.filter((flag) => !isVacuousNarrative(`${flag.title} ${flag.detail}`));
}

/**
 * Specification G2: derive the window a finding's claim rests on, from the evidence it cites.
 *
 * Doing this centrally rather than per rule means no rule can forget it. A finding whose evidence
 * names no period returns undefined rather than a guessed span — an invented window is worse than
 * no window.
 */
export function windowOf(flag: Flag): FindingWindow | undefined {
  const periods = [...new Set(flag.evidence.lines.map((l) => l.period).filter((p): p is string => Boolean(p)))].sort();
  if (periods.length === 0) return undefined;
  return { from: periods[0]!, to: periods[periods.length - 1]!, periods: periods.length };
}

/** Stamp every finding with its window. */
export function withWindows(flags: Flag[]): Flag[] {
  return flags.map((flag) => {
    const window = windowOf(flag);
    return window ? { ...flag, window } : flag;
  });
}

/** Measures a finding speaks to, taken from the labels of the evidence lines it cites. */
function measuresOf(flag: Flag): Set<string> {
  return new Set(
    flag.evidence.lines
      .map((l) => l.label.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim())
      // A bare period label or a currency total is not a measure worth matching on.
      .filter((label) => label.length > 3 && !/^(difference|total|period)$/.test(label)),
  );
}

/** Crude singular form, enough to let "margins" in a title match the measure "margin". */
function stem(word: string): string {
  return word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word;
}

/**
 * Whether a claim is actually *about* a measure, rather than merely citing it in support.
 *
 * This distinction is what keeps the contradiction check honest. "Receivables are growing faster
 * than revenue" and "The asset base is being used more productively" both cite revenue growth as
 * evidence, but neither makes a claim about it, so they do not contradict each other. Requiring
 * the measure to appear in the claim itself is what separates the two cases.
 */
function claimIsAbout(flag: Flag, measure: string): boolean {
  const titleWords = new Set(
    flag.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem),
  );
  const measureWords = measure.split(/\s+/).filter((w) => w.length > 2).map(stem);
  return measureWords.length > 0 && measureWords.every((word) => titleWords.has(word));
}

/**
 * Specification G2: find opposite-sentiment findings about the same measure.
 *
 * In the reference export, "operating margins are deteriorating" and "operating margins have
 * expanded" shipped together. Both were true — one over FY24→FY26, the other over FY22→FY26 —
 * and neither said so. Neither is dropped here: the pair is reported with both windows attached,
 * so the reader can see that the disagreement is about the period, not about the arithmetic.
 *
 * A pair is only reported when both titles make a claim about the shared measure. Matching on the
 * evidence lines alone produces false positives on any two findings that happen to cite the same
 * supporting figure, and a contradiction report nobody trusts is worse than none.
 */
export function findContradictions(redFlags: Flag[], positiveSignals: Flag[]): NarrativeContradiction[] {
  const out: NarrativeContradiction[] = [];
  const seen = new Set<string>();

  for (const flag of redFlags) {
    const flagMeasures = measuresOf(flag);
    if (flagMeasures.size === 0) continue;
    for (const signal of positiveSignals) {
      const shared = [...measuresOf(signal)]
        .filter((m) => flagMeasures.has(m))
        .filter((m) => claimIsAbout(flag, m) && claimIsAbout(signal, m));
      if (shared.length === 0) continue;
      const pairKey = `${flag.id}|${signal.id}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const measure = shared.sort((a, b) => b.length - a.length)[0]!;
      const left = flag.window;
      const right = signal.window;
      const sameWindow = left && right && left.from === right.from && left.to === right.to;
      out.push({
        measure,
        detail: sameWindow
          ? `A concern and a positive signal are both reported on ${measure} over the same window (${left!.from}–${left!.to}). One of the two rules is reading the measure differently; check both before quoting either.`
          : `A concern and a positive signal are both reported on ${measure}, measured over different windows`
            + `${left ? ` (${left.from}–${left.to})` : ''}${right ? ` and (${right.from}–${right.to})` : ''}`
            + '. Both can be true; quote the window with the claim.',
        findings: [
          { id: flag.id, title: flag.title, sentiment: flag.sentiment, ...(left ? { window: left } : {}) },
          { id: signal.id, title: signal.title, sentiment: signal.sentiment, ...(right ? { window: right } : {}) },
        ],
      });
    }
  }
  return out;
}
