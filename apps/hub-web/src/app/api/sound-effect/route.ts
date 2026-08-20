export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { getHubConfig } from "@/lib/config";
import {
  submitAi33Json,
  pollAi33Task,
  resolveAudioUrl,
  downloadAi33Buffer,
} from "@/lib/ai33-tasks";

/**
 * POST /api/sound-effect
 *
 * On-demand ElevenLabs sound-effect generation via AI33. Sound effects are
 * short (0.5–30s) so this awaits completion and returns the audio inline as
 * `audio/mpeg`. There is no sound-effects table, so nothing is persisted —
 * the caller downloads/saves the bytes.
 *
 * Credit cost: auto duration = 200 credits; specified = 50 credits/sec.
 *
 * Body: { text: string, durationSeconds?: number, promptInfluence?: number,
 *         loop?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      text?: string;
      durationSeconds?: number;
      promptInfluence?: number;
      loop?: boolean;
    };
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > 450) {
      return NextResponse.json(
        { error: "text must be 450 characters or fewer" },
        { status: 400 },
      );
    }

    const apiKey = getHubConfig().AI33_API_KEY;
    if (!apiKey || apiKey === "mock") {
      return NextResponse.json(
        { error: "AI33_API_KEY not configured" },
        { status: 503 },
      );
    }

    const payload: Record<string, unknown> = {
      text,
      prompt_influence: body.promptInfluence ?? 0.3,
      loop: body.loop ?? false,
      model_id: "eleven_text_to_sound_v2",
    };
    if (body.durationSeconds != null) {
      payload["duration_seconds"] = Math.min(
        30,
        Math.max(0.5, body.durationSeconds),
      );
    }

    const taskId = await submitAi33Json(
      apiKey,
      "/v1/task/sound-effect",
      payload,
    );
    const task = await pollAi33Task(apiKey, taskId, {
      label: "sound-effect",
      intervalMs: 4000,
      maxAttempts: 60,
    });

    const url = resolveAudioUrl(task);
    if (!url) {
      return NextResponse.json(
        { error: "sound-effect completed but returned no audio" },
        { status: 502 },
      );
    }
    const audio = await downloadAi33Buffer(url);

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Content-Disposition": 'inline; filename="sound-effect.mp3"',
      },
    });
  } catch (error) {
    console.error("[sound-effect] error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
