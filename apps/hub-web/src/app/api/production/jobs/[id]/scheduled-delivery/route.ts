import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { DispatchRequestSchema } from "@/lib/tutorial/uploader-dispatch";
import { DeliveryError, queueScheduledDelivery } from "@/lib/uploader/scheduled-delivery";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!hasPermission(session, "upload:youtube-video")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = z.string().uuid().safeParse((await context.params).id);
  const declaration = DispatchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !declaration.success) return NextResponse.json({ error: "Valid tutorial ID and explicit upload declarations are required." }, { status: 400 });
  try {
    const result = await queueScheduledDelivery(id.data, session.userId, session.role === "ADMIN" || hasPermission(session, "manage:tutorial-settings"), declaration.data, session.role);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Delivery request failed" }, { status: error instanceof DeliveryError ? error.status : 409 }); }
}
