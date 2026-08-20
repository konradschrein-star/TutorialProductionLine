import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, channels } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A channel's public YouTube identity: avatar, title, subscriber count.
 *
 * ## Cached, on purpose
 *
 * The plan asks for these "cached once". They are cosmetic and they change
 * slowly, so this stores them in `channels.metadata.youtube` and only refetches
 * when the cache is older than CACHE_TTL_MS. YouTube's Data API quota is a
 * daily allowance shared by everything on the project; spending it to re-render
 * an avatar on every page view would be a poor trade.
 *
 * ## Why it can return "not configured" instead of data
 *
 * The YouTube Data API needs an API key or OAuth, and this box currently has
 * NEITHER. The Google key present in `.env` is a Gemini key and YouTube rejects
 * it outright:
 *
 *     "API keys are not supported by this API. Expected OAuth2 access token..."
 *
 * So this endpoint reports `configured: false` with the reason, and the UI says
 * so plainly. It does not invent a subscriber count, and it does not silently
 * render an empty avatar as though the channel had none — the same rule the
 * upload sheet follows. Set YOUTUBE_API_KEY and it starts working with no code
 * change.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface YouTubeCache {
  title: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  fetchedAt: string;
}

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
      ytId: channels.youtube_channel_id,
      metadata: channels.metadata,
    })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const meta =
    channel.metadata &&
    typeof channel.metadata === "object" &&
    !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};
  const cached = meta["youtube"] as YouTubeCache | undefined;
  const fresh =
    cached?.fetchedAt &&
    Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS;

  if (fresh) {
    return NextResponse.json({ configured: true, cached: true, ...cached });
  }

  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      reason:
        'YOUTUBE_API_KEY is not set. The YouTube Data API needs its own API key or OAuth — the Google key in .env is a Gemini key and YouTube rejects it ("API keys are not supported by this API"). Set YOUTUBE_API_KEY and this starts working with no code change.',
      // Stale data is still shown, clearly labelled, rather than nothing.
      ...(cached ? { stale: true, ...cached } : {}),
    });
  }

  if (!channel.ytId || !/^UC[\w-]{22}$/.test(channel.ytId)) {
    return NextResponse.json({
      configured: true,
      reason: `Channel has no valid YouTube channel id (got ${JSON.stringify(channel.ytId)}).`,
    });
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channel.ytId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({
        configured: true,
        reason: `YouTube API returned ${res.status}: ${text.slice(0, 200)}`,
        ...(cached ? { stale: true, ...cached } : {}),
      });
    }
    const body = (await res.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
        statistics?: {
          subscriberCount?: string;
          hiddenSubscriberCount?: boolean;
        };
      }>;
    };
    const item = body.items?.[0];
    if (!item) {
      return NextResponse.json({
        configured: true,
        reason: "YouTube returned no channel for that id.",
      });
    }

    const subsRaw = item.statistics?.subscriberCount;
    const value: YouTubeCache = {
      title: item.snippet?.title ?? null,
      avatarUrl:
        item.snippet?.thumbnails?.["medium"]?.url ??
        item.snippet?.thumbnails?.["default"]?.url ??
        null,
      // Hidden counts are null, never 0 — "we cannot see it" is not "nobody
      // subscribes", and showing 0 would be a confident wrong number.
      subscriberCount:
        item.statistics?.hiddenSubscriberCount || subsRaw === undefined
          ? null
          : Number(subsRaw),
      fetchedAt: new Date().toISOString(),
    };

    await db
      .update(channels)
      .set({
        metadata: { ...meta, youtube: value } as never,
        updated_at: new Date(),
      })
      .where(eq(channels.id, id));

    return NextResponse.json({ configured: true, cached: false, ...value });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      reason: `YouTube lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      ...(cached ? { stale: true, ...cached } : {}),
    });
  }
}
