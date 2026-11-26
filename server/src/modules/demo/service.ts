import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { nowIso } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { importWorkbooks, type WorkbookFile } from '../imports/bulk.js';
import { refreshAlerts } from '../alerts/service.js';
import { SAMPLE_COMPANY_ID, SAMPLE_COMPANY_IDS } from './constants.js';
import { SAMPLE_VARIANTS, buildVariantWorkbooks } from './variants.js';

const ZIP_NAME = 'dhyeya-demo-data.zip';
const FOLDER_NAME = 'demo-data';

/** Where the sample workbooks may live: an explicit path, then the repo root, then the server root. */
function candidateRoots(): string[] {
  const roots = [path.resolve(env.serverRoot, '..'), env.serverRoot, process.cwd(), path.resolve(process.cwd(), '..')];
  return [...new Set(roots)];
}

/** Reads the sample workbooks, preferring the zip and falling back to the unpacked folder. */
export function loadSampleWorkbooks(): { files: WorkbookFile[]; source: string } | null {
  const explicit = process.env.DEMO_DATA_PATH;
  const zips = explicit ? [explicit] : candidateRoots().map((r) => path.join(r, ZIP_NAME));
  const folders = explicit ? [explicit] : candidateRoots().map((r) => path.join(r, FOLDER_NAME));

  for (const zipPath of zips) {
    if (!zipPath.toLowerCase().endsWith('.zip') || !fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) continue;
    const container = XLSX.CFB.read(fs.readFileSync(zipPath), { type: 'buffer' });
    const files: WorkbookFile[] = [];
    container.FileIndex.forEach((entry: { type: number; name: string; content?: unknown }) => {
      if (entry.type !== 2 || !/\.xlsx?$/i.test(entry.name) || !entry.content) return;
      const buffer = Buffer.from(entry.content as Uint8Array);
      files.push({ originalname: entry.name, buffer, size: buffer.length });
    });
    if (files.length) return { files, source: zipPath };
  }

  for (const dir of folders) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const files = fs
      .readdirSync(dir)
      .filter((n) => /\.xlsx?$/i.test(n))
      .sort()
      .map((n) => {
        const buffer = fs.readFileSync(path.join(dir, n));
        return { originalname: n, buffer, size: buffer.length };
      });
    if (files.length) return { files, source: dir };
  }

  return null;
}

/**
 * Creates the read-only sample companies from the bundled demo workbooks, once.
 *
 * The first is imported from the workbooks as they are; the others are derived
 * from them with their own names and figures (variants.ts). Each goes through
 * the same bulk-import pipeline a user's upload does, then its suggested account
 * mappings are confirmed so the statements have something to read. Every user
 * can view them; a company with no imported data yet shows the first one in its
 * place. Set DEMO_DATA=false to turn them off.
 */
export async function ensureSampleCompany(): Promise<void> {
  if ((process.env.DEMO_DATA ?? 'true').toLowerCase() === 'false') return;

  const admin = await db('users').where({ role: 'admin' }).orderBy('created_at').first();
  if (!admin) {
    logger.warn('Sample companies not created: no administrator exists yet. Run "npm run seed" first.');
    return;
  }

  let loaded: ReturnType<typeof loadSampleWorkbooks> | undefined;
  const workbooks = () => {
    if (loaded === undefined) loaded = loadSampleWorkbooks();
    return loaded;
  };

  const specs = [
    { id: SAMPLE_COMPANY_ID, name: 'Sample Company', build: (files: WorkbookFile[]) => files },
    ...SAMPLE_VARIANTS.map((v) => ({ id: v.id, name: v.name, build: (files: WorkbookFile[]) => buildVariantWorkbooks(files, v) })),
  ];

  for (const spec of specs) {
    const existing = await db('companies').where({ id: spec.id }).first();
    if (existing) {
      if (await db('vouchers').where({ company_id: spec.id }).first()) continue;
      // An earlier attempt left an empty shell; rebuild it so the demo always has figures.
      logger.warn(`Sample company ${spec.id} exists without data; rebuilding it.`);
      await removeSampleCompany(spec.id);
    }

    const source = workbooks();
    if (!source) {
      logger.warn(`Sample companies not created: neither ${ZIP_NAME} nor a ${FOLDER_NAME}/ folder was found.`);
      return;
    }

    try {
      await buildSampleCompany(spec.id, spec.name, spec.build(source.files), admin.id);
    } catch (err) {
      // The first sample is what an empty company falls back to, so its failure is fatal;
      // a derived one is only logged, and the next start tries again.
      if (spec.id === SAMPLE_COMPANY_ID) throw err;
      logger.error(`Sample company ${spec.name} could not be built`, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function buildSampleCompany(id: string, name: string, files: WorkbookFile[], adminId: string): Promise<void> {
  const now = nowIso();
  // Fixed, like the company id, so a page's selected year still resolves on
  // another freshly built database (one per serverless instance).
  const fyId = `${id}-fy-2026-27`;
  await db('companies').insert({
    id,
    name,
    entity_type: 'private_limited',
    currency: 'INR',
    currency_scale: 2,
    country: 'India',
    is_demo: true,
    is_active: true,
    created_by: adminId,
    created_at: now,
    updated_at: now,
  });
  await db('financial_years').insert({
    id: fyId,
    company_id: id,
    label: 'FY 2026-27',
    start_date: '2026-04-01',
    end_date: '2027-03-31',
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  try {
    const { results } = await importWorkbooks(files, {
      companyId: id,
      financialYearId: fyId,
      userId: adminId,
      duplicateStrategy: 'skip',
    });

    // The demo should open on finished statements, not on a mapping to-do list.
    await db('account_mappings')
      .where({ company_id: id, status: 'suggested' })
      .whereNotNull('category_key')
      .update({ status: 'confirmed', confirmed_by: adminId, confirmed_at: now, updated_at: now });

    await refreshAlerts(id).catch(() => undefined);

    const company = await db('companies').where({ id }).first();
    const imported = results.filter((r) => r.status === 'imported');
    const failed = results.filter((r) => r.status !== 'imported');
    logger.info(`Sample company "${company?.name ?? name}" created: ${imported.length} file(s) imported`, {
      records: imported.reduce((s, r) => s + r.inserted + r.updated, 0),
      notImported: failed.map((r) => `${r.fileName}: ${r.message}`),
    });
  } catch (err) {
    // A half-built sample is worse than none; remove it so the next start retries.
    await removeSampleCompany(id).catch(() => undefined);
    throw err;
  }
}

/**
 * Deletes one sample company (or, without an id, all of them) and everything in it.
 * Voucher lines go first: they hold a RESTRICT key on ledgers.
 */
export async function removeSampleCompany(id?: string): Promise<void> {
  const ids = id ? [id] : SAMPLE_COMPANY_IDS;
  await db('voucher_lines').whereIn('company_id', ids).del();
  await db('companies').whereIn('id', ids).del();
}
