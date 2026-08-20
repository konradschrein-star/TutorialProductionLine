import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, channels, ttsVoices } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The channel's narration voice.
 *
 * ## Why this endpoint exists
 *
 * `channels.voice_id` has existed since migration 0060 and had NO UI. The only
 * way to bind a voice to a channel was to write SQL, so nobody did — and all
 * three live tutorial channels silently shared one hardcoded voice. Every video
 * on every channel sounded like the same person, which for a network of
 * supposedly distinct channels is the kind of defect that is obvious the moment
 * anyone notices and invisible until then.
 *
 * A column the product depends on and no screen can set is not a feature, it is
 * a latent bug with a schema.
 *
 * ## Why unsetting is allowed
 *
 * `voice_id` is nullable and null is meaningful: it means "no channel-specific
 * voice, use the pipeline default". Forcing a choice would make the null state
 * unreachable from the UI, which is how you end up with a setting nobody can
 * undo.
 */

const PutSchema = z.object({
  /** null clears the binding and returns the channel to the pipeline default. */
  voiceId: z.string().uuid().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const [channel] = await db
    .select({
      id: channels.id,
      name: channels.name,
      language: channels.language,
      voiceId: channels.voice_id,
    })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const voices = await db
    .select({
      id: ttsVoices.id,
      name: ttsVoices.name,
      provider: ttsVoices.provider,
      voiceId: ttsVoices.voice_id,
      language: ttsVoices.language,
      isActive: ttsVoices.is_active,
      isDefault: ttsVoices.is_default,
    })
    .from(ttsVoices)
    .orderBy(asc(ttsVoices.provider), asc(ttsVoices.name));

  return NextResponse.json({
    channel,
    // Inactive voices are returned but flagged, so an existing binding to one
    // is visible rather than silently vanishing from the list.
    voices: voices.map((v) => ({ ...v, selectable: v.isActive })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Reject an unknown voice rather than writing a dangling reference. The FK
  // would catch it, but a 400 naming the problem beats a 500 from the driver.
  if (parsed.data.voiceId !== null) {
    const [voice] = await db
      .select({ id: ttsVoices.id })
      .from(ttsVoices)
      .where(eq(ttsVoices.id, parsed.data.voiceId))
      .limit(1);
    if (!voice) {
      return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
    }
  }

  const [updated] = await db
    .update(channels)
    .set({ voice_id: parsed.data.voiceId, updated_at: new Date() })
    .where(eq(channels.id, id))
    .returning({ id: channels.id, voiceId: channels.voice_id });

  if (!updated) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, voiceId: updated.voiceId });
}
