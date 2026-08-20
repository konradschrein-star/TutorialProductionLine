export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicLibrary, musicGenerations } from "@repo/db/schema";
import type { MusicGenerationErrorCode } from "@repo/db/schema";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { getHubConfig } from "@/lib/config";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  submitSunoTask,
  pollSunoTask,
  downloadClip,
  parseSunoTags,
  SunoGenerationError,
  trySunoSlot,
  releaseSunoSlot,
  currentSunoInFlight,
  MAX_CONCURRENT_SUNO_GENERATIONS,
} from "../_lib/suno";
import { libraryDir, probeAudioFile } from "../_lib/probe";
import { interpretAudioProbe } from "../_lib/audio-file";

/**
 * POST /api/music-library/generate
 *
 * On-demand Suno (via AI33) music generation into the global library.
 *
 * Suno takes several minutes, so the HTTP request cannot wait. Instead of
 * firing a detached promise whose fate nobody can observe, every run gets a
 * `music_generations` row that moves queued -> running -> done|error. A 429
 * or an exhausted quota therefore shows up as a real failure with a reason,
 * which is the whole point given AI33's history of queue saturation.
 *
 * There is deliberately NO fallback to another music provider and never a
 * fabricated track: a failed generation stays failed.
 *
 * Body: { prompt, title?, instrumental?, genre?, format? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      prompt?: string;
      title?: string;
      instrumental?: boolean;
      genre?: string;
      format?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "A prompt is required" },
        { status: 400 },
      );
    }

    const apiKey = getHubConfig().AI33_API_KEY;
    if (!apiKey || apiKey === "mock") {
      return NextResponse.json(
        {
          error:
            "AI33_API_KEY is not configured on this host, so Suno generation is unavailable.",
        },
        { status: 503 },
      );
    }

    // Refuse rather than pile onto a queue we know gets saturated.
    if (!trySunoSlot()) {
      return NextResponse.json(
        {
          error: `Already running ${currentSunoInFlight()} of a maximum ${MAX_CONCURRENT_SUNO_GENERATIONS} concurrent Suno generations. Wait for one to finish.`,
          code: "local_concurrency_limit",
        },
        { status: 429 },
      );
    }

    const title = body.title?.trim() || "Generated track";
    const instrumental = body.instrumental ?? true;
    const genre = body.genre?.trim() || null;
    const format = body.format?.trim() || null;

    const [generation] = await db
      .insert(musicGenerations)
      .values({
        provider: "ai33:suno",
        prompt,
        title,
        instrumental,
        genre,
        format,
        status: "queued",
        requested_by: session.userId ?? null,
      })
      .returning();

    if (!generation) {
      releaseSunoSlot();
      return NextResponse.json(
        { error: "Failed to record the generation request" },
        { status: 500 },
      );
    }

    // Detached, but its outcome is durable in music_generations.
    void runGeneration({
      generationId: generation.id,
      apiKey,
      prompt,
      title,
      instrumental,
      genre,
      format,
    }).finally(() => releaseSunoSlot());

    return NextResponse.json(
      {
        generation,
        message:
          "Suno generation started (typically 3-8 minutes). Both clips Suno returns will be added to the library.",
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[music-library/generate] error:", error);
    return NextResponse.json(
      { error: "Failed to start music generation" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/music-library/generate
 * Recent generations, so the UI can show what is running and what failed.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitRaw = Number.parseInt(
      request.nextUrl.searchParams.get("limit") ?? "25",
      10,
    );
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 25;

    const generations = await db
      .select()
      .from(musicGenerations)
      .orderBy(desc(musicGenerations.created_at))
      .limit(limit);

    return NextResponse.json({
      generations,
      inFlight: currentSunoInFlight(),
      maxConcurrent: MAX_CONCURRENT_SUNO_GENERATIONS,
    });
  } catch (error) {
    console.error("[music-library/generate] list error:", error);
    return NextResponse.json(
      { error: "Failed to list generations" },
      { status: 500 },
    );
  }
}

async function runGeneration(args: {
  generationId: string;
  apiKey: string;
  prompt: string;
  title: string;
  instrumental: boolean;
  genre: string | null;
  format: string | null;
}): Promise<void> {
  const { generationId, apiKey, prompt, title, instrumental, genre, format } =
    args;
  const written: string[] = [];

  const fail = async (code: MusicGenerationErrorCode, message: string) => {
    // Clean up any partially written audio so a failed run leaves no orphans.
    await Promise.all(written.map((p) => unlink(p).catch(() => {})));
    await db
      .update(musicGenerations)
      .set({
        status: "error",
        error_code: code,
        error_message: message.slice(0, 2000),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(musicGenerations.id, generationId));
    console.error(
      JSON.stringify({
        level: "error",
        event: "music_generation_failed",
        generation_id: generationId,
        error_code: code,
        message,
      }),
    );
  };

  try {
    await db
      .update(musicGenerations)
      .set({ status: "running", updated_at: new Date() })
      .where(eq(musicGenerations.id, generationId));

    const taskId = await submitSunoTask(apiKey, { prompt, instrumental });

    await db
      .update(musicGenerations)
      .set({ provider_task_id: taskId, updated_at: new Date() })
      .where(eq(musicGenerations.id, generationId));

    const result = await pollSunoTask(apiKey, taskId);

    const dir = libraryDir();
    await mkdir(dir, { recursive: true });

    const trackIds: string[] = [];

    // Suno returns two clips per task. Ingest both — the previous
    // implementation kept only clips[0] and discarded half of a paid run.
    for (let i = 0; i < result.clips.length; i++) {
      const clip = result.clips[i]!;
      const trackId = randomUUID();
      const filePath = join(dir, `${trackId}.mp3`);

      const buffer = await downloadClip(clip.audio_url!);
      await writeFile(filePath, buffer);
      written.push(filePath);

      const probed = interpretAudioProbe(await probeAudioFile(filePath));
      if (!probed.ok) {
        await fail(
          "probe_failed",
          `Downloaded clip ${i + 1} of ${result.clips.length} could not be probed: ${probed.error}`,
        );
        return;
      }

      const clipTitle = clip.title?.trim() || title;
      const [inserted] = await db
        .insert(musicLibrary)
        .values({
          id: trackId,
          name:
            result.clips.length > 1
              ? `${clipTitle} (${i + 1}/${result.clips.length})`
              : clipTitle,
          file_path: filePath,
          duration_seconds: probed.audio.durationSeconds,
          genre,
          format,
          // Exactly the provenance the library was missing.
          creator: "Suno (AI33)",
          source: "suno_ai33",
          license: "Suno subscription — commercial use",
          attribution_required: false,
          tags: parseSunoTags(clip.tags),
          file_bytes: buffer.byteLength,
          generation_prompt: prompt,
          generation_provider: "ai33:suno",
          generation_task_id: taskId,
        })
        .returning({ id: musicLibrary.id });

      if (inserted) trackIds.push(inserted.id);
    }

    await db
      .update(musicGenerations)
      .set({
        status: "done",
        track_ids: trackIds,
        credit_cost: result.creditCost,
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(musicGenerations.id, generationId));

    console.warn(
      JSON.stringify({
        level: "info",
        event: "music_generation_done",
        generation_id: generationId,
        task_id: taskId,
        tracks: trackIds.length,
        credit_cost: result.creditCost,
      }),
    );
  } catch (error) {
    if (error instanceof SunoGenerationError) {
      await fail(error.code, error.message);
    } else {
      await fail(
        "unknown",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
