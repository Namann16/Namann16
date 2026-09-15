import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`[api] Financial Company Analyzer API listening on http://localhost:${config.PORT}`);
    console.log(`[api] Environment: ${config.NODE_ENV} · Storage: ${config.hasDatabase ? 'MongoDB' : 'in-memory'} · LLM narrative: ${config.hasLlm ? 'configured' : 'off (deterministic templates)'}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[api] ${signal} received, shutting down.`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Do not hang indefinitely if a connection refuses to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] Failed to start:', error);
  process.exit(1);
});
