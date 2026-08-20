#!/usr/bin/env tsx
import postgres from "postgres";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL, { max: 1 });

const presets = await sql`
  SELECT
    id,
    name,
    is_default,
    config->>'font_family' as font_family,
    config->>'outline_width' as outline_width,
    config->>'font_size' as font_size,
    config->>'highlight_color' as highlight_color
  FROM caption_presets
  ORDER BY name
`;

console.log("\n✓ Caption Presets in Database:");
console.log("================================");
for (const preset of presets) {
  console.log(`\n${preset.name}`);
  console.log(`  Default: ${preset.is_default}`);
  console.log(`  Font: ${preset.font_family} (${preset.font_size}pt)`);
  console.log(`  Outline: ${preset.outline_width}px`);
  console.log(`  Highlight: ${preset.highlight_color}`);
}
console.log(`\n✓ Total presets: ${presets.length}\n`);

await sql.end();
process.exit(0);
