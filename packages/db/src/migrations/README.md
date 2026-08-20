# `packages/db/src/migrations/` — what is actually runnable here

**Re-baselined 2026-07-30.** Read this before adding, running or renaming anything.

## TL;DR

| File / dir                                | Status                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `0000_baseline_2026_07_30.sql`            | **The only runnable migration.** Referenced by `meta/_journal.json`. |
| `meta/_journal.json`                      | One entry. This is what `drizzle-kit migrate` reads.                 |
| `meta/0000_snapshot.json`                 | Diff base for `drizzle-kit generate`.                                |
| `0000_…` … `0056_…` (58 files)            | **Historical record.** Not referenced by the journal, never run by any tool. |
| `legacy-out-of-band-2026-06/` (10 files)  | Historical record, moved here from the orphan `packages/db/migrations/`. |
| `BASELINE-2026-07-02-prod-schema.sql`     | `pg_dump --schema-only` of prod on 2026-07-02. Reference only, not runnable. |
| `meta/_legacy-pre-2026-07-30/`            | The stale 13-entry journal + its 13 snapshots. Kept for reversibility. |

## Why it was re-baselined

The journal had **13 entries against 58 `.sql` files** — 45 migrations (78%) were invisible
to `drizzle-kit migrate`. On top of that:

- `drizzle-kit generate` had not been usable since ~`0013`, so everything after it was
  hand-written (see the header of `0043_provider_expiry_and_policies.sql`). Root cause and
  fix are documented in `packages/db/drizzle.config.ts`.
- The **only** DDL for `images` / `source_images` (and four `bundestag_clips` columns) lived
  in an orphan directory (`packages/db/migrations/`) that nothing referenced, so a from-zero
  rebuild silently produced an incomplete schema.
- Production has been migrated **out-of-band with `psql`** since ~`0013`
  (`docs/sessions/2026-07-29-DEPLOY-RUNBOOK.md` §2), and `scripts/deploy.sh:54` prints
  `⚠️ Skipping migrations`. The journal was fiction.

Reconstructing a 58-step history that had never been replayed end-to-end would have been a
guess. Instead the current schema is asserted directly: `0000_baseline_2026_07_30.sql` was
produced by `drizzle-kit generate` from `packages/db/src/schema/` against an empty journal,
so it matches the TypeScript schema **by construction** (95 tables, 38 enums, 350 statements).

## Is it safe for production?

Yes, by two independent mechanisms — but see the caveat.

1. The baseline's journal `when` is `1778726296694`, deliberately identical to the original
   `0000_yummy_squadron_sinister`. drizzle applies a migration only when
   `last_applied.created_at < migration.folderMillis`
   (`drizzle-orm/pg-core/dialect.js` → `migrate()`), so on any database with **any** row in
   `drizzle.__drizzle_migrations` it is skipped. It runs only on a virgin database.
2. drizzle wraps the entire run in one transaction, so a mistake rolls back completely.

**Caveat:** a fully-populated database whose `drizzle.__drizzle_migrations` table is *empty*
would try to run the baseline. That is plausible here given the out-of-band history. A guard
`DO` block at the top of the baseline aborts with a readable message if
`public.content_jobs` already exists. The reconciliation `INSERT` is documented in the
baseline's header.

## How to revert

```bash
cd packages/db/src/migrations
mv meta/_legacy-pre-2026-07-30/_journal.json meta/_journal.json
mv meta/_legacy-pre-2026-07-30/0*_snapshot.json meta/
rm 0000_baseline_2026_07_30.sql meta/0000_snapshot.json
rmdir meta/_legacy-pre-2026-07-30
```

No `.sql` file was deleted, so this restores the exact prior state.

## Duplicate prefixes (fixed 2026-07-30)

Four numbers were used twice. The later member of each pair was renamed with a `b` suffix,
which keeps lexical sort order identical (`_` = 0x5F sorts before `b` = 0x62, and `0005b`
still sorts before `0006`). Contents are unchanged.

| Old name                                | New name                                 |
| --------------------------------------- | ---------------------------------------- |
| `0005_professional_caption_presets.sql` | `0005b_professional_caption_presets.sql` |
| `0009_clip_embedding_sparse.sql`        | `0009b_clip_embedding_sparse.sql`        |
| `0012_clip_type.sql`                    | `0012b_clip_type.sql`                    |
| `0017_ranking_format.sql`               | `0017b_ranking_format.sql`               |

For each of the first three, the name kept without a suffix is the one that was in the old
journal (i.e. the drizzle-generated original). For `0017`, `cf_size_bytes_bigint` was added
first (git: 2026-06-18) and `ranking_format` later (2026-06-21).

Updated references: `packages/db/src/run-migration-0005.ts:25`.
Stale reference left alone (historical session note, not code):
`docs/superpowers/plans/2026-07-02-ranking-va-loop-plan.md:56`.

## Numbering gaps — harmless

`0010`, `0021`, `0022`, `0042` were never used. `0042` was explicitly reserved and then
abandoned by a parallel session (`docs/sessions/2026-07-28-plans/secrets-and-settings.md:10`).
Nothing derives ordering from contiguity — drizzle reads `meta/_journal.json`, and the
out-of-band `psql` runbook names files explicitly — so the gaps have no effect. They are
recorded here rather than back-filled, because renumbering would rewrite history for no gain.

## Adding a migration from now on

```bash
pnpm --filter @repo/db db:generate      # builds dist/ first, then diffs vs meta/0000_snapshot.json
```

This now produces a real incremental migration and appends it to the journal. Do **not**
hand-write SQL any more; if `db:generate` misbehaves, that is a bug to fix, not to route
around. Production application is still out-of-band — `scripts/deploy.sh` does not run
migrations. See `docs/sessions/2026-07-29-DEPLOY-RUNBOOK.md`.
