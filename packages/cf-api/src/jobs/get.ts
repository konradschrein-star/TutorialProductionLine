import { eq } from "drizzle-orm";
import { contentJobs } from "@repo/db";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

export async function getJob(rt: CfRuntime, jobId: string) {
  const [row] = await rt.db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);
  if (!row) throw new CfApiError("NOT_FOUND", `Job ${jobId} not found`);
  return row;
}
