import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth/jwt";
import {
  createReferenceScript,
  listReferenceScripts,
} from "@repo/db/repositories";

export const dynamic = "force-dynamic";

/**
 * GET  /api/drama/clip-libraries/[id]/reference-scripts
 *   → list of reference scripts (without full content, to keep
 *     the payload tiny; client requests content via the [refId]
 *     route when it wants to preview/edit).
 *
 * POST /api/drama/clip-libraries/[id]/reference-scripts
 *   Body: { name: string, content: string }
 *   → create one
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const rows = await listReferenceScripts(id);
  console.warn(
    JSON.stringify({
      event: "refs_list",
      library_id: id,
      count: rows.length,
    }),
  );
  return NextResponse.json({
    scripts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      word_count: r.word_count,
      last_used_at: r.last_used_at,
      created_at: r.created_at,
      // Brief preview only — full content fetched on demand.
      preview: r.content.slice(0, 280),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    content?: string;
  };
  if (!body.name?.trim() || !body.content?.trim()) {
    return NextResponse.json(
      { error: "name and content required" },
      { status: 400 },
    );
  }
  const row = await createReferenceScript({
    clip_library_id: id,
    name: body.name.trim(),
    content: body.content,
  });
  return NextResponse.json({ ok: true, script: row });
}
