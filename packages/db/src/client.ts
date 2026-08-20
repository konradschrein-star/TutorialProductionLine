import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

/**
 * Drizzle Client Factory
 *
 * Creates a typed Drizzle ORM client connected to PostgreSQL.
 *
 * Design decisions:
 * - No singleton pattern here — apps manage connection lifecycle
 *   (`@repo/db/singleton` provides one for repositories that need it).
 * - Full schema provided for type inference
 * - Uses postgres.js driver for performance
 *
 * ── Connection budget ───────────────────────────────────────────────────────
 * postgres.js's own defaults are wrong for this deployment:
 *   max          = 10   (fine, but undocumented/implicit)
 *   idle_timeout = 0    → connections are NEVER released back to the server
 *   max_lifetime = null → connections live forever, so a server-side restart
 *                         or a network blip leaves zombies
 *   no statement_timeout → a single runaway query pins a connection forever
 *
 * All three production services share ONE Postgres (`max_connections` = 100 by
 * default, minus `superuser_reserved_connections` = 3 → 97 usable). pm2 runs
 * exactly one instance of each (`ecosystem.config.js`), and the module-level
 * pools per process are:
 *
 *   hub-web              3  (`src/lib/db.ts`, `@repo/db/singleton`,
 *                            `@repo/provider-registry` lazy client)
 *   worker-orchestrator  2  (`initializeDb()` + `createDrizzleClient()` in
 *                            `src/index.ts:211-212`; its ~43 BullMQ workers all
 *                            share those two — BullMQ itself talks to Redis,
 *                            not Postgres, and per-worker concurrency is 1–2)
 *   worker-render        1  (concurrency 1 per render + 2 for Bundestag)
 *   worker-video-stitch  1  (concurrency 1)
 *   ───────────────────────
 *   7 pools × max 10   = 70 connections worst case, leaving ~27 for psql,
 *                        drizzle-kit, ad-hoc scripts and ops sessions.
 *
 * `max: 10` is therefore kept, but now explicit and overridable per process via
 * `DB_POOL_MAX` — worker-render/stitch can safely be dropped to 4, and hub-web
 * raised, without editing code.
 *
 * NOTE: this pool config only bounds *steady state*. Constructing a client per
 * HTTP request defeats it entirely (each call allocates a fresh `max`-sized
 * pool). Always import a module-level client — in hub-web that is
 * `@/lib/db`.
 *
 * Usage:
 * ```typescript
 * const db = createDrizzleClient(process.env.DATABASE_URL);
 * const jobs = await db.select().from(schema.contentJobs);
 * ```
 */

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;

/** Tunables an individual service may override. */
export interface DrizzleClientOptions {
  /** Max concurrent connections held by THIS pool. Default `DB_POOL_MAX` or 10. */
  max?: number;
  /** Seconds an idle connection is kept before being closed. Default 30. */
  idleTimeoutSeconds?: number;
  /** Seconds to wait for a new connection before failing. Default 10. */
  connectTimeoutSeconds?: number;
  /** Server-side `statement_timeout`, in ms. Default `DB_STATEMENT_TIMEOUT_MS` or 60000. */
  statementTimeoutMs?: number;
  /** Seconds after which a connection is recycled even if in use. Default 1800. */
  maxLifetimeSeconds?: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createDrizzleClient(
  connectionString: string,
  options: DrizzleClientOptions = {},
) {
  const max = options.max ?? intFromEnv("DB_POOL_MAX", 10);

  // 30s: long enough that a burst of requests reuses warm connections, short
  // enough that an idle service hands them back well before another service
  // needs them. postgres.js default of 0 means "never release", which is what
  // let three services + leaked per-request pools reach max_connections.
  const idleTimeout = options.idleTimeoutSeconds ?? 30;

  // 10s: fail fast and surface a real error instead of hanging the request /
  // job for postgres.js's default 30s.
  const connectTimeout = options.connectTimeoutSeconds ?? 10;

  // 1800s (30 min): bounds the blast radius of a half-open socket or a
  // server-side restart; connections are transparently re-established.
  const maxLifetime = options.maxLifetimeSeconds ?? 1800;

  // 60s: nothing in a request handler or a queue job should hold a single
  // statement longer than this. Deliberately generous so vector/clip searches
  // and the larger reporting queries are unaffected. Set DB_STATEMENT_TIMEOUT_MS=0
  // to disable (e.g. for one-off backfill scripts).
  const statementTimeoutMs =
    options.statementTimeoutMs ?? intFromEnv("DB_STATEMENT_TIMEOUT_MS", 60_000);

  const client = postgres(connectionString, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    max_lifetime: maxLifetime,
    connection: {
      // Applied at connection startup, so it covers every statement on the
      // connection including those issued by drizzle internals.
      statement_timeout: statementTimeoutMs,
    },
  });

  return drizzle(client, { schema });
}
