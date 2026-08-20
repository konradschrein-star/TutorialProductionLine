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
  SELECT id, name, render_config
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
`;

console.log(`\nUpdating ${templates.length} templates:\n`);

for (const template of templates) {
  const renderConfig = typeof template.render_config === 'string' 
    ? JSON.parse(template.render_config)
    : template.render_config;

  if (!renderConfig.force_layout) {
    renderConfig.force_layout = "AVATAR_PIP";
    
    await sql`
      UPDATE content_templates
      SET render_config = ${JSON.stringify(renderConfig)}
      WHERE id = ${template.id}
    `;
    
    console.log(`✅ Updated: ${template.name}`);
  } else {
    console.log(`⏭️  Skipped: ${template.name} (already has force_layout)`);
  }
}

console.log('\n✅ All templates updated\n');

await sql.end();
