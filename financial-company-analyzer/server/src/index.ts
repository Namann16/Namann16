import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();

  // A port clash is the most common startup failure in development, and the default Node trace
  // buries that fact under a stack. Say what happened and what to do about it.
  const server = app.listen(config.PORT, () => {
    console.log(`[api] Financial Company Analyzer API listening on http://localhost:${config.PORT}`);
    console.log(`[api] Environment: ${config.NODE_ENV} · Storage: ${config.hasDatabase ? 'MongoDB' : 'in-memory'} · LLM narrative: ${config.hasLlm ? 'configured' : 'off (deterministic templates)'}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n[api] Port ${config.PORT} is already in use. Stop whatever is listening on it, or set PORT to a free port in .env.\n`,
      );
    } else if (error.code === 'EACCES') {
      console.error(`\n[api] Permission denied binding port ${config.PORT}. Choose a port above 1024 in .env.\n`);
    } else {
      console.error('[api] Server error:', error);
    }
    process.exit(1);
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
