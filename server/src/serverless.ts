/**
 * Entry point for serverless hosting (Vercel). There is no long-running process to
 * run `migrate` and `seed` before start, so the first request on each instance
 * does it: migrations, system categories and the first administrator, then the
 * demo company. Every step is idempotent, so a shared Postgres database is safe;
 * with the default /tmp SQLite each instance builds its own copy.
 */
import fs from 'node:fs';
import type { Express } from 'express';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { db, normalizeMigrationNames } from './db/index.js';
import { logger } from './lib/logger.js';
import { ensureSampleCompany } from './modules/demo/service.js';
import { loadFromMongoOnStart, persistBootstrap } from './db/mongoStore.js';

let ready: Promise<Express> | null = null;

async function bootstrap(): Promise<Express> {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await normalizeMigrationNames();
  await db.migrate.latest();
  // With MONGO_URI set, MongoDB holds the lasting data: load it before anything else.
  await loadFromMongoOnStart();
  await db.seed.run();
  try {
    await ensureSampleCompany();
  } catch (err) {
    logger.warn('The sample company could not be created.', { reason: err instanceof Error ? err.message : String(err) });
  }
  await persistBootstrap();
  return createApp();
}

export function getApp(): Promise<Express> {
  if (!ready) {
    // A failed start (for example a database that is not reachable yet) must be
    // retried on the next request, not cached for the life of the instance.
    ready = bootstrap().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
