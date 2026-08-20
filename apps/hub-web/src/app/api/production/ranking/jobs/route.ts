import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs, contentTemplates } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import { DEFAULT_TIER_CONFIG } from "@repo/contracts";
import { createRedisConnection, createIngestQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

/**
 * RANKING lane for Tutorial Studio.
 *
 * WHY THIS LIVES UNDER /api/production RATHER THAN /api/jobs:
 * RANKING is a first-class content format and keeps its normal /jobs surface.
 * This route exists so a VA can run the format from the ONE tool they already
 * use all day, without learning a second one. Two things follow from that:
 *
 *  1. PERMISSIONS. The generic create path is the `createJob` server action,
 *     which requires `create:job` — a grant a TUTORIAL_VA does not have
 *     (their grants are view:production, create:tutorial-job, view:knowledge).
 *     Handing VAs `create:job` would give them every format, which is not the
 *     ask. This route authorises on the tutorial grants instead, so RANKING
 *     becomes creatable by a VA and nothing else does.
 *
 *  2. MIDDLEWARE. `/api/production` is already on the API_ROUTES bypass list in
 *     middleware.ts, and every handler under it self-authenticates. This route
 *     follows that contract, so no middleware change is needed.
 *
 * Data source is `content_jobs` (format = RANKING), NOT `tutorial_jobs`. The
 * two have different status enums and different workers; merging them would
 * break the orchestrator's dispatch, which keys off content_jobs.status.
 */

/** Statuses a RANKING job can sit in that mean "nothing is happening for it". */
const TERMINAL_PREFIXES = [
  "FAILED_",
  "PUBLISHED",
  "MARKED_FOR_DELETION",
  "DELETED",
  "CANCELLED",
];

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

/**
 * The `metadata.ranking` slice, in SQL.
 *
 * Mirrors `extractRanking()` exactly, including its legacy tolerance: most rows
 * nest the slice under `ranking`, a few very old ones store it at the root.
 * `coalesce` picks whichever exists.
 *
 * WHY THIS IS DONE IN SQL AND NOT IN TYPESCRIPT. This handler used to
 * `select({ metadata, script })` for 50 rows and derive the counts in JS. On
 * prod today a single RANKING row's metadata measures up to 27.9 kB
 * (`pg_column_size`) and its script ~5 kB, so the poll was already shipping
 * ~1.6 MB per refresh to render six small numbers per row — and none of the
 * metadata or script is ever displayed in the list. That is precisely the
 * failure documented in `/api/production/jobs/route.ts`, where 100 tutorial
 * rows serialised to a 1.37 MB JSON body every 5 seconds because the payload
 * carried every job's script text. Deriving here means Postgres returns six
 * integers and two short strings per row instead of a 33 kB blob, so the list
 * stays flat as the VA's job count grows.
 */
function rankingSlice(): SQL {
  return sql`coalesce(${contentJobs.metadata} -> 'ranking', ${contentJobs.metadata})`;
}

/** `jsonb_array_length` throws on a non-array, so every use is type-guarded. */
function jsonArrayLen(path: SQL): SQL<number> {
  return sql<number>`(case when jsonb_typeof(${path}) = 'array' then jsonb_array_length(${path}) else 0 end)`;
}

/** Summary columns — everything the list row renders, and nothing else. */
function summarySelection() {
  const slice = rankingSlice();
  return {
    id: contentJobs.id,
    title: contentJobs.title,
    status: contentJobs.status,
    created_at: contentJobs.created_at,
    updated_at: contentJobs.updated_at,
    error_message: contentJobs.error_message,
    topic: sql<string | null>`${slice} ->> 'topic'`,
    jobMode: sql<string | null>`${slice} ->> 'jobMode'`,
    itemCount: jsonArrayLen(sql`${slice} -> 'items'`),
    // rankedCount(): placements when the plan exists, else the item count.
    blocksTotal: sql<number>`(case
      when jsonb_typeof(${slice} -> 'rankingPlan' -> 'placements') = 'array'
       and jsonb_array_length(${slice} -> 'rankingPlan' -> 'placements') > 0
      then jsonb_array_length(${slice} -> 'rankingPlan' -> 'placements')
      else ${jsonArrayLen(sql`${slice} -> 'items'`)}
    end)`,
    // pendingCount(): items the VA has neither approved nor skipped.
    blocksPending: sql<number>`(case
      when jsonb_typeof(${slice} -> 'items') = 'array'
      then (
        select count(*)::int
        from jsonb_array_elements(${slice} -> 'items') e
        where not (
          coalesce((e ->> 'vaApproved')::boolean, false)
          or coalesce((e ->> 'vaSkipped')::boolean, false)
        )
      )
      else 0
    end)`,
    // Word count without shipping the script. POSIX class, not \s, so no
    // backslash has to survive a JS template literal on the way to Postgres.
    scriptWords: sql<number>`(case
      when coalesce(btrim(${contentJobs.script}), '') = '' then 0
      else coalesce(
        array_length(regexp_split_to_array(btrim(${contentJobs.script}), '[[:space:]]+'), 1),
        0)
    end)`,
  };
}

interface SummaryRow {
  id: string;
  title: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  error_message: string | null;
  topic: string | null;
  jobMode: string | null;
  itemCount: number;
  blocksTotal: number;
  blocksPending: number;
  scriptWords: number;
}

function toJobRow(row: SummaryRow) {
  return {
    id: row.id,
    topic: row.topic ?? row.title ?? "",
    status: row.status,
    // Item count only becomes real after SCRIPTING backfills the items the
    // model chose, so 0 here means "the script step has not run yet", not
    // "this ranking has no items".
    itemCount: row.itemCount,
    scriptWords: row.scriptWords,
    blocksTotal: row.blocksTotal,
    blocksPending: row.blocksPending,
    jobMode: row.jobMode ?? "asset_quality_loop",
    errorMessage: row.error_message ?? null,
    isTerminal: TERMINAL_PREFIXES.some((p) => row.status.startsWith(p)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** RANKING rows that have not been axed. */
function visibleRankings(): SQL {
  return and(
    eq(contentJobs.format, "RANKING" as never),
    sql`${contentJobs.status} not in ('MARKED_FOR_DELETION', 'DELETED')`,
  ) as SQL;
}

const CreateSchema = z.object({
  channelId: z.string().uuid(),
  brief: z
    .string()
    .trim()
    .min(10, "Give at least a sentence describing what to rank.")
    .max(50_000),
  topic: z.string().trim().max(100).optional(),
  language: z.string().trim().min(2).max(8).default("en"),
  /**
   * Review gating. Defaults to the human gate, matching the create form and
   * `create-ranking.ts`. `full_auto` renders the first-fetched footage with
   * nobody checking it.
   */
  jobMode: z
    .enum(["full_auto", "asset_quality_loop"])
    .default("asset_quality_loop"),
});

/**
 * GET /api/production/ranking/jobs
 *
 * The VA's RANKING worklist. Two modes, because the list and the live-status
 * poll have opposite shapes and merging them is what makes a page lag:
 *
 *   ?limit=&offset=   one page of the list, newest first. Grows by "Load more".
 *   ?view=active      ONLY the jobs that are still moving. This is what the 5s
 *                     poll asks for, and its size is bounded by how many jobs
 *                     are genuinely in flight (2 on prod today) rather than by
 *                     how many the VA has ever created. A hundred finished
 *                     rankings add nothing to it.
 *
 * The old handler polled all 50 rows — metadata, script and all — every 5
 * seconds. See `summarySelection()` for what that actually cost.
 *
 * Axed jobs (MARKED_FOR_DELETION / DELETED) are excluded from both modes.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;

  // TRUE count of jobs waiting on a human, computed over EVERY row rather than
  // the page this request returns.
  //
  // A queue that needs a human click has to be countable, and counting the page
  // is not counting the queue. The stitcher shipped exactly this bug — a
  // `slice(0, 6)` hid older DRAFTs behind newer jobs, so the Start button simply
  // ceased to exist for them and nobody could tell anything was stuck. Now that
  // the list is explicitly paged, this matters more, not less.
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentJobs)
    .where(
      and(
        eq(contentJobs.format, "RANKING" as never),
        eq(contentJobs.status, "AWAITING_VA_REVIEW" as never),
      ),
    );
  const awaitingSelectionCount = waiting?.n ?? 0;

  // ── Poll lane ───────────────────────────────────────────────────────────
  if (sp.get("view") === "active") {
    const rows = await db
      .select(summarySelection())
      .from(contentJobs)
      .where(
        and(
          visibleRankings(),
          sql`${contentJobs.status} not like 'FAILED%'`,
          sql`${contentJobs.status} <> 'PUBLISHED'`,
        ),
      )
      .orderBy(desc(contentJobs.created_at))
      // Not a page — a sanity bound. If this ever truncates, something has
      // gone wrong upstream and jobs are piling up unfinished.
      .limit(MAX_PAGE);

    return NextResponse.json({
      view: "active",
      jobs: (rows as SummaryRow[]).map(toJobRow),
      awaitingSelectionCount,
    });
  }

  // ── List lane ───────────────────────────────────────────────────────────
  const rawLimit = Number(sp.get("limit") ?? DEFAULT_PAGE);
  const rawOffset = Number(sp.get("offset") ?? 0);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_PAGE)
      : DEFAULT_PAGE;
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  const [totalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentJobs)
    .where(visibleRankings());
  const total = totalRow?.n ?? 0;

  const rows = await db
    .select(summarySelection())
    .from(contentJobs)
    .where(visibleRankings())
    .orderBy(desc(contentJobs.created_at))
    .limit(limit)
    .offset(offset);

  const jobs = (rows as SummaryRow[]).map(toJobRow);

  return NextResponse.json({
    jobs,
    limit,
    offset,
    total,
    hasMore: offset + jobs.length < total,
    /** Every RANKING job awaiting B-roll selection, not just those listed. */
    awaitingSelectionCount,
  });
}

/**
 * POST /api/production/ranking/jobs
 *
 * Create a RANKING job from a freeform brief. Mirrors the payload
 * `packages/cf-api/src/jobs/create-ranking.ts` builds, so a job created here is
 * indistinguishable downstream from one created on /jobs/create/ranking.
 *
 * Deliberately brief-only: the items, the tiers and the order are the script
 * step's job. A VA types what to rank and walks away.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [template] = await db
    .select({ id: contentTemplates.id, name: contentTemplates.name })
    .from(contentTemplates)
    .where(eq(contentTemplates.format, "RANKING" as never))
    .limit(1);

  if (!template) {
    return NextResponse.json(
      {
        error:
          "No RANKING template is configured. An admin must run `pnpm --filter @repo/db seed:ranking`.",
      },
      { status: 412 },
    );
  }

  // content_jobs.title is varchar(100) — derive within that bound rather than
  // letting the insert fail deep inside the ingest worker.
  const topic =
    input.topic ||
    input.brief
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0)
      ?.slice(0, 100) ||
    "";
  if (!topic) {
    return NextResponse.json(
      { error: "Could not derive a title from the brief." },
      { status: 400 },
    );
  }

  const config = getHubConfig();
  const conn = createRedisConnection({ url: config.REDIS_URL, mode: "queue" });
  try {
    const queue = createIngestQueue(conn);
    const enq = await queue.add(
      "ingest-job",
      {
        channel_id: input.channelId,
        format: "RANKING",
        template_id: template.id,
        production_version: "V2",
        initial_topic: topic,
        language: input.language,
        skip_image_qc: false,
        skip_final_qc: false,
        metadata: {
          ranking: {
            topic,
            brief: input.brief,
            // Empty on purpose: this is the freeform path. The script step
            // chooses the items and backfills them.
            items: [],
            context: "",
            tierConfig: DEFAULT_TIER_CONFIG,
            jobMode: input.jobMode,
            created_by: session.userId,
          },
        },
      } as never,
      { attempts: 1 },
    );

    return NextResponse.json({
      success: true,
      topic,
      templateName: template.name,
      ingestQueueJobId: String(enq.id),
      // The content_jobs row does not exist yet — the ingest worker creates it
      // seconds from now. The client re-polls GET rather than being handed an
      // id that would 404.
      hint: "The job appears in the list within about ten seconds.",
    });
  } catch (err) {
    console.error("[production/ranking/jobs] enqueue failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to queue the RANKING job",
      },
      { status: 500 },
    );
  } finally {
    await conn.quit();
  }
}
