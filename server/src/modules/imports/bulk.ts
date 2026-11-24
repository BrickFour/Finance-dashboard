import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { env } from '../../config/env.js';
import { db, withTransaction } from '../../db/index.js';
import { newId, nowIso, sha256 } from '../../lib/ids.js';
import { writeJson } from '../../lib/json.js';
import { recordAudit } from '../audit/service.js';
import { getCategory } from './categories.js';
import { readWorkbook, summariseSheets, readSheet } from './workbook.js';
import { validateMapping, type ColumnMapping } from './mapper.js';
import { validateDataset } from './validator.js';
import { commitDataset, type DuplicateStrategy } from './committer.js';
import { detectCategory, IMPORT_ORDER } from './detect.js';

export interface WorkbookFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface BulkResult {
  fileName: string;
  sheetName: string | null;
  category: string | null;
  categoryLabel: string | null;
  confidence: number | null;
  status: 'imported' | 'skipped' | 'failed';
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  ledgersCreated: number;
  batchId: string | null;
  message: string;
}

export interface BulkImportArgs {
  companyId: string;
  financialYearId: string | null;
  userId: string;
  duplicateStrategy: DuplicateStrategy;
  /** Present for HTTP requests; used only to enrich the audit trail. */
  req?: Request;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function loadComparisonSets(companyId: string, categoryKey: string) {
  const ledgerRows = await db('ledgers').where({ company_id: companyId }).select('normalized_name');
  const knownLedgers = new Set(ledgerRows.map((r: { normalized_name: string }) => r.normalized_name));

  const existingKeys = new Set<string>();
  const keyTable: Record<string, string> = {
    vouchers: 'vouchers',
    receivables: 'receivables',
    payables: 'payables',
    expenses: 'expenses',
  };
  const table = keyTable[categoryKey];
  if (table) {
    const rows = await db(table).where({ company_id: companyId }).select('dedupe_key');
    for (const r of rows) existingKeys.add(r.dedupe_key);
  } else if (categoryKey === 'chart_of_accounts') {
    const { dedupeKey } = await import('../../lib/ids.js');
    for (const r of ledgerRows) existingKeys.add(dedupeKey(['ledger', r.normalized_name]));
  }

  return { knownLedgers, existingKeys };
}

/**
 * Imports many workbooks at once. Each sheet is matched to an import type from its
 * headings, mapped automatically, validated and imported in dependency order.
 * Used by the bulk-upload route and by the demo-company seeder, so both follow
 * exactly the same validation and commit path.
 */
export async function importWorkbooks(
  files: WorkbookFile[],
  args: BulkImportArgs,
): Promise<{ results: BulkResult[]; sheetsDetected: number }> {
  const { companyId, financialYearId, userId, duplicateStrategy, req } = args;

  const blank = (fileName: string, sheetName: string | null): BulkResult => ({
    fileName, sheetName, category: null, categoryLabel: null, confidence: null, status: 'skipped',
    inserted: 0, updated: 0, skipped: 0, rejected: 0, ledgersCreated: 0, batchId: null, message: '',
  });

  type Planned = {
    file: WorkbookFile;
    wb: ReturnType<typeof readWorkbook>;
    sheetName: string;
    categoryKey: string;
    mapping: ColumnMapping;
    confidence: number;
  };
  const results: BulkResult[] = [];
  const planned: Planned[] = [];

  // ---- 1. read every file and decide what each sheet is
  for (const file of files) {
    try {
      const wb = readWorkbook(file.buffer, file.originalname);
      const sheets = summariseSheets(wb).filter((s) => !s.isEmpty);
      if (!sheets.length) {
        results.push({ ...blank(file.originalname, null), message: 'No readable table was found. Check that the sheet has a heading row followed by data.' });
        continue;
      }
      for (const s of sheets) {
        const sheet = readSheet(wb, s.name);
        const hint = `${file.originalname.replace(/\.[^.]+$/, '')} ${sheets.length > 1 ? s.name : ''}`;
        const found = detectCategory(sheet, hint);
        if (!found) {
          results.push({
            ...blank(file.originalname, s.name),
            message: 'Could not tell what this sheet contains. Import it with the step-by-step wizard and choose the type yourself.',
          });
          continue;
        }
        planned.push({ file, wb, sheetName: s.name, categoryKey: found.categoryKey, mapping: found.mapping, confidence: found.confidence });
      }
    } catch (err) {
      results.push({ ...blank(file.originalname, null), status: 'failed', message: err instanceof Error ? err.message : 'The file could not be read.' });
    }
  }

  planned.sort(
    (a, b) =>
      IMPORT_ORDER.indexOf(a.categoryKey as (typeof IMPORT_ORDER)[number]) - IMPORT_ORDER.indexOf(b.categoryKey as (typeof IMPORT_ORDER)[number]) ||
      a.file.originalname.localeCompare(b.file.originalname),
  );

  // ---- 2. validate and import each, in dependency order
  const storedFiles = new Map<WorkbookFile, { path: string; checksum: string }>();
  for (const p of planned) {
    const category = getCategory(p.categoryKey);
    const row: BulkResult = {
      ...blank(p.file.originalname, p.sheetName),
      category: p.categoryKey,
      categoryLabel: category.label,
      confidence: p.confidence,
    };
    let batchId: string | null = null;

    try {
      let stored = storedFiles.get(p.file);
      if (!stored) {
        const dir = path.join(env.uploadDir, companyId);
        await fs.mkdir(dir, { recursive: true });
        const safeName = p.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
        const storedPath = path.join(dir, `${newId()}__${safeName}`);
        await fs.writeFile(storedPath, p.file.buffer, { mode: 0o600 });
        stored = { path: storedPath, checksum: sha256(p.file.buffer) };
        storedFiles.set(p.file, stored);
      }

      const sheet = readSheet(p.wb, p.sheetName);
      const mappingCheck = validateMapping(p.categoryKey, p.mapping, sheet.headers);
      if (!mappingCheck.ok) throw new Error(mappingCheck.errors.join(' '));

      const { knownLedgers, existingKeys } = await loadComparisonSets(companyId, p.categoryKey);
      const dataset = validateDataset({ categoryKey: p.categoryKey, sheet, mapping: p.mapping, options: {}, knownLedgers, existingKeys });

      batchId = newId();
      const now = nowIso();
      await db('import_batches').insert({
        id: batchId,
        company_id: companyId,
        financial_year_id: financialYearId,
        category: p.categoryKey,
        file_name: p.file.originalname,
        file_size: p.file.size,
        stored_path: stored.path,
        checksum: stored.checksum,
        sheet_name: p.sheetName,
        status: 'validated',
        mapping: writeJson({ mapping: p.mapping, options: {}, headerRowIndex: sheet.headerRowIndex }),
        totals: writeJson(dataset.report),
        created_by: userId,
        created_at: now,
        updated_at: now,
      });
      row.batchId = batchId;

      if (dataset.report.validRows === 0) {
        await db('import_batches').where({ id: batchId }).update({ status: 'failed', error_message: 'No valid rows', updated_at: nowIso() });
        row.status = 'failed';
        row.rejected = dataset.report.invalidRows;
        row.message = `None of the ${dataset.report.totalRows} rows could be read. Download the rejected-row report from Import history.`;
        results.push(row);
        continue;
      }
      if (dataset.report.invalidRows > 0 && !category.supportsPartialImport) {
        await db('import_batches').where({ id: batchId }).update({ status: 'failed', error_message: 'Partial import not supported', updated_at: nowIso() });
        row.status = 'failed';
        row.rejected = dataset.report.invalidRows;
        row.message = `${category.label} needs every row to be valid and ${dataset.report.invalidRows} could not be read. Nothing was imported.`;
        results.push(row);
        continue;
      }

      const commitResult = await withTransaction(async (trx) => {
        const r = await commitDataset(dataset, {
          trx,
          companyId,
          financialYearId,
          batchId: batchId!,
          userId,
          duplicateStrategy,
        });
        await trx('import_rejections').where({ batch_id: batchId }).del();
        if (dataset.rejectedRows.length) {
          for (const c of chunk(
            dataset.rejectedRows.map((rr) => ({
              id: newId(),
              batch_id: batchId,
              row_number: rr.rowNumber,
              raw: writeJson(Object.fromEntries(Object.entries(rr.raw).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]))),
              errors: writeJson(rr.errors),
              severity: 'error',
              created_at: now,
            })),
            200,
          )) {
            await trx('import_rejections').insert(c);
          }
        }
        await trx('import_batches').where({ id: batchId }).update({
          status: 'committed',
          duplicate_strategy: duplicateStrategy,
          partial_import: dataset.report.invalidRows > 0,
          totals: writeJson({ ...dataset.report, ...r }),
          completed_at: nowIso(),
          updated_at: nowIso(),
        });
        return r;
      });

      await recordAudit({
        action: 'import.committed',
        summary: `Bulk import: ${commitResult.inserted} new and ${commitResult.updated} updated ${category.label.toLowerCase()} record(s) from "${p.file.originalname}"`,
        companyId,
        entityType: 'import_batch',
        entityId: batchId,
        meta: { category: p.categoryKey, bulk: true, inserted: commitResult.inserted, updated: commitResult.updated, rejected: dataset.report.invalidRows },
        req,
        userOverride: req ? undefined : { id: userId },
      });

      row.status = 'imported';
      row.inserted = commitResult.inserted;
      row.updated = commitResult.updated;
      row.skipped = commitResult.skipped;
      row.rejected = dataset.report.invalidRows;
      row.ledgersCreated = commitResult.ledgersCreated;
      row.message =
        row.inserted + row.updated === 0
          ? 'Everything in this file was already imported, so nothing changed.'
          : `Imported ${row.inserted + row.updated} record(s)` + (row.rejected ? `; ${row.rejected} row(s) were rejected.` : '.');
    } catch (err) {
      if (batchId) {
        await db('import_batches')
          .where({ id: batchId })
          .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err), updated_at: nowIso() })
          .catch(() => undefined);
      }
      row.status = 'failed';
      row.message = err instanceof Error ? err.message : 'The import failed and was rolled back.';
    }
    results.push(row);
  }

  return { results, sheetsDetected: planned.length };
}
