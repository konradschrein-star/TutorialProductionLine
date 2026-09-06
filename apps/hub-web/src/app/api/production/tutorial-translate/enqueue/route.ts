import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialJobs } from "@/lib/db";
import {
  DEFAULT_STANDARD_LANGUAGES,
  TARGET_LANGUAGE_CODES,
} from "@/lib/tutorial/languages";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
} from "@repo/queue";
import type { TutorialTranslatePayload } from "@repo/contracts";

export const dynamic = "force-dynamic";

const EnqueueSchema = z.object({
  sourceJobId: z.string().uuid(),
  languages: z.array(z.string()).min(1),
  mode: z.enum(["automatic", "manual"]).default("manual"),
});
type TargetLanguage = TutorialTranslatePayload["targetLanguage"];

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
  const { sourceJobId, languages, mode } = parsed.data;

  if (
    mode === "automatic" &&
    languages.some(
      (language) => !DEFAULT_STANDARD_LANGUAGES.includes(language),
    )
  ) {
    return NextResponse.json(
      {
        error: `Automatic translation is restricted to ${DEFAULT_STANDARD_LANGUAGES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Restrict to the supported launch set; ignore anything else the caller sends.
  const requested = Array.from(
    new Set(
      languages.filter((language): language is TargetLanguage =>
        TARGET_LANGUAGE_CODES.includes(language),
      ),
    ),
  );
  if (requested.length === 0) {
    return NextResponse.json(
      {
        error: `No supported languages requested (${TARGET_LANGUAGE_CODES.join(", ")})`,
      },
      { status: 400 },
    );
  }

  if (mode === "manual" && requested.length !== 1) {
    return NextResponse.json(
      { error: "Manual translation requests must select exactly one language" },
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
    return NextResponse.json(
      { error: "source job not found" },
      { status: 404 },
    );
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
