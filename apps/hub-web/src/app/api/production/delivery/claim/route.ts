import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, tutorialUploadDispatches } from "@/lib/db";
import { authorizeDeliveryConnector, claimScheduledDelivery, DeliveryError } from "@/lib/uploader/scheduled-delivery";
export const dynamic = "force-dynamic";
/** Discovery is non-executable; POST is the single durable admission point. */
export async function GET(request: NextRequest) {
  if (!await authorizeDeliveryConnector(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requests = await db.select({ dispatchId: tutorialUploadDispatches.id, state: tutorialUploadDispatches.state, requestedAt: tutorialUploadDispatches.requested_at }).from(tutorialUploadDispatches).where(and(eq(tutorialUploadDispatches.state, "generic_queued"))).orderBy(asc(tutorialUploadDispatches.requested_at)).limit(50);
  return NextResponse.json({ mayExecute: false, requests });
}
export async function POST(request: NextRequest) {
  if (!await authorizeDeliveryConnector(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ dispatchId: z.string().uuid(), claimId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "dispatchId and durable claimId are required." }, { status: 400 });
  try { return NextResponse.json(await claimScheduledDelivery(parsed.data.dispatchId, parsed.data.claimId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Claim failed" }, { status: error instanceof DeliveryError ? error.status : 500 }); }
}
