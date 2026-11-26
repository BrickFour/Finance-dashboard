import type { Knex } from 'knex';

/**
 * Keeps each uploaded workbook in the database as well as on disk.
 *
 * The step-by-step import reads the file again at every step. On a serverless
 * host the next step can run on another instance, or after the local disk was
 * wiped, so the copy on disk alone is not enough.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('import_files')) return;
  await knex.schema.createTable('import_files', (t) => {
    t.string('batch_id', 40).primary().references('id').inTable('import_batches').onDelete('CASCADE');
    t.string('company_id', 40).notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.binary('content').notNullable();
    t.string('created_at', 32).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('import_files');
}
