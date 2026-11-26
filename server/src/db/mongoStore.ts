import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Binary, MongoClient, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import { db } from './index.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * MongoDB as the durable store.
 *
 * The application keeps working against its SQL database (SQLite here), which
 * every query, report and import is written for. MongoDB holds the lasting copy:
 * one collection per table, one document per row, keyed by the row's primary key.
 *
 *  - On start, the SQL database is loaded from MongoDB (when MongoDB has data).
 *  - Every insert, update or delete marks its table; before a response is sent,
 *    the rows of marked tables that changed are written to MongoDB (row by row, so
 *    one instance never overwrites another's unrelated changes).
 *  - A version counter in the `_meta` collection tells an instance that another
 *    one has written, and it reloads before serving the next request.
 *
 * Enabled by MONGO_URI (database name from MONGO_DB_NAME). Only used with SQLite;
 * a Postgres database is durable on its own.
 */

const META = '_meta';
const STATE_ID = 'state';
const FRESHNESS_CHECK_MS = 3000;

let client: MongoClient | null = null;
let mdb: Db | null = null;
let knownVersion = -1;
let lastCheck = 0;
let reloading: Promise<void> | null = null;

const dirty = new Set<string>();
/** table → (row key → row hash) as last written to / read from MongoDB. */
const snapshot = new Map<string, Map<string, string>>();
type TableInfo = { name: string; columns: string[]; pk: string[]; deps: string[] };
let tableInfo: TableInfo[] | null = null;
let suspendTracking = false;

/** Set when MongoDB could not be reached at start; this instance then runs on its local copy only. */
let unavailable = false;

export function mongoEnabled(): boolean {
  return !unavailable && Boolean(process.env.MONGO_URI) && env.db.client === 'sqlite3';
}

function disableAfter(err: unknown): void {
  unavailable = true;
  const message = (err instanceof Error ? err.message : String(err)).replace(/mongodb(\+srv)?:\/\/[^@\s]+@/g, 'mongodb://***@');
  const hint = /SSL|TLS|alert|ENOTFOUND|timed out|Server selection/i.test(message)
    ? ' This usually means MongoDB Atlas is not accepting connections from this server: allow its IP address (on Vercel, 0.0.0.0/0) under Network Access.'
    : '';
  logger.error(`MongoDB is not reachable; running on the local database only, and changes will not be kept.${hint}`, { error: message });
  void closeMongo();
}

async function mongo(): Promise<Db> {
  if (mdb) return mdb;
  client = new MongoClient(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 15000, maxPoolSize: 5 });
  await client.connect();
  mdb = client.db(process.env.MONGO_DB_NAME || 'brickfour_finance');
  return mdb;
}

export async function closeMongo(): Promise<void> {
  await client?.close().catch(() => undefined);
  client = null;
  mdb = null;
}

/* ---------------------------------------------------------------- tracking */

let tracking = false;
function startTracking(): void {
  if (tracking) return;
  tracking = true;
  db.on('query', (q: { sql?: string }) => {
    if (suspendTracking || !q.sql) return;
    const m = /^\s*(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from|replace\s+into)\s+[`"[]?(\w+)/i.exec(q.sql);
    if (m && !m[1]!.startsWith('knex_')) dirty.add(m[1]!);
  });
}

/* ------------------------------------------------------------ table schema */

async function tables(): Promise<TableInfo[]> {
  if (tableInfo) return tableInfo;
  const names: { name: string }[] = await db.raw(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%' ORDER BY name",
  );
  const info: TableInfo[] = [];
  for (const { name } of names) {
    const cols: { name: string; pk: number }[] = await db.raw(`PRAGMA table_info("${name}")`);
    const fks: { table: string }[] = await db.raw(`PRAGMA foreign_key_list("${name}")`);
    info.push({
      name,
      columns: cols.map((c) => c.name),
      pk: cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name),
      deps: [...new Set(fks.map((f) => f.table).filter((t) => t !== name))],
    });
  }
  // Parents before children, so inserts satisfy foreign keys in order.
  const ordered: typeof info = [];
  const seen = new Set<string>();
  const visit = (t: (typeof info)[number], stack = new Set<string>()) => {
    if (seen.has(t.name) || stack.has(t.name)) return;
    stack.add(t.name);
    for (const d of t.deps) {
      const dep = info.find((x) => x.name === d);
      if (dep) visit(dep, stack);
    }
    seen.add(t.name);
    ordered.push(t);
  };
  info.forEach((t) => visit(t));
  tableInfo = ordered;
  return ordered;
}

/* ------------------------------------------------------------ row helpers */

function hashValue(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return `b64:${v.toString('base64')}`;
  return v;
}

function rowKey(row: Record<string, unknown>, pk: string[]): string {
  if (pk.length) return pk.map((c) => String(row[c])).join('\u0001');
  return rowHash(row);
}

function rowHash(row: Record<string, unknown>): string {
  const plain = Object.keys(row)
    .sort()
    .map((k) => [k, hashValue(row[k])]);
  return createHash('sha1').update(JSON.stringify(plain)).digest('base64');
}

function fromMongo(doc: Document, columns: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of columns) {
    if (!(c in doc)) continue;
    const v = doc[c];
    row[c] = v instanceof Binary ? Buffer.from(v.buffer) : v;
  }
  return row;
}

async function readTable(name: string, pk: string[]): Promise<Map<string, { hash: string; row: Record<string, unknown> }>> {
  const rows: Record<string, unknown>[] = await db(name).select('*');
  const out = new Map<string, { hash: string; row: Record<string, unknown> }>();
  for (const row of rows) out.set(rowKey(row, pk), { hash: rowHash(row), row });
  return out;
}

/* ------------------------------------------------------------------ restore */

/**
 * Replaces the SQL database's contents with what MongoDB holds.
 * Returns false (and changes nothing) when MongoDB has never been written to.
 */
export async function restoreFromMongo(): Promise<boolean> {
  if (!mongoEnabled()) return false;
  startTracking();
  const m = await mongo();
  const state = await m.collection(META).findOne({ _id: STATE_ID as never });
  if (!state) return false;

  const info = await tables();
  const data = new Map<string, Record<string, unknown>[]>();
  await Promise.all(
    info.map(async (t) => {
      const docs = await m.collection(t.name).find({}).toArray();
      data.set(t.name, docs.map((d) => fromMongo(d, t.columns)));
    }),
  );

  suspendTracking = true;
  try {
    await db.transaction(async (trx) => {
      await trx.raw('PRAGMA defer_foreign_keys = ON');
      for (const t of [...info].reverse()) await trx(t.name).del();
      for (const t of info) {
        const rows = data.get(t.name) ?? [];
        if (!rows.length) continue;
        // SQLite caps a multi-row insert at 500 rows and ~32k bound values.
        const chunk = Math.max(1, Math.min(400, Math.floor(30000 / Math.max(1, t.columns.length))));
        for (let i = 0; i < rows.length; i += chunk) await trx(t.name).insert(rows.slice(i, i + chunk));
      }
    });
  } finally {
    suspendTracking = false;
  }

  dirty.clear();
  snapshot.clear();
  for (const t of info) {
    const current = await readTable(t.name, t.pk);
    snapshot.set(t.name, new Map([...current].map(([k, v]) => [k, v.hash])));
  }
  knownVersion = Number(state.version ?? 0);
  lastCheck = Date.now();
  const total = [...data.values()].reduce((s, r) => s + r.length, 0);
  logger.info(`Loaded ${total} rows in ${info.length} tables from MongoDB (version ${knownVersion})`);
  return true;
}

/* -------------------------------------------------------------------- flush */

let flushing: Promise<void> = Promise.resolve();

/** Writes the changed rows of the given tables (default: every marked table) to MongoDB. */
export function flushToMongo(all = false): Promise<void> {
  if (!mongoEnabled()) return Promise.resolve();
  // Serialise flushes so two requests never write the same table at once.
  flushing = flushing.then(() => doFlush(all)).catch((err) => {
    logger.error('Saving to MongoDB failed', { error: err instanceof Error ? err.message : String(err) });
  });
  return flushing;
}

async function doFlush(all: boolean): Promise<void> {
  startTracking();
  const info = await tables();
  const names = all ? info.map((t) => t.name) : [...dirty];
  dirty.clear();
  if (!names.length) return;

  const m = await mongo();
  let written = 0;
  for (const t of info.filter((x) => names.includes(x.name))) {
    const current = await readTable(t.name, t.pk);
    const prev = snapshot.get(t.name) ?? new Map<string, string>();
    const ops: AnyBulkWriteOperation<Document>[] = [];
    for (const [key, { hash, row }] of current) {
      if (prev.get(key) !== hash) {
        ops.push({ replaceOne: { filter: { _id: key as never }, replacement: { ...row }, upsert: true } });
      }
    }
    for (const key of prev.keys()) {
      if (!current.has(key)) ops.push({ deleteOne: { filter: { _id: key as never } } });
    }
    for (let i = 0; i < ops.length; i += 1000) {
      await m.collection(t.name).bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
    written += ops.length;
    snapshot.set(t.name, new Map([...current].map(([k, v]) => [k, v.hash])));
  }

  // Only a real change moves the version; otherwise every cold start would make the other instances reload.
  if (written > 0) {
    const state = await m
      .collection(META)
      .findOneAndUpdate(
        { _id: STATE_ID as never },
        { $inc: { version: 1 }, $set: { updatedAt: new Date().toISOString() } },
        { upsert: true, returnDocument: 'after' },
      );
    knownVersion = Number(state?.version ?? knownVersion + 1);
    lastCheck = Date.now();
  }
}

/** Creates any collection that does not exist yet, so every table has its collection even when empty. */
export async function ensureCollections(): Promise<void> {
  if (!mongoEnabled()) return;
  const m = await mongo();
  const existing = new Set((await m.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const t of await tables()) {
    if (!existing.has(t.name)) await m.createCollection(t.name).catch(() => undefined);
  }
}

/* ----------------------------------------------------------------- bootstrap */

/**
 * Call after migrations: loads the database from MongoDB when it has data.
 * Then seed / build the sample companies as usual, then call `persistBootstrap`.
 */
export async function loadFromMongoOnStart(): Promise<boolean> {
  if (!mongoEnabled()) {
    if (process.env.MONGO_URI) logger.warn('MONGO_URI is set but ignored: MongoDB storage is used with SQLite only.');
    return false;
  }
  startTracking();
  try {
    return await restoreFromMongo();
  } catch (err) {
    disableAfter(err);
    return false;
  }
}

/** Call after seeding: writes anything new (on a first run, everything) to MongoDB. */
export async function persistBootstrap(): Promise<void> {
  if (!mongoEnabled()) return;
  try {
    await ensureCollections();
    await flushToMongo(true);
  } catch (err) {
    disableAfter(err);
  }
}

/* ---------------------------------------------------------------- middleware */

/**
 * Reloads first when another instance has written, and holds each response
 * until this request's changes are in MongoDB (on serverless hosts the process
 * may be frozen as soon as the response is sent).
 */
export function mongoMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!mongoEnabled()) return next();

  const proceed = () => {
    const end = res.end.bind(res) as (...args: unknown[]) => Response;
    (res as unknown as { end: (...args: unknown[]) => Response }).end = (...args: unknown[]) => {
      if (dirty.size === 0) return end(...args);
      void flushToMongo().finally(() => end(...args));
      return res;
    };
    next();
  };

  if (Date.now() - lastCheck < FRESHNESS_CHECK_MS) return proceed();
  lastCheck = Date.now();
  void (async () => {
    try {
      const m = await mongo();
      const state = await m.collection(META).findOne({ _id: STATE_ID as never });
      if (state && Number(state.version) !== knownVersion && dirty.size === 0) {
        reloading ??= restoreFromMongo()
          .then(() => undefined)
          .finally(() => {
            reloading = null;
          });
        await reloading;
      }
    } catch (err) {
      logger.warn('MongoDB freshness check failed; serving from the local copy', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    proceed();
  })();
}
