#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

const sql = postgres(process.env.DATABASE_URL);

const templates = await sql`
  SELECT id, name, format, is_active, render_config
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
  ORDER BY created_at DESC
`;

console.log(`\nFound ${templates.length} CASUALLY_EXPLAINED templates:\n`);

for (const t of templates) {
  const renderConfig = typeof t.render_config === 'string' 
    ? JSON.parse(t.render_config)
    : t.render_config;
  
  console.log(`ID: ${t.id}`);
  console.log(`Name: ${t.name}`);
  console.log(`Active: ${t.is_active}`);
  console.log(`force_layout: ${renderConfig.force_layout ?? 'NOT SET'}`);
  console.log('');
}

await sql.end();
