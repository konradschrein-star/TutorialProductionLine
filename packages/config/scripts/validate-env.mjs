#!/usr/bin/env node
// Preflight check: validates a .env file against @repo/config's Zod schema
// BEFORE any process restart. Run this in CI/deploy right after syncing
// source and before restarting PM2 — a required var missing here fails
// loudly with the exact field name, instead of crash-looping the process
// after restart (see project-hub-web-outage-2026-07-04 memory).
//
// Usage: node packages/config/scripts/validate-env.mjs [path-to-.env]
// Default .env path: repo root (three levels up from this file).

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const envPath = resolve(process.argv[2] ?? resolve(repoRoot, ".env"));
const configDist = resolve(here, "../dist/index.js");

if (!existsSync(envPath)) {
  console.error(`FATAL: ${envPath} does not exist.`);
  process.exit(1);
}

if (!existsSync(configDist)) {
  console.error(
    `FATAL: ${configDist} not built. Run: pnpm turbo run build --filter=@repo/config`,
  );
  process.exit(1);
}

// Minimal .env parser — server files are plain KEY=VALUE lines, no need
// for a full dotenv dependency just for this preflight check.
function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
for (const [key, value] of Object.entries(parsed)) {
  if (!(key in process.env)) process.env[key] = value;
}

const { loadConfig } = await import(`file://${configDist}`);

try {
  loadConfig();
  console.log(`.env passes schema validation (${envPath})`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
