#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

const sql = postgres(process.env.DATABASE_URL);

const [template] = await sql`
  SELECT id, name, format, metadata
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
  LIMIT 1
`;

console.log('\nTemplate Configuration:');
console.log(JSON.stringify(template, null, 2));

// Check pipeline_config
if (template?.metadata?.pipeline_config) {
  console.log('\nPipeline Config:');
  console.log(JSON.stringify(template.metadata.pipeline_config, null, 2));
}

await sql.end();
