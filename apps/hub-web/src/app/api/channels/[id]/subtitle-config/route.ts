import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getChannelById,
  updateSubtitleConfig,
  type SubtitleConfig,
} from "@/lib/repositories/channel-repository";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Middleware-exempt route — gate here. Read is available to any session
  // (populates the CE form's subtitle-config panel).
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const channel = await getChannelById(id);
  if (!channel)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    subtitle_config: channel.subtitle_config ?? null,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Called inline by the CE create form (whose users are job-creators), and by
  // channel admins — accept either so the guard closes the unauth hole without
  // breaking the active create workflow.
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "create:job") &&
      !hasPermission(session, "edit:channel"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json()) as SubtitleConfig;
  await updateSubtitleConfig(id, body);
  return NextResponse.json({ success: true });
}
