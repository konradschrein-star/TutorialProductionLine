import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import {
  deleteReferenceScript,
  getReferenceScriptById,
  updateReferenceScript,
} from "@repo/db/repositories";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; refId: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { refId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(refId))
    return NextResponse.json({ error: "Bad refId" }, { status: 400 });
  const row = await getReferenceScriptById(refId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ script: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; refId: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { refId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(refId))
    return NextResponse.json({ error: "Bad refId" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    content?: string;
  };
  await updateReferenceScript(refId, body);
  const row = await getReferenceScriptById(refId);
  return NextResponse.json({ ok: true, script: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; refId: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { refId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(refId))
    return NextResponse.json({ error: "Bad refId" }, { status: 400 });
  await deleteReferenceScript(refId);
  return NextResponse.json({ ok: true });
}
