/**
 * Setup database and apply all migrations
 * Run with: pnpm exec tsx setup-database.ts
 */

import postgres from 'postgres';

async function setupDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  // Parse DATABASE_URL to get connection details
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1); // Remove leading /
  const baseUrl = databaseUrl.replace(`/${dbName}`, '/postgres'); // Connect to postgres db

  console.log(`🔍 Checking if database '${dbName}' exists...`);

  // Connect to postgres database to check/create our database
  const sqlAdmin = postgres(baseUrl);

  try {
    // Check if database exists
    const databases = await sqlAdmin`
      SELECT datname FROM pg_database WHERE datname = ${dbName}
    `;

    if (databases.length === 0) {
      console.log(`📦 Creating database '${dbName}'...`);
      await sqlAdmin.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database '${dbName}' created!`);
    } else {
      console.log(`✓ Database '${dbName}' already exists`);
    }

    await sqlAdmin.end();

    // Now connect to our database and check schema
    console.log(`\n🔗 Connecting to '${dbName}'...`);
    const sql = postgres(databaseUrl);

    try {
      // Check if assets table exists
      const tables = await sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'assets'
      `;

      if (tables.length === 0) {
        console.log(`⚠️  Database is empty - you need to run full migrations first`);
        console.log(`   Run: cd packages/db && pnpm db:push`);
        console.log(`   Or push schema with: pnpm drizzle-kit push`);
        process.exit(1);
      }

      console.log(`✓ Assets table exists`);

      // Check if variant columns exist
      const columns = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'assets'
        AND column_name IN ('variant_type', 'variant_metadata')
        ORDER BY column_name
      `;

      if (columns.length === 2) {
        console.log(`✅ Variant columns already exist!`);
        console.log(`   - variant_type: ${columns.find(c => c.column_name === 'variant_type')?.data_type}`);
        console.log(`   - variant_metadata: ${columns.find(c => c.column_name === 'variant_metadata')?.data_type}`);
        console.log(`\n✨ Database is ready!`);
      } else {
        console.log(`\n📝 Variant columns missing. Need to apply migration 0022.`);
        console.log(`   You can:`);
        console.log(`   1. Run: cd packages/db && pnpm drizzle-kit push (to sync schema)`);
        console.log(`   2. Or apply manually with the apply-variant-migration.ts script`);
      }

      await sql.end();
    } catch (error) {
      console.error(`❌ Error checking schema:`, error);
      await sql.end();
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Error setting up database:`, error);
    await sqlAdmin.end();
    process.exit(1);
  }
}

setupDatabase();
