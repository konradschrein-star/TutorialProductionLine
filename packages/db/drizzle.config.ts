import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit Configuration
 *
 * Used by drizzle-kit CLI for:
 * - Generating migrations (pnpm db:generate)
 * - Running migrations (pnpm db:migrate)
 * - Opening Drizzle Studio (pnpm db:studio)
 *
 * ── Why `schema` points at ./dist and NOT at ./src ──────────────────────────
 *
 * This looks wrong and has been blamed for "drizzle-kit generate is broken"
 * (see the header of src/migrations/0043_provider_expiry_and_policies.sql and
 * ~8 other hand-written migrations). It is not the cause. Pointing `schema` at
 * the TypeScript source fails outright on drizzle-kit 0.30.6:
 *
 *   $ drizzle-kit generate     # with schema: "./src/schema/index.ts"
 *   Error: Cannot find module './enums.js'
 *   Require stack:
 *   - packages/db/src/schema/index.ts
 *   - node_modules/.../drizzle-kit/bin.cjs
 *
 * drizzle-kit 0.30.x loads the schema through a CommonJS `require()` with an
 * esbuild transform. Every file under src/schema/ uses NodeNext-style relative
 * specifiers ("./enums.js") because the package is `"type": "module"` and is
 * compiled with `moduleResolution: NodeNext`. `require()` does not rewrite
 * `.js` → `.ts`, so resolution dies on the first re-export. There is no
 * drizzle-kit option that changes this. The compiled output in ./dist has real
 * .js files, so it resolves cleanly.
 *
 * The ACTUAL breakage was that ./dist is gitignored and nothing rebuilt it
 * before generating, so on a fresh clone (or after `pnpm clean`) drizzle-kit
 * had no schema to read — and after a stale build it silently read an outdated
 * one. Fixed by making db:generate / db:push / db:studio run `tsc --build`
 * first (see package.json). Always invoke them via pnpm, never `npx
 * drizzle-kit` directly.
 *
 * Longer-term fix: upgrade drizzle-kit past 0.30.x (newer releases load the
 * schema through a real ESM loader) and switch `schema` to
 * "./src/schema/index.ts".
 *
 * Note: DATABASE_URL must be set in the environment for `migrate`/`push`/
 * `studio`. `generate` does not need it.
 */

export default {
  dialect: "postgresql",
  // Compiled output on purpose — see the note above. Kept in sync by the
  // `tsc --build` prefix on the db:generate / db:push / db:studio scripts.
  schema: "./dist/schema/index.js",
  out: "./src/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
} satisfies Config;
