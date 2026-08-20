# @repo/db

Database schema, migrations, and Drizzle ORM client for PostgreSQL 16.

## Purpose

Provide:
- Drizzle ORM schema definitions (all tables, enums, indexes)
- Database client factory (typed Drizzle client)
- Migration management (via Drizzle Kit)
- Type-safe database queries

## Public API

### Database Client

```typescript
import { createDrizzleClient } from "@repo/db";

const db = createDrizzleClient(process.env.DATABASE_URL);

// Type-safe queries
const jobs = await db.select().from(contentJobs).where(eq(contentJobs.status, "SCRIPTING"));
```

### Schema Exports

```typescript
import {
  contentJobs,
  contentTemplates,
  channels,
  users,
  systemEvents
} from "@repo/db";

// Use in queries
const job = await db
  .select()
  .from(contentJobs)
  .where(eq(contentJobs.id, jobId))
  .limit(1);
```

### Type Exports

```typescript
import type { DrizzleClient, ContentJob, ContentTemplate, Channel, User, SystemEvent } from "@repo/db";

// Use in function signatures
async function fetchJob(db: DrizzleClient, jobId: string): Promise<ContentJob | null> {
  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  return job ?? null;
}
```

## Directory Structure

```
src/
  schema/
    channels.ts           # channels table definition
    content-jobs.ts       # content_jobs table definition (largest table)
    content-templates.ts  # content_templates table definition
    enums.ts              # PostgreSQL enum definitions
    system-events.ts      # system_events table definition
    users.ts              # users table definition
    index.ts              # Barrel export

  client.ts               # Drizzle client factory
  index.ts                # Public API surface

drizzle.config.ts         # Drizzle Kit configuration
migrations/               # Generated SQL migrations
```

## Database Schema

See **`docs/architecture/DATA_MODEL.md`** for complete schema documentation.

### Tables

| Table | Purpose |
|-------|---------|
| `channels` | YouTube channel entities |
| `content_templates` | Pipeline template registry (format-agnostic) |
| `users` | Operator accounts (VAs, admins, managers) |
| `content_jobs` | Central job tracking (source of truth for state) |
| `system_events` | LISTEN/NOTIFY event log for SSE streaming |

### Enums

| Enum | Values | Purpose |
|------|--------|---------|
| `job_status` | 21 states | Content job state machine |
| `content_format` | 7 formats | Content format categories |
| `render_engine` | 2 engines | Render backend selection (FFMPEG, REMOTION) |
| `operator_role` | 5 roles | RBAC permissions |

## Migration Management

> **Read `src/migrations/README.md` first.** The migration set was re-baselined on
> 2026-07-30: a single squashed baseline (`0000_baseline_2026_07_30.sql`) is the only
> journal-referenced migration; the 58 historical `.sql` files are kept as a record but are
> not run by any tool. That document explains why, how to revert, and the duplicate-prefix
> renames.

### Generate Migration

After modifying schema files:

```bash
pnpm --filter @repo/db db:generate
```

This creates a new migration file in `src/migrations/` and appends an entry to
`src/migrations/meta/_journal.json`.

**Always run it through pnpm, never `npx drizzle-kit generate`.** The script compiles the
package first (`tsc --build && drizzle-kit generate`) because `drizzle.config.ts` points
`schema` at `./dist/schema/index.js`. That indirection is deliberate: drizzle-kit 0.30.6
loads the schema with a CommonJS `require()`, which cannot resolve the NodeNext-style
`./enums.js` specifiers used throughout `src/schema/`, and fails with
`Error: Cannot find module './enums.js'`. `./dist` is gitignored, so without the build step
generate reads a stale schema — or none at all on a fresh clone. Full explanation in
`drizzle.config.ts`.

Do **not** hand-write migration SQL. Several files between `0013` and `0056` carry a
"drizzle-kit generate is broken here" header; that is no longer true.

### Apply Migrations

```bash
pnpm --filter @repo/db db:migrate     # requires DATABASE_URL
```

Applies every journal entry newer than the last row in `drizzle.__drizzle_migrations`,
inside a single transaction.

**Production does not use this.** `scripts/deploy.sh` deliberately skips migrations
(`scripts/deploy.sh:54`) and prod DDL is applied out-of-band with `psql`, file by file — see
`docs/sessions/2026-07-29-DEPLOY-RUNBOOK.md` §2. Do not point `db:migrate` at production
without first reading the header of `src/migrations/0000_baseline_2026_07_30.sql`.

### Drizzle Studio (GUI)

```bash
pnpm --filter @repo/db db:studio
```

Opens browser-based GUI for exploring database schema and data. Also builds first.

### Verifying a from-zero rebuild

```bash
createdb cf_verify
DATABASE_URL='postgres://…/cf_verify' pnpm --filter @repo/db db:migrate
DATABASE_URL='postgres://…/cf_verify' pnpm --filter @repo/db db:generate   # must print
                                                                          # "No schema changes"
```

If the third command emits a migration file, the baseline and `src/schema/` have drifted.

## Dependencies

- **drizzle-orm:** Type-safe ORM for PostgreSQL
- **postgres:** PostgreSQL client for Node.js
- **@repo/contracts:** Zod schemas (for DTO validation)

## Usage Examples

### Create Drizzle Client

```typescript
import { createDrizzleClient } from "@repo/db";
import { loadConfig } from "@repo/config";

const config = loadConfig();
const db = createDrizzleClient(config.DATABASE_URL);
```

### Insert a Job

```typescript
import { db, contentJobs } from "@repo/db";

const [job] = await db
  .insert(contentJobs)
  .values({
    channel_id: "123e4567-e89b-12d3-a456-426614174000",
    template_id: "456e7890-e89b-12d3-a456-426614174000",
    status: "IDEA_GENERATION",
    status_updated_at: new Date(),
    format: "EXPLAINER",
    title: "How to Build a YouTube Automation Engine",
    description: "A comprehensive guide to building a procedural content system.",
  })
  .returning();

console.log("Created job:", job.id);
```

### Update Job Status

```typescript
import { db, contentJobs } from "@repo/db";
import { eq } from "drizzle-orm";

await db
  .update(contentJobs)
  .set({
    status: "SCRIPTING",
    status_updated_at: new Date(),
    state_machine_history: sql`
      ${contentJobs.state_machine_history} || ${JSON.stringify({
        from_status: "IDEA_GENERATION",
        to_status: "SCRIPTING",
        timestamp: new Date().toISOString(),
        reason: "Script generation dispatched"
      })}::jsonb
    `
  })
  .where(eq(contentJobs.id, jobId));
```

### Query with Join

```typescript
import { db, contentJobs, channels } from "@repo/db";
import { eq } from "drizzle-orm";

const result = await db
  .select({
    job: contentJobs,
    channel: channels
  })
  .from(contentJobs)
  .leftJoin(channels, eq(contentJobs.channel_id, channels.id))
  .where(eq(contentJobs.status, "SCRIPTING"));

for (const { job, channel } of result) {
  console.log(`Job ${job.id} on channel ${channel?.name}`);
}
```

### JSONB Query (Asset Manifest)

```typescript
import { db, contentJobs } from "@repo/db";
import { sql } from "drizzle-orm";

// Find jobs with TTS audio assets
const jobsWithTTS = await db
  .select()
  .from(contentJobs)
  .where(
    sql`${contentJobs.r2_asset_manifest} @> ${JSON.stringify([{ type: "audio/tts" }])}::jsonb`
  );
```

## Design Decisions

**Why Drizzle ORM?**
- Type-safe queries (TypeScript-first)
- SQL-like API (easy migration from raw SQL)
- No runtime overhead (compiles to SQL)
- Great TypeScript inference (autocomplete everywhere)
- Schema-first approach (migrations generated from schema)

**Why PostgreSQL native enums?**
- Stronger type safety at database level
- Better query performance than VARCHAR with CHECK constraint
- Clearer schema documentation
- Prevents invalid enum values at insertion time

**Why JSONB for flexible fields?**
- Template registry needs flexibility (new formats without schema migration)
- Asset manifest structure may evolve over time
- State machine history is append-only (JSONB array)
- GIN indexes allow efficient JSONB querying

**Why separate tables for channels/templates/users?**
- Normalization (single source of truth)
- Referential integrity (foreign key constraints)
- Easier analytics (JOIN queries)
- Prevent accidental deletion (RESTRICT constraints)
