import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { createCfIngestQueue, createRedisConnection } from "@repo/queue";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { cfPersonas, cfSources } from "@repo/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/sources?persona=<uuid>&limit=&offset=
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const url = req.nextUrl;
    const personaId = url.searchParams.get("persona");
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const query = personaId
      ? db
          .select()
          .from(cfSources)
          .where(eq(cfSources.persona_id, personaId))
          .orderBy(desc(cfSources.created_at))
          .limit(limit)
          .offset(offset)
      : db
          .select()
          .from(cfSources)
          .orderBy(desc(cfSources.created_at))
          .limit(limit)
          .offset(offset);

    const sources = await query;
    return { sources, limit, offset };
  });
}

/**
 * POST /api/v1/clip-forge/sources
 * Body: { persona_id, source_url, title?, source_kind? }
 *
 * Inserts a cf_sources row in `ingested` state and enqueues a CF_INGEST job
 * to download + transcribe.
 */
export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      persona_id?: string;
      source_url?: string;
      title?: string;
      source_kind?:
        | "youtube_vod"
        | "twitch_vod"
        | "podcast_rss"
        | "manual_upload"
        | "other";
      language?: string;
    };

    if (!body.persona_id || !body.source_url) {
      return new Response(
        JSON.stringify({ error: "persona_id and source_url are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const sourceKind = body.source_kind ?? guessKind(body.source_url);
    const externalId = extractExternalId(body.source_url) ?? body.source_url;

    // Language priority: explicit body.language > title-based heuristic >
    // persona.default_language > 'en'. Whisper takes the same code; DeepSeek
    // picks output language for suggestedCaption / reason AND switches its
    // system prompt to the target language when supported.
    let language = (body.language ?? "").toLowerCase().slice(0, 8);
    if (!language && body.title) {
      const guess = detectLanguageFromTitle(body.title);
      if (guess) language = guess;
    }
    if (!language) {
      const [persona] = await db
        .select()
        .from(cfPersonas)
        .where(eq(cfPersonas.id, body.persona_id))
        .limit(1);
      language = persona?.default_language ?? "en";
    }

    const [source] = await db
      .insert(cfSources)
      .values({
        persona_id: body.persona_id,
        external_id: externalId,
        source_kind: sourceKind,
        source_url: body.source_url,
        title: body.title ?? body.source_url,
        status: "ingested",
        language,
      })
      .returning();

    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    try {
      const queue = createCfIngestQueue(conn);
      await queue.add("cf-ingest", { source_id: source.id });
      await queue.close();
    } finally {
      await conn.quit().catch(() => {});
    }

    return { source };
  });
}

function guessKind(
  url: string,
): "youtube_vod" | "twitch_vod" | "podcast_rss" | "manual_upload" | "other" {
  // Local file already on the host: "file:///opt/..." or a bare absolute
  // POSIX path. This is the only ingest route that needs no third-party
  // binary or cookie jar, so it must be reachable from the same field the
  // Sources modal already has — otherwise nothing new can enter the system
  // while TwitchDownloaderCLI is uninstalled and the YouTube cookies are
  // missing. The worker enforces a root allow-list before reading anything.
  if (/^file:\/\//i.test(url) || url.startsWith("/")) return "manual_upload";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube_vod";
  // Twitch VODs (twitch.tv/videos/123) AND clips
  // (twitch.tv/<chan>/clip/Slug or clips.twitch.tv/Slug) both fall under
  // twitch_vod for now — the ingest worker passes a clip URL straight to
  // TwitchDownloaderCLI videodownload, which transparently downloads the
  // parent VOD. Pure clip support (clipdownload mode) is added when we
  // want to skip the moment-detection step for already-curated clips.
  if (/twitch\.tv/i.test(url)) return "twitch_vod";
  if (/\.rss$|\.xml$|podcast/i.test(url)) return "podcast_rss";
  return "other";
}

/**
 * Light language guess from a source title. Returns null when we have no
 * confidence — the caller falls through to persona default. Deliberately
 * narrow: catches the de/en split that matters today, won't pretend to know
 * the difference between e.g. Spanish and Portuguese.
 */
function detectLanguageFromTitle(title: string): string | null {
  const t = ` ${title.toLowerCase()} `;
  const score = (markers: string[]) =>
    markers.reduce((s, m) => s + (t.includes(` ${m} `) ? 1 : 0), 0);
  const deMarkers = [
    "der",
    "die",
    "das",
    "und",
    "ist",
    "ich",
    "wir",
    "mit",
    "für",
    "auf",
    "nicht",
    "ein",
    "eine",
    "stream",
    "deutsch",
    "heute",
    "warum",
    "wie",
    "über",
    "ohne",
    "gegen",
    "beim",
    "doch",
    "schon",
    "mal",
  ];
  const enMarkers = [
    "the",
    "and",
    "is",
    "of",
    "to",
    "in",
    "for",
    "on",
    "with",
    "why",
    "how",
    "what",
    "english",
    "today",
    "live",
    "vs",
    "stream",
  ];
  const de = score(deMarkers);
  const en = score(enMarkers);
  // Umlaut / ß is a strong DE signal even without stopword overlap.
  const hasGermanGlyphs = /[äöüÄÖÜß]/.test(title);
  if (hasGermanGlyphs && de >= en) return "de";
  if (de === 0 && en === 0) return null;
  if (de > en) return "de";
  if (en > de) return "en";
  return null;
}

function extractExternalId(url: string): string | null {
  // YouTube: ?v=ID or youtu.be/ID
  const yt =
    url.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (yt) return "yt:" + yt[1];

  // Twitch VOD: twitch.tv/videos/123456789
  const tv = url.match(/twitch\.tv\/videos\/(\d{6,})/i);
  if (tv) return "tw:vod:" + tv[1];

  // Twitch clip: twitch.tv/<chan>/clip/<Slug>  or  clips.twitch.tv/<Slug>
  const tc =
    url.match(/clips\.twitch\.tv\/([A-Za-z0-9-]+)/i) ??
    url.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9-]+)/i);
  if (tc) return "tw:clip:" + tc[1];

  return null;
}
