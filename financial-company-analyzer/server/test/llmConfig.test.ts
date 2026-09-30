import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Model resolution across providers.
 *
 * Each of these was a real misconfiguration found by running the server, not a hypothetical. They
 * share a failure mode: the language feature silently falls back to the engine and the log blames
 * the API key, so the actual cause — a model name from the wrong provider, or a variable that is
 * present but empty — is invisible.
 */

/** Load a fresh copy of the config module under a given environment. */
async function loadConfig(vars: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return (await import('../src/config/env.js')).config;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the default model follows the provider', () => {
  it('picks a Claude model for anthropic', async () => {
    const config = await loadConfig({ LLM_PROVIDER: undefined, LLM_MODEL: undefined, LLM_API_KEY: 'k' });
    expect(config.LLM_PROVIDER).toBe('anthropic');
    expect(config.LLM_MODEL).toMatch(/^claude/);
  });

  it('picks a strict-mode-capable model for groq', async () => {
    const config = await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: undefined, LLM_API_KEY: 'k' });
    expect(config.LLM_PROVIDER).toBe('groq');
    // Strict mode is what makes the schema a guarantee, so the default must be a model that has it.
    expect(config.LLM_MODEL).toBe('openai/gpt-oss-120b');
    expect(config.LLM_MODEL).not.toMatch(/^claude/);
  });

  it('still honours an explicit model — config is never silently overridden', async () => {
    const config = await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: 'moonshotai/kimi-k2-instruct', LLM_API_KEY: 'k' });
    expect(config.LLM_MODEL).toBe('moonshotai/kimi-k2-instruct');
  });
});

describe('a present-but-empty variable counts as unset', () => {
  // Clearing a field in a hosting dashboard leaves "" behind, which is not the same as removing it.
  it('falls back to the provider default when LLM_MODEL is empty', async () => {
    const config = await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: '', LLM_API_KEY: 'k' });
    expect(config.LLM_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('treats whitespace as empty too', async () => {
    const config = await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: '   ', LLM_API_KEY: 'k' });
    expect(config.LLM_MODEL).toBe('openai/gpt-oss-120b');
  });

  it('does not refuse to boot when LLM_PROVIDER is empty', async () => {
    const config = await loadConfig({ LLM_PROVIDER: '', LLM_MODEL: '', LLM_API_KEY: 'k' });
    expect(config.LLM_PROVIDER).toBe('anthropic');
    expect(config.LLM_MODEL).toMatch(/^claude/);
  });
});

describe('a model from the wrong provider is called out at startup', () => {
  it('warns when a Claude model is configured against groq', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: 'claude-opus-5', LLM_API_KEY: 'k' });
    const message = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('claude-opus-5');
    expect(message).toContain('groq');
    // The warning has to say what to do about it, or it is just noise.
    expect(message).toMatch(/openai\/gpt-oss-120b/);
  });

  it('warns when a non-Claude model is configured against anthropic', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadConfig({ LLM_PROVIDER: 'anthropic', LLM_MODEL: 'openai/gpt-oss-120b', LLM_API_KEY: 'k' });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('does not look like a anthropic model');
  });

  it('stays quiet when the pairing is right', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: 'openai/gpt-oss-120b', LLM_API_KEY: 'k' });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/does not look like/);
  });

  it('stays quiet with no key, since nothing will be called', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadConfig({ LLM_PROVIDER: 'groq', LLM_MODEL: 'claude-opus-5', LLM_API_KEY: undefined });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/does not look like/);
  });
});
