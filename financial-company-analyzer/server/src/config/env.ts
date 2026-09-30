import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Secrets are read here and here only. Nothing in this object is ever serialised to a client
 * response, and no key is compiled into the frontend bundle.
 */
/**
 * Treat an empty or whitespace-only variable as unset.
 *
 * Clearing a field in a hosting dashboard, or leaving `LLM_MODEL=` in a .env, sets the variable to
 * "" rather than removing it. Without this, `?? default` keeps the empty string and an optional
 * enum fails validation outright — so a blank field would either silently break a feature or refuse
 * to boot, where the obvious intent was "use the default".
 */
const optionalText = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), inner);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Omit to run entirely in memory — useful for evaluation without a database. */
  MONGODB_URI: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /** Optional. When absent the application uses deterministic insight templates only. */
  LLM_API_KEY: z.string().optional(),
  /**
   * Which API the key belongs to. Anthropic is the default because it is the only one whose
   * behaviour is verified end to end here; Groq is opt-in. See services/llm.ts.
   */
  LLM_PROVIDER: optionalText(z.enum(['anthropic', 'groq']).default('anthropic')),
  /** Left unset, a model appropriate to the provider is chosen — the two use different names. */
  LLM_MODEL: optionalText(z.string().optional()),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/**
 * Default model per provider. A Claude identifier means nothing to Groq and vice versa, so the
 * default follows the provider rather than being one shared string.
 *
 * The Groq default is a gpt-oss model because those are the ones that support strict mode, and
 * strict mode is what makes the response schema a guarantee rather than a request. A model without
 * it can return prose where an object was asked for, which this application discards — so a
 * different Groq model may quietly reduce the feature to its fallback.
 */
const DEFAULT_MODEL = {
  anthropic: 'claude-opus-5-5',
  groq: 'openai/gpt-oss-120b',
} as const;

const resolvedModel = env.LLM_MODEL ?? DEFAULT_MODEL[env.LLM_PROVIDER];

/**
 * An explicit LLM_MODEL always wins — silently overriding what someone configured is its own trap.
 * But a model name from the wrong provider is certainly a mistake, and it fails in a way that looks
 * like a bad key rather than a bad model, so it is called out at startup instead of being left to
 * be diagnosed from a 404. This is easy to hit by switching LLM_PROVIDER while an older
 * LLM_MODEL is still set in .env or in the deployment's environment.
 */
if (env.LLM_API_KEY && env.LLM_MODEL) {
  const looksAnthropic = /^claude/i.test(env.LLM_MODEL);
  const wrongForProvider = env.LLM_PROVIDER === 'groq' ? looksAnthropic : !looksAnthropic;
  if (wrongForProvider) {
    console.warn(
      `[config] LLM_MODEL="${env.LLM_MODEL}" does not look like a ${env.LLM_PROVIDER} model. ` +
        `The language features will fail and fall back to the engine. ` +
        `Unset LLM_MODEL to use the default for this provider (${DEFAULT_MODEL[env.LLM_PROVIDER]}), or set a ${env.LLM_PROVIDER} model name.`,
    );
  }
}

export const config = {
  ...env,
  LLM_MODEL: resolvedModel,
  /** True when a database is configured. The API degrades to in-memory storage when it is not. */
  hasDatabase: Boolean(env.MONGODB_URI),
  /** True when an LLM is configured. The analysis itself never depends on this. */
  hasLlm: Boolean(env.LLM_API_KEY),
  isProduction: env.NODE_ENV === 'production',
};

/** Safe subset of configuration that may be exposed to the client. */
export function publicConfig() {
  return {
    hasDatabase: config.hasDatabase,
    llmEnabled: config.hasLlm,
    llmProvider: config.LLM_PROVIDER,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    environment: config.NODE_ENV,
  };
}
