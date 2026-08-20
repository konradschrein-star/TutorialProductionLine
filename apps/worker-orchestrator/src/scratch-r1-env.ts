/**
 * SCRATCH (task R1) — process-local environment bootstrap.
 *
 * Loads the repo `.env` the same way `src/index.ts` does, then supplies the
 * three variables that are absent from it and that `@repo/config` rejects a
 * worker for. They are set PROCESS-LOCAL on purpose and are never written back
 * to `.env`.
 *
 * Import this for SIDE EFFECTS, first, before anything that calls getConfig().
 */
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });

/** AES-256-GCM master key. Ephemeral: this run decrypts no stored secret. */
process.env["SECRETS_ENCRYPTION_KEY"] ??= randomBytes(32).toString("base64");

// `tts_voices` row id for "Fish — Analytical Male" (provider Fish, en). The
// narration voice is resolved job -> channel -> this default; the job states it
// explicitly too, so this only has to be a real Fish row for config to load.
const FISH_ANALYTICAL_MALE = "d2070eba-df24-4d74-acdc-dd5ff27daa1a";
process.env["DEFAULT_VOICE_EN"] ??= FISH_ANALYTICAL_MALE;
process.env["DEFAULT_VOICE_DE"] ??= FISH_ANALYTICAL_MALE;

export const R1_VOICE_ROW_ID = FISH_ANALYTICAL_MALE;
