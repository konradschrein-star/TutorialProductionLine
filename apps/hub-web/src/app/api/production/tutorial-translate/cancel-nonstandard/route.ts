import { NextResponse } from "next/server";
import { and, notInArray, isNotNull, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
  createTutorialSpliceQueue,
} from "@repo/queue";
import { DEFAULT_STANDARD_LANGUAGES } from "@/lib/tutorial/languages";

export const dynamic = "force-dynamic";

/**
 * Cancel in-flight and queued translation jobs for non-standard languages.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const allowedLangs = Array.from(DEFAULT_STANDARD_LANGUAGES);

  const pendingNonStandard = await db
    .select({
      id: tutorialJobs.id,
      sourceId: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
      status: tutorialJobs.status,
    })
    .from(tutorialJobs)
    .where(
      and(
        isNotNull(tutorialJobs.source_job_id),
        notInArray(tutorialJobs.language, allowedLangs),
        notInArray(tutorialJobs.status, ["COMPLETED", "CANCELLED"]),
      ),
    );

  let cancelledCount = 0;
  const redisUrl = process.env["REDIS_URL"];
  let conn = null;

  try {
    if (redisUrl) {
      conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const translateQueue = createTutorialTranslateQueue(conn);
      const spliceQueue = createTutorialSpliceQueue(conn);

      for (const job of pendingNonStandard) {
        await db
          .update(tutorialJobs)
          .set({
            status: "CANCELLED",
            error_message: `Cancelled: Translation restricted to 5 standard languages (${allowedLangs.join(", ")})`,
          })
          .where(eq(tutorialJobs.id, job.id));

        if (job.sourceId && job.language) {
          const translateJobId = `tutorial-translate-${job.sourceId}-${job.language}`;
          await translateQueue.remove(translateJobId).catch(() => {});
        }
        const spliceJobId = `tutorial-splice-${job.id}`;
        await spliceQueue.remove(spliceJobId).catch(() => {});
        cancelledCount++;
      }
    } else {
      for (const job of pendingNonStandard) {
        await db
          .update(tutorialJobs)
          .set({
            status: "CANCELLED",
            error_message: `Cancelled: Translation restricted to 5 standard languages (${allowedLangs.join(", ")})`,
          })
          .where(eq(tutorialJobs.id, job.id));
        cancelledCount++;
      }
    }
  } finally {
    if (conn) await conn.quit();
  }

  return NextResponse.json({
    success: true,
    cancelled: cancelledCount,
    allowedLanguages: allowedLangs,
  });
}
