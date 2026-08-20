/**
 * Apply variant migration manually
 * Run with: pnpm exec tsx apply-variant-migration.ts
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applyMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    console.log('🔍 Checking current schema...');

    // Check if variant columns exist
    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'assets'
      AND column_name IN ('variant_type', 'variant_metadata')
    `;

    if (columns.length === 2) {
      console.log('✅ Variant columns already exist!');
      console.log('   - variant_type: ✓');
      console.log('   - variant_metadata: ✓');
      process.exit(0);
    }

    if (columns.length === 1) {
      console.log('⚠️  Only one variant column exists. This is unexpected.');
      console.log('   Found:', columns.map(c => c.column_name).join(', '));
    }

    console.log('📝 Reading migration file...');
    const migrationPath = join(__dirname, 'src', 'migrations', '0022_asset_variants.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('🚀 Applying migration...');
    console.log(migrationSQL);

    // Execute migration
    await sql.unsafe(migrationSQL);

    console.log('✅ Migration applied successfully!');

    // Verify
    const newColumns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'assets'
      AND column_name IN ('variant_type', 'variant_metadata')
      ORDER BY column_name
    `;

    console.log('\n📊 Verification:');
    newColumns.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

applyMigration();
