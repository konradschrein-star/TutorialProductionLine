import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, channels, thumbnails, tutorialJobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { normalizeTutorialLanguage, resolveTutorialChannelTargets } from "@repo/contracts";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";

export const dynamic = "force-dynamic";
const querySchema = z.object({ q: z.string().max(200).default(""), before: z.string().datetime().optional(), beforeId: z.string().uuid().optional() });
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || Boolean(parsed.data.before) !== Boolean(parsed.data.beforeId)) return NextResponse.json({ error: "Invalid search or cursor" }, { status: 400 });
  const privileged = hasPermission(session, "manage:tutorial-settings") || session.role === "ADMIN" || session.role === "MANAGER";
  const { q, before, beforeId } = parsed.data;
  const sources = await db.select({ id: tutorialJobs.id, title: tutorialJobs.title, createdAt: tutorialJobs.created_at, channelId: tutorialJobs.channel_id, channelName: channels.name, language: tutorialJobs.language, status: tutorialJobs.status })
    .from(tutorialJobs).leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(and(isNull(tutorialJobs.source_job_id), isNull(tutorialJobs.parent_job_id), isNotNull(tutorialJobs.recording_path), ne(tutorialJobs.status, "CANCELLED"), privileged ? undefined : eq(tutorialJobs.created_by, session.userId), q ? ilike(tutorialJobs.title, `%${q}%`) : undefined,
      before && beforeId ? or(lt(tutorialJobs.created_at, new Date(before)), and(eq(tutorialJobs.created_at, new Date(before)), lt(tutorialJobs.id, beforeId))) : undefined))
    .orderBy(desc(tutorialJobs.created_at), desc(tutorialJobs.id)).limit(25);
  const page = sources.slice(0, 24);
  const ids = page.map((row) => row.id);
  const children = ids.length ? await db.select({ id: tutorialJobs.id, sourceId: tutorialJobs.source_job_id, title: tutorialJobs.title, language: tutorialJobs.language, channelId: tutorialJobs.channel_id, status: tutorialJobs.status }).from(tutorialJobs).where(inArray(tutorialJobs.source_job_id, ids)) : [];
  const familyIds = [...ids, ...children.map((row) => row.id)];
  const configuredChannels = await db.select({ id: channels.id, language: channels.language, isPrimary: channels.is_primary, enabled: channels.accepts_tutorials, metadata: channels.metadata }).from(channels);
  const assets = familyIds.length ? await db.select({ id: thumbnails.id, subjectId: thumbnails.subject_id, language: thumbnails.language, channelId: thumbnails.channel_id, status: thumbnails.status, isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path, verdict: thumbnails.review_verdict }).from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, familyIds))) : [];
  const rows = page.map((source) => {
    const family = [source, ...children.filter((row) => row.sourceId === source.id)];
    const languages = ["en", ...resolveTutorialChannelTargets(source.channelId, configuredChannels).targets.map((target) => target.language)];
    const variants = languages.map((language) => {
      const matches = family.filter((row) => normalizeTutorialLanguage(row.language) === language);
      const owner = matches.length === 1 ? matches[0] : undefined;
      const selection = owner ? assessTutorialThumbnailSelection(owner, assets.filter((row) => row.subjectId === owner.id)) : null;
      const selected = selection?.thumbnail ? assets.find((row) => row.id === selection.thumbnail!.id) : null;
      return { language, jobId: owner?.id ?? null, status: owner?.status ?? "NOT_PREPARED", thumbnailId: selected?.id ?? null, approved: Boolean(selected && ["acceptable", "strong"].includes(selected.verdict)), reasons: selection?.reasons ?? [matches.length > 1 ? "Duplicate language records" : "Prepare the language draft"] };
    });
    return { id: source.id, title: source.title, channelName: source.channelName, variants, approved: variants.every((variant) => variant.approved) };
  });
  const last = page[page.length - 1];
  return NextResponse.json({ rows, scope: privileged ? "all" : "mine", nextCursor: sources.length > 24 && last ? { before: last.createdAt.toISOString(), beforeId: last.id } : null });
}
