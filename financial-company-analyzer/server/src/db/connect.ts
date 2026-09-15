import mongoose from 'mongoose';
import { config } from '../config/env.js';

let connected = false;

/**
 * Connect to MongoDB when a URI is configured.
 *
 * The application is deliberately usable without a database: analyses can be run against data
 * posted directly to the API, and the repository layer falls back to in-memory storage. This
 * keeps the tool evaluable without infrastructure while remaining persistent in real use.
 */
export async function connectDatabase(): Promise<boolean> {
  if (!config.MONGODB_URI) {
    console.warn('[db] MONGODB_URI is not set — running with in-memory storage. Data will not survive a restart.');
    return false;
  }
  if (connected) return true;

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    connected = true;
    console.log('[db] Connected to MongoDB.');
    return true;
  } catch (error) {
    console.error('[db] Could not connect to MongoDB:', (error as Error).message);
    console.warn('[db] Falling back to in-memory storage for this process.');
    return false;
  }
}

export function isDatabaseConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}

export async function disconnectDatabase(): Promise<void> {
  if (connected) {
    await mongoose.disconnect();
    connected = false;
  }
}
