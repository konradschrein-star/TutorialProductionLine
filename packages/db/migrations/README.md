# MOVED — this directory is not a migration directory

Until 2026-07-30 this folder held 10 date-named `.sql` files that were applied to production
by hand and were referenced by **nothing**: not `drizzle.config.ts` (`out` is
`./src/migrations`), not the drizzle journal, not `scripts/deploy.sh`, not any runner.

It contained the **only** DDL in the repo for the `images` and `source_images` tables
(schema: `packages/db/src/schema/image-library.ts`) and for four `bundestag_clips` columns
(`start_offset`, `end_offset`, `party`, `speaker_name`). A database rebuilt from the
canonical migration path was therefore missing them.

The files now live at:

    packages/db/src/migrations/legacy-out-of-band-2026-06/

and every table/column they created is included in the squashed baseline
`packages/db/src/migrations/0000_baseline_2026_07_30.sql`, which is what a from-zero
rebuild actually runs.

**Do not add migrations here.** The canonical path is `packages/db/src/migrations/`.
This file exists only so the mistake is not repeated and so the move is discoverable.
