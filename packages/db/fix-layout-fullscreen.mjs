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
  SELECT id, render_config
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
`;

for (const t of templates) {
  const config = typeof t.render_config === 'string' ? JSON.parse(t.render_config) : t.render_config;
  config.force_layout = 'IMAGE_FULLSCREEN';
  
  await sql`
    UPDATE content_templates
    SET render_config = ${JSON.stringify(config)}
    WHERE id = ${t.id}
  `;
}

console.log('✅ Updated to IMAGE_FULLSCREEN');
await sql.end();
