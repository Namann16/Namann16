import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The Groq request path, pinned without a network.
 *
 * api.groq.com is unreachable from the environment this was written in, so none of it could be
 * driven against the real API. `fetch` is stubbed instead, which still verifies the two things that
 * actually break in a provider adapter: that the request body is the shape the API requires, and
 * that every reply that is not a usable object becomes a skip rather than an exception or, worse,
 * a half-trusted value.
 *
 * What this cannot prove: that Groq accepts the schema, that the chosen model honours strict mode,
 * and that the reply satisfies it. Those need one live call.
 */

// config reads process.env once, at import, so the provider must be set before the module loads.
process.env.LLM_API_KEY = 'test-key-not-real';
process.env.LLM_PROVIDER = 'groq';
process.env.LLM_MODEL = 'openai/gpt-oss-120b';

type Llm = typeof import('../src/services/llm.js');
let llm: Llm;

beforeAll(async () => {
  llm = await import('../src/services/llm.js');
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: { verdict: { type: 'string' } },
} as const;

const request = () => ({
  system: 'You judge things.',
  user: 'Judge this.',
  schemaName: 'judgement',
  schema: SCHEMA as unknown as Record<string, unknown>,
  maxTokens: 800,
});

/** A Groq-shaped success reply. */
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function choice(message: unknown, finish_reason = 'stop') {
  return { model: 'openai/gpt-oss-120b', choices: [{ finish_reason, message }] };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the request Groq receives', () => {
  it('is an OpenAI-shaped chat completion asking for a strict json_schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(choice({ content: '{"verdict":"fine"}' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await llm.completeStructured(request());
    expect(result.ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key-not-real');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('openai/gpt-oss-120b');
    // Strict mode is the whole reason a schema is worth sending.
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'judgement', strict: true, schema: SCHEMA },
    });
    // Same wording twice for the same input, as far as the API allows.
    expect(body.temperature).toBe(0);
    // OpenAI-shaped APIs take max_completion_tokens, not Anthropic's max_tokens.
    expect(body.max_completion_tokens).toBe(800);
    expect(body.max_tokens).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'system', content: 'You judge things.' },
      { role: 'user', content: 'Judge this.' },
    ]);
    // Anthropic-only fields must not leak into a Groq request.
    expect(body.output_config).toBeUndefined();
    expect(body.system).toBeUndefined();
  });

  it('returns the parsed object and the model that answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(choice({ content: '{"verdict":"ok"}' }))));
    const result = await llm.completeStructured(request());
    expect(result).toEqual({ ok: true, value: { verdict: 'ok' }, model: 'openai/gpt-oss-120b' });
  });
});

describe('every unusable reply becomes a skip, never an exception', () => {
  const cases: [string, () => unknown, 'api_error' | 'refused' | 'unparsable'][] = [
    ['a rejected key (401)', () => reply({ error: 'bad key' }, 401), 'api_error'],
    ['a forbidden key (403)', () => reply({ error: 'forbidden' }, 403), 'api_error'],
    ['an unsupported schema (400)', () => reply({ error: 'schema' }, 400), 'api_error'],
    ['a server fault (500)', () => reply({ error: 'boom' }, 500), 'api_error'],
    ['an explicit refusal field', () => reply(choice({ refusal: 'I will not.' })), 'refused'],
    ['a content_filter finish', () => reply(choice({ content: null }, 'content_filter')), 'refused'],
    ['a truncated reply', () => reply(choice({ content: '{"verdict":' }, 'length')), 'unparsable'],
    ['prose instead of JSON', () => reply(choice({ content: 'Sure! Here you go.' })), 'unparsable'],
    ['empty content', () => reply(choice({ content: '   ' })), 'unparsable'],
    ['null content', () => reply(choice({ content: null })), 'unparsable'],
    ['no choices at all', () => reply({ model: 'x', choices: [] }), 'unparsable'],
    ['a body that is not JSON', () => new Response('<html>502</html>', { status: 200 }), 'unparsable'],
  ];

  for (const [name, make, expected] of cases) {
    it(`maps ${name} to ${expected}`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
      const result = await llm.completeStructured(request());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expected);
    });
  }

  it('maps an unreachable host to api_error rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const result = await llm.completeStructured(request());
    expect(result).toMatchObject({ ok: false, reason: 'api_error' });
  });

  it('maps a timeout to api_error rather than throwing', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const result = await llm.completeStructured(request());
    expect(result).toMatchObject({ ok: false, reason: 'api_error' });
  });

  it('never sends the analysis anywhere when no key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Re-import with the key removed, so config.hasLlm is false in that module instance.
    vi.resetModules();
    const saved = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const fresh = await import('../src/services/llm.js');
      const result = await fresh.completeStructured(request());
      expect(result).toEqual({ ok: false, reason: 'not_configured' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.LLM_API_KEY = saved;
      vi.resetModules();
    }
  });
});
