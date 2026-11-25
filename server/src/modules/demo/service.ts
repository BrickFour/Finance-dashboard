import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { nowIso } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { importWorkbooks, type WorkbookFile } from '../imports/bulk.js';
import { refreshAlerts } from '../alerts/service.js';
import { SAMPLE_COMPANY_ID } from './constants.js';

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
 * Creates the read-only sample company from the bundled demo workbooks, once.
 *
 * It goes through the same bulk-import pipeline a user's upload does, then
 * confirms the suggested account mappings so the statements have something to
 * read. Every user can view it; it is shown in place of a company that has no
 * imported data yet, so a new client sees what the product does straight away.
 * Set DEMO_DATA=false to turn it off.
 */
export async function ensureSampleCompany(): Promise<void> {
  if ((process.env.DEMO_DATA ?? 'true').toLowerCase() === 'false') return;

  const existing = await db('companies').where({ id: SAMPLE_COMPANY_ID }).first();
  if (existing) {
    const hasVouchers = await db('vouchers').where({ company_id: SAMPLE_COMPANY_ID }).first();
    if (hasVouchers) return;
    // An earlier attempt left an empty shell; rebuild it so the demo always has figures.
    logger.warn('Sample company exists without data; rebuilding it.');
    await removeSampleCompany();
  }

  const admin = await db('users').where({ role: 'admin' }).orderBy('created_at').first();
  if (!admin) {
    logger.warn('Sample company not created: no administrator exists yet. Run "npm run seed" first.');
    return;
  }

  const loaded = loadSampleWorkbooks();
  if (!loaded) {
    logger.warn(`Sample company not created: neither ${ZIP_NAME} nor a ${FOLDER_NAME}/ folder was found.`);
    return;
  }

  const now = nowIso();
  // Fixed, like the company id, so a page's selected year still resolves on
  // another freshly built database (one per serverless instance).
  const fyId = `${SAMPLE_COMPANY_ID}-fy-2026-27`;
  await db('companies').insert({
    id: SAMPLE_COMPANY_ID,
    name: 'Sample Company (Demo)',
    entity_type: 'private_limited',
    currency: 'INR',
    currency_scale: 2,
    country: 'India',
    is_demo: true,
    is_active: true,
    created_by: admin.id,
    created_at: now,
    updated_at: now,
  });
  await db('financial_years').insert({
    id: fyId,
    company_id: SAMPLE_COMPANY_ID,
    label: 'FY 2026-27',
    start_date: '2026-04-01',
    end_date: '2027-03-31',
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  try {
    const { results } = await importWorkbooks(loaded.files, {
      companyId: SAMPLE_COMPANY_ID,
      financialYearId: fyId,
      userId: admin.id,
      duplicateStrategy: 'skip',
    });

    // The demo should open on finished statements, not on a mapping to-do list.
    await db('account_mappings')
      .where({ company_id: SAMPLE_COMPANY_ID, status: 'suggested' })
      .whereNotNull('category_key')
      .update({ status: 'confirmed', confirmed_by: admin.id, confirmed_at: now, updated_at: now });

    // The company-details workbook renames the company; keep it clearly marked as sample data.
    const company = await db('companies').where({ id: SAMPLE_COMPANY_ID }).first();
    if (company && !/demo|sample/i.test(company.name)) {
      await db('companies').where({ id: SAMPLE_COMPANY_ID }).update({ name: `${company.name} (Demo)` });
    }

    await refreshAlerts(SAMPLE_COMPANY_ID).catch(() => undefined);

    const imported = results.filter((r) => r.status === 'imported');
    const failed = results.filter((r) => r.status !== 'imported');
    logger.info(`Sample company created from ${path.basename(loaded.source)}: ${imported.length} file(s) imported`, {
      records: imported.reduce((s, r) => s + r.inserted + r.updated, 0),
      notImported: failed.map((r) => `${r.fileName}: ${r.message}`),
    });
  } catch (err) {
    // A half-built sample is worse than none; remove it so the next start retries.
    await removeSampleCompany().catch(() => undefined);
    throw err;
  }
}

/** Deletes the sample company and everything in it. Voucher lines go first: they hold a RESTRICT key on ledgers. */
export async function removeSampleCompany(): Promise<void> {
  await db('voucher_lines').where({ company_id: SAMPLE_COMPANY_ID }).del();
  await db('companies').where({ id: SAMPLE_COMPANY_ID }).del();
}
