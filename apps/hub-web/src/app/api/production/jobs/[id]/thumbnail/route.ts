export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";
import { POST as generateEnglishCandidates } from "./ai/route";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  // `manage:thumbnails` is the uploader's narrow grant (see rbac.ts): they can
  // see and fix thumbnails on a finished tutorial video without holding
  // view:production (which would open the whole production engine).
  if (
    !session ||
    (!hasPermission(session, "view:production") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listThumbnailsForSubject("tutorial_job", id);
  return NextResponse.json(rows);
}

/** Compatibility adapter. All paid requests use the same guarded five-option service. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const job = await getTutorialJobById(db, id);
  if (!job || (job.created_by !== session.userId && !["ADMIN", "MANAGER"].includes(session.role) && !hasPermission(session, "manage:tutorial-settings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = z.object({ requestId: z.string().uuid().optional(), instructions: z.string().max(2000).optional(), mode: z.enum(["same", "changes", "iterate"]).default("same"), archetypeId: z.string().uuid().optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid generation options" }, { status: 400 });
  if (parsed.data.archetypeId) return NextResponse.json({ error: "Use the shared reference settings to change archetypes, then generate English options in the thumbnail workspace." }, { status: 409 });
  const candidates = await listThumbnailsForSubject("tutorial_job", id);
  const owned = candidates.filter(item => item.language === job.language && item.channel_id === job.channel_id && item.status === "completed");
  const parent = owned.find(item => item.is_selected) ?? owned[0];
  if (parsed.data.mode !== "same" && (!parent || !parsed.data.instructions?.trim())) return NextResponse.json({ error: "Choose a completed image and describe changes first." }, { status: 409 });
  const payload = { top: job.thumbnail_text_top ?? "", bottom: job.thumbnail_text_bottom ?? "", instructions: parsed.data.instructions ?? "", ...(parsed.data.mode !== "same" ? { parentThumbnailId: parent!.id } : {}) };
  // Empty-body legacy clients get deterministic identity, so network retries do
  // not buy another batch. The modern UI supplies an explicit new UUID.
  const hash = createHash("sha256").update(JSON.stringify({ id, title: job.title, channel: job.channel_id, ...payload })).digest("hex");
  const requestId = parsed.data.requestId ?? `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return generateEnglishCandidates(new NextRequest(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId }) }), { params: Promise.resolve({ id }) });
}
