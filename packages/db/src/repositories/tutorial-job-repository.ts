import { eq, and, desc, asc, isNull } from "drizzle-orm";
import { tutorialJobs } from "../schema/tutorial-jobs.js";
import type { DrizzleClient } from "../client.js";
import { fireTutorialStatusWebhook } from "../utils/tutorial-status-webhook.js";

export type NewTutorialJob = typeof tutorialJobs.$inferInsert;
export type TutorialJob = typeof tutorialJobs.$inferSelect;
export type TutorialJobUpdate = Partial<Omit<TutorialJob, "id" | "created_at">>;

export async function createTutorialJob(
  db: DrizzleClient,
  data: NewTutorialJob,
): Promise<TutorialJob> {
  const [row] = await db.insert(tutorialJobs).values(data).returning();
  if (!row) throw new Error("Failed to create tutorial job");
  return row;
}

export async function getTutorialJobById(
  db: DrizzleClient,
  id: string,
): Promise<TutorialJob | undefined> {
  const [row] = await db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);
  return row;
}

/**
 * Find the tutorial job that dispatched a given video-stitch job. Used by the
 * stitch processor to write results back and move the parent out of the
 * SENT_TO_STITCHER dead-end (T1).
 */
export async function getTutorialJobByStitchJobId(
  db: DrizzleClient,
  stitchJobId: string,
): Promise<TutorialJob | undefined> {
  const [row] = await db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.stitch_job_id, stitchJobId))
    .limit(1);
  return row;
}

export async function updateTutorialJob(
  db: DrizzleClient,
  id: string,
  data: TutorialJobUpdate,
): Promise<TutorialJob> {
  const [row] = await db
    .update(tutorialJobs)
    .set({ ...data, updated_at: new Date() })
    .where(eq(tutorialJobs.id, id))
    .returning();
  if (!row) throw new Error(`Tutorial job ${id} not found`);
  // Video ERP: when this job is bound to a Keyword Tool keyword and its status
  // just changed, mirror the transition back to KT. Single choke-point — every
  // tutorial status transition routes through here (see splice-reconciler).
  if (data.status !== undefined && row.keyword_ref) {
    fireTutorialStatusWebhook({
      keyword_ref: row.keyword_ref,
      forge_job_id: row.id,
      status: row.status,
      title: row.title,
      updated_at: row.updated_at,
    });
  }
  return row;
}

export async function listTutorialJobsByUser(
  db: DrizzleClient,
  userId: string,
  limit = 50,
  includeTranslations = false,
): Promise<TutorialJob[]> {
  const conditions = [eq(tutorialJobs.created_by, userId)];
  if (!includeTranslations) {
    conditions.push(isNull(tutorialJobs.source_job_id));
  }
  return db
    .select()
    .from(tutorialJobs)
    .where(and(...conditions))
    .orderBy(desc(tutorialJobs.created_at))
    .limit(limit);
}


export async function listTutorialJobsByStatus(
  db: DrizzleClient,
  userId: string,
  status: TutorialJob["status"],
): Promise<TutorialJob[]> {
  return db
    .select()
    .from(tutorialJobs)
    .where(
      and(eq(tutorialJobs.created_by, userId), eq(tutorialJobs.status, status)),
    )
    .orderBy(desc(tutorialJobs.created_at));
}

/**
 * List child segment jobs for a given parent tutorial job, ordered by segment_index.
 * Used by the stitch processor to concat segments in order.
 */
export async function listTutorialJobsByParent(
  db: DrizzleClient,
  parentId: string,
): Promise<TutorialJob[]> {
  return db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.parent_job_id, parentId))
    .orderBy(asc(tutorialJobs.segment_index));
}
