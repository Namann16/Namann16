import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';

/**
 * The one place that knows which language-model API is configured.
 *
 * Both callers — the narrative layer and the import mapping review — need the same thing: send a
 * system prompt and a user message, get back an object matching a JSON Schema, and never throw.
 * Keeping that behind a single function means adding a provider does not touch either caller, and
 * neither caller can accidentally depend on a field only one API returns.
 *
 * Every failure is a value, not an exception. Callers fall back to the deterministic engine, so an
 * outage, a rejected key or a model that returns prose instead of an object must all be ordinary
 * return values rather than something to catch.
 *
 * On provider differences that matter here:
 *
 *   - Anthropic uses `messages.parse()` with `output_config.format`, and reports a declined request
 *     as `stop_reason: 'refusal'`. It also accepts `effort`, which has no equivalent elsewhere.
 *   - Groq speaks the OpenAI chat-completions shape at a different host and has no Anthropic
 *     `/v1/messages` endpoint, so pointing the Anthropic SDK at it does not work — this is a
 *     separate request, not a base-URL swap. Refusals arrive as `finish_reason: 'content_filter'`.
 *
 * Groq is called with `strict: true`, which uses constrained decoding so the reply is guaranteed to
 * match the schema. That guarantee only holds on the models that implement it; `DEFAULT_MODEL` in
 * config/env.ts picks one, and a model chosen by hand may silently downgrade to "best effort",
 * which this module treats as unparsable rather than trusting.
 */

/** Why no object came back. Callers map these onto their own skip reasons. */
export type LlmFailure = 'not_configured' | 'api_error' | 'refused' | 'unparsable';

export type LlmResult =
  | { ok: true; value: unknown; model: string }
  | { ok: false; reason: LlmFailure; detail?: string };

export interface StructuredRequest {
  system: string;
  user: string;
  /** Schema name, required by the OpenAI-shaped API and ignored by Anthropic. */
  schemaName: string;
  /** Raw JSON Schema. Must set additionalProperties:false and list every property in required. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Generous: a slow reply is still better than a lost one, and the caller degrades gracefully. */
const REQUEST_TIMEOUT_MS = 60_000;

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  anthropicClient ??= new Anthropic({ apiKey: config.LLM_API_KEY });
  return anthropicClient;
}

/** Short provider tag for log lines, so a failure names the API that produced it. */
function tag(): string {
  return `${config.LLM_PROVIDER}:${config.LLM_MODEL}`;
}

async function viaAnthropic(request: StructuredRequest): Promise<LlmResult> {
  try {
    const response = await anthropic().messages.parse({
      model: config.LLM_MODEL,
      max_tokens: request.maxTokens,
      system: request.system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
      messages: [{ role: 'user', content: request.user }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refused', detail: response.stop_details?.explanation ?? '' };
    }
    if (response.parsed_output == null) return { ok: false, reason: 'unparsable' };
    return { ok: true, value: response.parsed_output, model: response.model };
  } catch (error) {
    // Most specific first, so a misconfigured key is not logged as a rate limit.
    if (error instanceof Anthropic.AuthenticationError) {
      console.warn(`[llm ${tag()}] the API key was rejected.`);
    } else if (error instanceof Anthropic.RateLimitError) {
      console.warn(`[llm ${tag()}] rate limited.`);
    } else if (error instanceof Anthropic.APIError) {
      console.warn(`[llm ${tag()}] API error ${error.status}.`);
    } else {
      console.warn(`[llm ${tag()}] unexpected failure.`, error);
    }
    return { ok: false, reason: 'api_error' };
  }
}

async function viaGroq(request: StructuredRequest): Promise<LlmResult> {
  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        max_completion_tokens: request.maxTokens,
        // Deterministic as the API allows. The engine's verdicts do not depend on this, but two
        // runs over one file should not differ in wording for no reason.
        temperature: 0,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A blocked host, a DNS failure or the timeout above all land here.
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    console.warn(`[llm ${tag()}] ${reason}.`);
    return { ok: false, reason: 'api_error' };
  }

  if (!response.ok) {
    // The body often names the real problem — an unsupported schema, an unknown model — so keep a
    // bounded amount of it. Never log the request: it carries the analysis.
    const body = await response.text().catch(() => '');
    if (response.status === 401) {
      console.warn(`[llm ${tag()}] the API key was rejected.`);
    } else if (response.status === 403) {
      // A 403 here is ambiguous: the key may be refused, or an egress proxy may be refusing the
      // host. Saying "bad key" would send someone to rotate a key that was never the problem.
      console.warn(
        `[llm ${tag()}] refused with 403 — either the key lacks access, or the host is blocked by network policy.`,
      );
    } else {
      console.warn(`[llm ${tag()}] API error ${response.status}. ${body.slice(0, 300)}`);
    }
    return { ok: false, reason: 'api_error' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'unparsable' };
  }

  const choice = (payload as { choices?: unknown[] })?.choices?.[0] as
    | { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }
    | undefined;
  if (!choice) return { ok: false, reason: 'unparsable' };

  // An OpenAI-shaped API signals a declined request either with an explicit refusal field or with
  // this finish reason; treat both as a refusal rather than as malformed output.
  if (choice.message?.refusal) {
    return { ok: false, reason: 'refused', detail: choice.message.refusal };
  }
  if (choice.finish_reason === 'content_filter') return { ok: false, reason: 'refused' };
  // Truncation leaves a JSON fragment that would parse as nonsense or not at all. Say so plainly.
  if (choice.finish_reason === 'length') {
    console.warn(`[llm ${tag()}] the reply hit the token limit and was discarded.`);
    return { ok: false, reason: 'unparsable' };
  }

  const content = choice.message?.content;
  if (typeof content !== 'string' || content.trim() === '') return { ok: false, reason: 'unparsable' };

  try {
    // Strict mode should make this always succeed. It is still parsed defensively, because a model
    // without strict support returns prose here and that must be a skip, not a crash.
    return {
      ok: true,
      value: JSON.parse(content),
      model: (payload as { model?: string }).model ?? config.LLM_MODEL,
    };
  } catch {
    console.warn(`[llm ${tag()}] the reply was not valid JSON; the model may not support strict mode.`);
    return { ok: false, reason: 'unparsable' };
  }
}

/**
 * Ask the configured model for an object matching `schema`.
 *
 * Returns a failure value rather than throwing, for any reason at all.
 */
export async function completeStructured(request: StructuredRequest): Promise<LlmResult> {
  if (!config.hasLlm) return { ok: false, reason: 'not_configured' };
  return config.LLM_PROVIDER === 'groq' ? viaGroq(request) : viaAnthropic(request);
}
