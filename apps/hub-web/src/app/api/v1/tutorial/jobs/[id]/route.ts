import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolveTutorialIntakePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
import { db, tutorialJobs, users } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Read-only identity reconciliation for the optional Keyword Tool connector. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let externalSource: string | undefined;
  try {
    const principal = await resolveTutorialIntakePrincipal(request);
    if (principal.kind !== "machine") return NextResponse.json({ error: "A machine bearer token is required." }, { status: 401 });
    externalSource = principal.externalSource;
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiAuthError ? error.message : "Authentication failed" }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "A valid tutorial job UUID is required." }, { status: 400 });
  try {
    const [job] = await db.select({
      jobId: tutorialJobs.id,
      keyword_ref: tutorialJobs.keyword_ref,
      claimed_by_email: users.email,
      channel_id: tutorialJobs.channel_id,
      status: tutorialJobs.status,
      external_source: tutorialJobs.external_source,
      request_id: tutorialJobs.intake_request_id,
      production_run_id: tutorialJobs.external_production_run_id,
      opportunity_id: tutorialJobs.external_opportunity_id,
      family_id: tutorialJobs.external_family_id,
      evidence_id: tutorialJobs.external_evidence_id,
      route_decision_id: tutorialJobs.external_route_decision_id,
      request_hash: tutorialJobs.intake_request_hash,
    }).from(tutorialJobs).leftJoin(users, eq(users.id, tutorialJobs.created_by)).where(eq(tutorialJobs.id, parsed.data)).limit(1);
    if (!job) return NextResponse.json({ error: "Tutorial job not found" }, { status: 404 });
    if (externalSource && job.external_source && job.external_source !== externalSource) {
      return NextResponse.json({ error: "Tutorial job not found" }, { status: 404 });
    }
    // Explicit projection: no scripts, provider credentials or other metadata.
    return NextResponse.json({
      jobId: job.jobId,
      keyword_ref: job.keyword_ref,
      claimed_by_email: job.claimed_by_email,
      channel_id: job.channel_id,
      status: job.status,
      ...(job.external_source ? {
        identity: {
          schema_version: 2,
          external_source: job.external_source,
          request_id: job.request_id,
          production_run_id: job.production_run_id,
          opportunity_id: job.opportunity_id,
          family_id: job.family_id,
          evidence_id: job.evidence_id,
          route_decision_id: job.route_decision_id,
          request_hash: job.request_hash,
        },
      } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Tutorial reconciliation is temporarily unavailable." }, { status: 503 });
  }
}
