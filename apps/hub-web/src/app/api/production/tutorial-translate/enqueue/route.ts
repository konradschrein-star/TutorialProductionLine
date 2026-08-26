import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

/** The launch set of translation target languages (mirrors the translate payload). */
const TARGET_LANGUAGES = [
  "de", "fr", "it", "es", "nl", "sv", "no", "da",
  "pt", "pl", "cs", "ru", "ar", "zh", "ja", "ko", "id",
] as const;
type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

const EnqueueSchema = z.object({
  sourceJobId: z.string().uuid(),
  languages: z.array(z.string()).min(1),
});

/**
 * Fan out one tutorial-translate queue job per requested language for a
 * COMPLETED English source tutorial. Thin enqueue: the translate processor does
 * the LLM translate + TTS, creates a child tutorial_job, and hands off to the
 * existing splice lane. Skips a language whose child already exists.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = EnqueueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { sourceJobId, languages } = parsed.data;

  // Restrict to the supported launch set; ignore anything else the caller sends.
  const requested = Array.from(
    new Set(
      languages.filter((l): l is TargetLanguage =>
        (TARGET_LANGUAGES as readonly string[]).includes(l),
      ),
    ),
  );
  if (requested.length === 0) {
    return NextResponse.json(
      { error: `No supported languages requested (${TARGET_LANGUAGES.join(", ")})` },
      { status: 400 },
    );
  }

  // Source must exist and be a COMPLETED original (not itself a translation).
  const [source] = await db
    .select({
      id: tutorialJobs.id,
      status: tutorialJobs.status,
      recordingPath: tutorialJobs.recording_path,
      scriptText: tutorialJobs.script_text,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, sourceJobId))
    .limit(1);

  if (!source) {
    return NextResponse.json({ error: "source job not found" }, { status: 404 });
  }
  if (source.status !== "COMPLETED") {
    return NextResponse.json(
      { error: `source job is ${source.status}, not COMPLETED` },
      { status: 409 },
    );
  }
  if (!source.recordingPath || !source.scriptText) {
    return NextResponse.json(
      { error: "source job has no recording or script to translate" },
      { status: 409 },
    );
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }

  const enqueued: string[] = [];
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialTranslateQueue(conn);
    for (const lang of requested) {
      // Skip if a translation child already exists for this language.
      const [existing] = await db
        .select({ id: tutorialJobs.id })
        .from(tutorialJobs)
        .where(
          and(
            eq(tutorialJobs.source_job_id, sourceJobId),
            eq(tutorialJobs.language, lang),
          ),
        )
        .limit(1);
      if (existing) continue;

      await queue.add(
        "tutorial-translate",
        { sourceJobId, targetLanguage: lang },
        { jobId: `tutorial-translate-${sourceJobId}-${lang}`, attempts: 2 },
      );
      enqueued.push(lang);
    }
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ enqueued });
}
