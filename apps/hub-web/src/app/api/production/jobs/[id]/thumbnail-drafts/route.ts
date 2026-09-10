import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeTutorialLanguage } from "@repo/contracts";
import { db, channels, tutorialJobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { configuredTutorialLocales, resolveLocaleChannel } from "@/lib/tutorial/locale-routing";

export const dynamic = "force-dynamic";

/** Allocate stable locale identities BEFORE any translation/TTS work. Repeated
 * requests preserve existing drafts, completed work, copy and channel routing. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid tutorial id" }, { status: 400 });
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).limit(1).for("update");
    if (!source) return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
    if (source.created_by !== session.userId && !hasPermission(session, "manage:tutorial-settings")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (source.source_job_id || normalizeTutorialLanguage(source.language) !== "en") return NextResponse.json({ error: "Prepare thumbnails from the English original." }, { status: 409 });
    if (!source.channel_id) return NextResponse.json({ error: "Assign the source channel first." }, { status: 409 });
    const [sourceChannel] = await tx.select().from(channels).where(eq(channels.id, source.channel_id)).limit(1);
    const destinations = await tx.select({ id: channels.id, language: channels.language }).from(channels).where(eq(channels.accepts_tutorials, true));
    const existing = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.source_job_id, id));
    const mapping = (sourceChannel?.metadata as Record<string, unknown> | null)?.tutorialLocaleChannels;
    // Preflight every destination before inserting anything. No partial pack
    // from a response that reports a routing failure.
    const planned: Array<{ language: string; channelId: string }> = [];
    const configuredLanguages = configuredTutorialLocales(mapping, existing);
    for (const language of configuredLanguages) {
      const matches = existing.filter((row) => normalizeTutorialLanguage(row.language) === language);
      if (matches.length > 1) return NextResponse.json({ error: `${language}: duplicate language records need reconciliation.` }, { status: 409 });
      if (matches.length) continue;
      try { planned.push({ language, channelId: resolveLocaleChannel(language, destinations, mapping).id }); }
      catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 409 }); }
    }
    const created: string[] = [];
    for (const locale of planned) {
      const [draft] = await tx.insert(tutorialJobs).values({
        created_by: source.created_by, source_job_id: source.id, batch_id: source.batch_id,
        channel_id: locale.channelId, language: locale.language, title: source.title,
        mode: source.mode, status: "AWAITING_THUMBNAILS", script_provider: source.script_provider,
        script_model: source.script_model, tts_provider: source.tts_provider, tts_voice: source.tts_voice,
        voice_settings: source.voice_settings,
        // English title is only the draft's work label. Localized publishing
        // metadata remains absent until the translation stage produces it.
      }).returning({ id: tutorialJobs.id });
      if (draft) created.push(draft.id);
    }
    return NextResponse.json({ sourceId: id, created, languages: configuredLanguages, state: "awaiting_thumbnail_copy", providerCalls: 0 });
  });
}
