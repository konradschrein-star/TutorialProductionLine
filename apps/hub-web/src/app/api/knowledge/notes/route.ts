import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  listVideoNotes,
  createVideoNote,
  deleteVideoNote,
} from "@/lib/repositories/knowledge-repository";

export const dynamic = "force-dynamic";

const CreateNoteBody = z.object({
  videoId: z.string().uuid(),
  timestampSeconds: z.number().int().min(0).nullable().optional(),
  content: z.string().min(1).max(10000),
});

/**
 * GET /api/knowledge/notes?videoId=<uuid>
 * Returns all notes for the requesting user on a specific video.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const notes = await listVideoNotes(session.userId, videoId);
  return NextResponse.json({ notes });
}

/**
 * POST /api/knowledge/notes
 * Creates a new note for the requesting user.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid JSON in request body",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const parsed = CreateNoteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body format",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const note = await createVideoNote({
    userId: session.userId,
    videoId: parsed.data.videoId,
    timestampSeconds: parsed.data.timestampSeconds ?? null,
    content: parsed.data.content,
  });

  return NextResponse.json({ note }, { status: 201 });
}

/**
 * DELETE /api/knowledge/notes?noteId=<uuid>
 * Deletes a note owned by the requesting user.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:knowledge")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = request.nextUrl.searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "Missing noteId" }, { status: 400 });
  }

  await deleteVideoNote(noteId, session.userId);
  return NextResponse.json({ deleted: true });
}
