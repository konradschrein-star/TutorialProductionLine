import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { keywordIntegrationState, keywordIsProduced } from "@/lib/keyword-tool/workflow";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";
import {
  ktGet,
  ktLogin,
  ktKeywordUrl,
  KeywordToolError,
} from "@/lib/keyword-tool/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/keywords/mine
 *
 * The signed-in VA's claimed keywords, joined to what they have already made.
 *
 * ## The gap this closes
 *
 * The Keyword Tool and the Tutorial Studio were two tools with no seam a VA
 * could walk across. A VA claimed a keyword on the board, then switched tab and
 * RETYPED the title into a blank Create form. Nothing connected the two: of
 * 2,349 tutorial jobs ever created, **zero** carry a keyword_ref. The binding
 * that would make the board track itself — CF fires a status webhook to KT on
 * every transition of a job that has a keyword_ref — has therefore never fired
 * once, because no job has ever had one.
 *
 * So the board could not tell you what had been produced, and the studio could
 * not tell you what you were supposed to produce.
 *
 * ## What this returns
 *
 * Their claims, each marked with the CF job that came from it (if any) and that
 * job's status. `alreadyProduced` is read from Content Forge's own
 * `tutorial_jobs.keyword_ref`, not from KT's `forge_job_id`, because CF owns
 * that fact and the two can disagree while a webhook is in flight.
 */

interface KtKeyword {
  id: number;
  keyword: string;
  topic: string | null;
  content_type: string | null;
  status: string;
  length_class: string | null;
  duration_sec: number | null;
  priority_score: number | null;
  video_id: string | null;
  destination: string | null;
  note: string | null;
}

/**
 * KT statuses that mean "this is mine and still open".
 *
 * Mirrors `IN_FLIGHT_STATUSES` in the Keyword Tool's `backend/kt_statuses.py`. This was
 * `CLAIMED`/`IN_PROGRESS` alone, which is the vocabulary from before Content Forge drove
 * production — KT moves a row to RECORDING the moment a job starts, so the queue emptied
 * itself exactly when the work began. A VA holding eleven keywords in production was told
 * "You have not claimed any keywords yet." Keep this list in step with KT's; it is the
 * same fact stated in two codebases.
 */
const OPEN_STATUSES = new Set([
  "CLAIMED",
  "IN_PROGRESS",
  "RECORDING",
  "RENDERING",
  "QUALITY_CHECK",
  "FAILED_QC",
]);

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const integration = keywordIntegrationState(process.env);
  if (integration !== "configured") {
    return NextResponse.json({ integration, keywords: [], total: 0, remaining: 0, unstarted: 0, produced: 0 });
  }
  const includeDone = url.searchParams.get("includeDone") === "1";

  let rows: KtKeyword[];
  let ktUserName: string;
  try {
    const kt = await ktLogin(session);
    ktUserName = kt.user.name;
    rows = await ktGet<KtKeyword[]>(kt, "/api/v5/keywords", {
      claimed_by: kt.user.id,
      limit: 200,
    });
  } catch (err) {
    if (err instanceof KeywordToolError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const wanted = rows.filter(
    (k) => includeDone || OPEN_STATUSES.has((k.status ?? "").toUpperCase()),
  );

  // What has Content Forge already made for these keywords? Its own table is
  // the authority — KT's forge_job_id is a mirror, and a mirror can lag.
  const refs = wanted.map((k) => String(k.id));
  const produced =
    refs.length > 0
      ? await db
          .select({
            id: tutorialJobs.id,
            keywordRef: tutorialJobs.keyword_ref,
            status: tutorialJobs.status,
            title: tutorialJobs.title,
            channelId: tutorialJobs.channel_id,
          })
          .from(tutorialJobs)
          .where(and(inArray(tutorialJobs.keyword_ref, refs), eq(tutorialJobs.created_by, session.userId), isNull(tutorialJobs.source_job_id)))
      : [];
  const byRef = new Map(produced.map((p) => [p.keywordRef ?? "", p]));

  const keywords = wanted.map((k) => {
    const job = byRef.get(String(k.id));
    return {
      id: k.id,
      keyword: k.keyword,
      topic: k.topic,
      status: k.status,
      lengthClass: k.length_class,
      durationSec: k.duration_sec,
      priorityScore: k.priority_score,
      destination: k.destination,
      note: k.note,
      referenceUrl: k.video_id
        ? `https://www.youtube.com/watch?v=${k.video_id}`
        : null,
      ktUrl: ktKeywordUrl(k.id),
      job: job ? { id: job.id, status: job.status, title: job.title } : null,
      assignedChannelId: job?.channelId ?? null,
    };
  });

  return NextResponse.json({
    integration: "configured",
    ktUser: ktUserName,
    total: keywords.length,
    remaining: keywords.filter((k) => !keywordIsProduced(k)).length,
    unstarted: keywords.filter((k) => !k.job && !keywordIsProduced(k)).length,
    produced: keywords.filter(keywordIsProduced).length,
    keywords,
  });
}
