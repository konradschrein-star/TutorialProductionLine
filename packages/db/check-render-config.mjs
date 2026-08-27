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
  SELECT id, name, format, render_config
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
  LIMIT 1
`;

console.log('\nTemplate Render Config:');
console.log(JSON.stringify(template.render_config, null, 2));

await sql.end();
