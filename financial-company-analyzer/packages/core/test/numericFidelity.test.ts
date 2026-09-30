import { describe, expect, it } from 'vitest';
import { analyze, buildLlmFacts, checkNumericFidelity, collectNumbers } from '../src/index.js';
import { buildSampleDataset } from '../src/sample/apexConsumer.js';

/**
 * The guard that lets a language model near this application at all.
 *
 * The specification permits a model to rephrase findings and forbids it from producing figures.
 * An instruction in a prompt is a request, not a guarantee; this check is the guarantee, so it is
 * tested for both halves — it must not reject honest prose, and it must not pass an invented
 * number however plausible that number looks.
 */

const FACTS = { revenue: 1980.42, margin: 18.79, ratio: -4.7217, period: 'FY26', flags: [3] };

describe('numbers the engine computed are accepted', () => {
  it('accepts an exact figure', () => {
    expect(checkNumericFidelity('Revenue was 1980.42.', FACTS).ok).toBe(true);
  });

  it('accepts display rounding, which is how figures are actually written', () => {
    expect(checkNumericFidelity('The margin is 18.8%.', FACTS).ok).toBe(true);
    expect(checkNumericFidelity('Leverage is -4.72x.', FACTS).ok).toBe(true);
    expect(checkNumericFidelity('Revenue reached 1,980.', FACTS).ok).toBe(true);
  });

  it('accepts a period label', () => {
    expect(checkNumericFidelity('In FY26 the company grew.', FACTS).ok).toBe(true);
  });

  it('accepts small counting integers without demanding a source', () => {
    // "three issues", "the two pillars" — sentence construction, not reported figures.
    expect(checkNumericFidelity('There are 3 red flags across 2 pillars.', FACTS).ok).toBe(true);
  });
});

describe('numbers the engine never produced are rejected', () => {
  it('rejects a figure that is merely close', () => {
    const result = checkNumericFidelity('The margin is 18.9%.', FACTS);
    expect(result.ok).toBe(false);
    expect(result.unsupported[0]?.value).toBe(18.9);
  });

  it('rejects an invented figure and reports where it appeared', () => {
    const result = checkNumericFidelity('Free cash flow of 412.5 supports the dividend.', FACTS);
    expect(result.ok).toBe(false);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.context).toContain('412.5');
  });

  it('rejects a fabricated forecast, which is the failure that matters most', () => {
    const result = checkNumericFidelity('Revenue should reach 2,400 next year.', FACTS);
    expect(result.ok).toBe(false);
    expect(result.unsupported[0]?.value).toBe(2400);
  });

  it('catches every unsupported number, not just the first', () => {
    const result = checkNumericFidelity('Margins of 22.1% on revenue of 3,100.', FACTS);
    expect(result.unsupported.map((u) => u.value)).toEqual([22.1, 3100]);
  });
});

describe('the allowed set is built from engine output alone', () => {
  it('walks nested structures so a real figure is never rejected for being deep', () => {
    const found = collectNumbers({ a: [{ b: { c: 7.25 } }], d: 'value 91.3 here' });
    expect(found.has(7.25)).toBe(true);
    expect(found.has(91.3)).toBe(true);
  });

  it('admits prose written from a real analysis, and rejects one figure changed', () => {
    const facts = buildLlmFacts(analyze(buildSampleDataset()));
    const revenue = facts.metrics.find((m) => m.key === 'revenue')?.latest as number;
    expect(revenue).toBeGreaterThan(0);

    expect(checkNumericFidelity(`Revenue stands at ${revenue}.`, facts).ok).toBe(true);
    // One digit altered is all it takes.
    expect(checkNumericFidelity(`Revenue stands at ${revenue + 11}.`, facts).ok).toBe(false);
  });
});
