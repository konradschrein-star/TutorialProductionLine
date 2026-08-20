export const dynamic = "force-dynamic";
import { getDb } from "@repo/db/singleton";
import { ttsVoices } from "@repo/db/schema";
import { asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

/**
 * GET /api/tts-voices
 *
 * Fetches all active TTS voices grouped by provider.
 * Used by TTS voice picker in job creation form.
 */
export async function GET() {
  // This route is middleware-exempt, so it must gate itself. Any authenticated
  // user may read the voice list (it populates the job-creation picker).
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getDb();
    const voices = await db
      .select({
        id: ttsVoices.id,
        name: ttsVoices.name,
        voice_id: ttsVoices.voice_id,
        provider: ttsVoices.provider,
        language: ttsVoices.language,
        settings: ttsVoices.settings,
      })
      .from(ttsVoices)
      .where(eq(ttsVoices.is_active, true))
      .orderBy(asc(ttsVoices.provider), asc(ttsVoices.name));

    // Group by provider for UI rendering
    const grouped = voices.reduce(
      (acc, voice) => {
        const provider = voice.provider;
        if (!acc[provider]) {
          acc[provider] = [];
        }
        acc[provider].push(voice);
        return acc;
      },
      {} as Record<string, typeof voices>,
    );

    return Response.json({
      voices: grouped,
      total: voices.length,
    });
  } catch (error) {
    console.error("Failed to fetch TTS voices:", error);
    return Response.json(
      { error: "Failed to fetch TTS voices" },
      { status: 500 },
    );
  }
}
