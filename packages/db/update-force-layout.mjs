#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

const sql = postgres(process.env.DATABASE_URL);

// Get current template
const [template] = await sql`
  SELECT id, name, render_config
  FROM content_templates
  WHERE format = 'CASUALLY_EXPLAINED'
  LIMIT 1
`;

console.log(`Updating template: ${template.name}`);

// Parse render_config
const renderConfig = typeof template.render_config === 'string' 
  ? JSON.parse(template.render_config)
  : template.render_config;

// Add force_layout
renderConfig.force_layout = "AVATAR_PIP";

console.log('\nAdding force_layout: "AVATAR_PIP" to render_config\n');

// Update template
await sql`
  UPDATE content_templates
  SET render_config = ${JSON.stringify(renderConfig)}
  WHERE id = ${template.id}
`;

console.log('✅ Template updated successfully');

// Verify
const [updated] = await sql`
  SELECT render_config
  FROM content_templates
  WHERE id = ${template.id}
  LIMIT 1
`;

const updatedConfig = typeof updated.render_config === 'string' 
  ? JSON.parse(updated.render_config)
  : updated.render_config;

console.log('\nVerifying force_layout:', updatedConfig.force_layout);

await sql.end();
