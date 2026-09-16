import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Secrets are read here and here only. Nothing in this object is ever serialised to a client
 * response, and no key is compiled into the frontend bundle.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Omit to run entirely in memory — useful for evaluation without a database. */
  MONGODB_URI: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /** Optional. When absent the application uses deterministic insight templates only. */
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_BASE_URL: z.string().default('https://api.anthropic.com/v1/messages'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const config = {
  ...env,
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
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    environment: config.NODE_ENV,
  };
}
