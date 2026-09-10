import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolvePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
import { db, tutorialJobs, users } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Read-only identity reconciliation for the optional Keyword Tool connector. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.kind !== "machine") return NextResponse.json({ error: "A machine bearer token is required." }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiAuthError ? error.message : "Authentication failed" }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "A valid tutorial job UUID is required." }, { status: 400 });
  try {
    const [job] = await db.select({ jobId: tutorialJobs.id, keyword_ref: tutorialJobs.keyword_ref, claimed_by_email: users.email, channel_id: tutorialJobs.channel_id, status: tutorialJobs.status }).from(tutorialJobs).leftJoin(users, eq(users.id, tutorialJobs.created_by)).where(eq(tutorialJobs.id, parsed.data)).limit(1);
    if (!job) return NextResponse.json({ error: "Tutorial job not found" }, { status: 404 });
    // Explicit projection: no scripts, provider credentials or other metadata.
    return NextResponse.json({ jobId: job.jobId, keyword_ref: job.keyword_ref, claimed_by_email: job.claimed_by_email, channel_id: job.channel_id, status: job.status }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Tutorial reconciliation is temporarily unavailable." }, { status: 503 });
  }
}
