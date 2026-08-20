import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { loadRankingJob } from "@/lib/va-review-job";
import { toMediaUrl } from "@/lib/ranking-blocks";
import type { FootageCandidate, RankingItem } from "@repo/contracts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
const YT_DLP_BIN = process.env["YT_DLP_BIN"] ?? "yt-dlp";

/**
 * yt-dlp auth/bypass args — the SAME env contract worker-orchestrator's
 * yt-dlp-client already owns (`YT_DLP_COOKIES` + `YT_DLP_EXTRACTOR_ARGS`, the
 * latter being the hook for the bgutil PO-token provider on 127.0.0.1:4416).
 *
 * This route used to shell out to a bare `yt-dlp` with no auth at all. YouTube
 * bot-walls this datacenter IP intermittently, so a paste that worked in the
 * morning would fail in the afternoon with a raw extractor dump the VA could
 * not act on. Both vars are optional: absent env → behaviour unchanged.
 */
const YT_DLP_COOKIES = process.env["YT_DLP_COOKIES"];
const YT_DLP_EXTRACTOR_ARGS = process.env["YT_DLP_EXTRACTOR_ARGS"];

function ytAuthArgs(): string[] {
  const args: string[] = [];
  if (YT_DLP_COOKIES && existsSync(YT_DLP_COOKIES)) {
    args.push("--cookies", YT_DLP_COOKIES);
  }
  if (YT_DLP_EXTRACTOR_ARGS) {
    args.push("--extractor-args", YT_DLP_EXTRACTOR_ARGS);
  }
  return args;
}

/**
 * Turn a raw yt-dlp failure into something a VA can act on.
 *
 * The studio previously showed the extractor's own words, and separately
 * carried a hardcoded "Please use a VPN" chip — so an operator watching a
 * SERVER-SIDE download was told to change the network on his own laptop, which
 * cannot affect anything. Downloads run on the VPS; the fix is always cookies
 * or the PO-token provider, never the VA's connection.
 */
function explainYtDlpFailure(raw: string): string {
  const text = raw.toLowerCase();
  const cookiesConfigured = Boolean(
    YT_DLP_COOKIES && existsSync(YT_DLP_COOKIES),
  );
  const cookieHint = cookiesConfigured
    ? "The server's YouTube cookies are configured but were rejected — they have most likely expired and need re-exporting on the VPS (YT_DLP_COOKIES)."
    : "The server has no YouTube cookies configured (YT_DLP_COOKIES is unset or points at a missing file). An operator needs to export a fresh cookies.txt onto the VPS.";

  if (
    text.includes("sign in to confirm") ||
    text.includes("not a bot") ||
    text.includes("cookies") ||
    text.includes("age-restricted") ||
    text.includes("login required")
  ) {
    return `YouTube blocked the server's download (bot check). ${cookieHint} This is a server-side fetch — a VPN on your own machine makes no difference.`;
  }
  if (text.includes("po token") || text.includes("po_token")) {
    return `YouTube demanded a PO token. The bgutil PO-token provider (docker, 127.0.0.1:4416) or YT_DLP_EXTRACTOR_ARGS is not reachable from hub-web — an operator needs to check it on the VPS.`;
  }
  if (text.includes("video unavailable") || text.includes("private video")) {
    return "That video is unavailable or private — try a different source.";
  }
  if (text.includes("timed out") || text.includes("etimedout")) {
    return "The download timed out on the server. Try a shorter video, or retry.";
  }
  return `Download failed on the server: ${raw.split("\n").slice(-3).join(" ").trim().slice(0, 300)}`;
}
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN =
  process.env["FFPROBE_PATH"] ?? process.env["FFPROBE_BIN"] ?? "ffprobe";

/**
 * Seconds of the pasted source to download. Raised to 600 (10 min) so the WHOLE
 * video is pulled (yt-dlp stops at the real end when shorter) and the studio's
 * trim handles can carve the useful part out. Mirrors ranking-footage-collection's
 * CANDIDATE_SOURCE_SECONDS and yt-dlp-client's MAX_CLIP_SECONDS. Downloads are
 * temporary (only the source URL is persisted post-render).
 */
const CLIP_SECONDS = 600;
const META_TIMEOUT_MS = 30_000;
/** Generous so a full ~10 min source has time to download and merge. */
const DOWNLOAD_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 30_000;
/** Guard so a wedged ffmpeg can never stall the request. */
const SPRITE_EXEC_TIMEOUT_MS = 30_000;

/**
 * Frame count tiled left→right into the filmstrip sprite, scaled to the clip
 * duration (~1 frame per 4s) and clamped. IDENTICAL to the copy in
 * worker-orchestrator's ranking-footage-collection and hub-web's va-review/upload
 * route (do not import across apps). A 60s clip → 24 tiles, a 10-min clip → 120.
 */
const SPRITE_MIN_FRAMES = 24;
const SPRITE_MAX_FRAMES = 120;
function spriteFrameCount(durationSeconds: number): number {
  const scaled = Math.round(durationSeconds / 4);
  return Math.max(SPRITE_MIN_FRAMES, Math.min(SPRITE_MAX_FRAMES, scaled));
}

// Landscape / quality bar — kept in step with worker footage-quality-gate.
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;
const MIN_ASPECT = 1.2;

const bodySchema = z.object({ url: z.string().min(1) });

function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com"
    );
  } catch {
    return false;
  }
}

/** Lightweight relevance check: do the product's distinctive tokens appear in
 *  the source title? Best-effort — undefined when there's nothing to verify. */
function titleMatches(title: string, productName: string): boolean | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);
  const prod = norm(productName);
  if (prod.length === 0) return undefined;
  const titleSet = new Set(norm(title));
  const matched = prod.filter((t) => titleSet.has(t)).length;
  return matched / prod.length >= 0.5;
}

interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
}

async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      path,
    ],
    { timeout: PROBE_TIMEOUT_MS },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const s = parsed.streams?.[0];
  return {
    width: s?.width ?? 0,
    height: s?.height ?? 0,
    durationSeconds: Number(parsed.format?.duration ?? "0"),
  };
}

/**
 * POST /api/jobs/[id]/va-review/blocks/[itemId]/add-url  { url }
 *
 * Downloads a pasted YouTube URL with yt-dlp (whole video up to CLIP_SECONDS),
 * quality-gates it (landscape + min resolution), builds a duration-scaled
 * filmstrip sprite, and appends a source:"va-url" FootageCandidate to the item so
 * it appears as the next source row in the studio.
 * → { candidate }  (url + spriteUrl rewritten to /api/media/...)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, itemId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  const url = parsed.data.url.trim();
  if (!isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: "Only YouTube URLs are supported" },
      { status: 400 },
    );
  }

  const loaded = await loadRankingJob(id);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: loaded.error },
      { status: loaded.status },
    );
  }
  const { job, ranking } = loaded;
  const idx = ranking.items.findIndex((it) => it.id === itemId);
  if (idx < 0) {
    return NextResponse.json(
      { error: `Item ${itemId} not found in ranking` },
      { status: 404 },
    );
  }

  // Refuse a source this item already has. Two paths (create-time upload pool
  // + the worker's yt-dlp fetch) already drop the same video in twice on real
  // jobs, producing source rows that look different and behave identically;
  // there is no reason to let a paste add a third copy.
  const already = (ranking.items[idx].footageCandidates ?? []).findIndex(
    (c) => c.sourceUrl === url,
  );
  if (already >= 0) {
    return NextResponse.json(
      {
        error: `This item already has that video as source ${already + 1} — pick a different one.`,
      },
      { status: 409 },
    );
  }

  // Fetch the real title (best-effort — never blocks the download).
  let title: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      YT_DLP_BIN,
      [
        ...ytAuthArgs(),
        "--print",
        "%(title)s",
        "--skip-download",
        "--no-warnings",
        "--quiet",
        url,
      ],
      { timeout: META_TIMEOUT_MS },
    );
    const t = stdout.trim().split("\n")[0]?.trim();
    if (t) title = t;
  } catch {
    /* title stays undefined */
  }

  const uploadDir = join(MEDIA_ROOT, "va-uploads", id);
  const filename = `${itemId}-url-${randomUUID()}.mp4`;
  const absPath = join(uploadDir, filename);

  try {
    await mkdir(uploadDir, { recursive: true });
    await execFileAsync(
      YT_DLP_BIN,
      [
        ...ytAuthArgs(),
        url,
        "--download-sections",
        `*0-${CLIP_SECONDS}`,
        "-f",
        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--merge-output-format",
        "mp4",
        "--no-warnings",
        "--quiet",
        "-o",
        absPath,
      ],
      { timeout: DOWNLOAD_TIMEOUT_MS },
    );
  } catch (err) {
    const raw =
      err instanceof Error
        ? `${err.message}\n${(err as { stderr?: string }).stderr ?? ""}`
        : String(err);
    console.error(`[va-review/add-url] yt-dlp failed for ${url}: ${raw}`);
    await unlink(absPath).catch(() => {});
    return NextResponse.json(
      { error: explainYtDlpFailure(raw) },
      { status: 502 },
    );
  }

  // Quality / landscape gate.
  let metrics: ProbeResult;
  try {
    metrics = await probe(absPath);
  } catch (err) {
    await unlink(absPath).catch(() => {});
    return NextResponse.json(
      {
        error: `Could not probe clip: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
  const aspect = metrics.height > 0 ? metrics.width / metrics.height : 0;
  const reasons: string[] = [];
  if (metrics.width < MIN_WIDTH || metrics.height < MIN_HEIGHT) {
    reasons.push(
      `resolution ${metrics.width}x${metrics.height} below ${MIN_WIDTH}x${MIN_HEIGHT}`,
    );
  }
  if (aspect < MIN_ASPECT) {
    reasons.push(
      `aspect ${aspect.toFixed(2)} is not landscape (min ${MIN_ASPECT})`,
    );
  }
  if (reasons.length > 0) {
    await unlink(absPath).catch(() => {});
    return NextResponse.json(
      { error: `Clip rejected: ${reasons.join("; ")}` },
      { status: 422 },
    );
  }

  const productMatched = title
    ? titleMatches(title, ranking.items[idx].name)
    : undefined;

  const existing: FootageCandidate[] =
    ranking.items[idx].footageCandidates ?? [];
  const index = existing.length; // this candidate's index in footageCandidates

  // ── Filmstrip sprite (best-effort — a failure never fails the add-url) ─────
  // Duration-scaled tile count so a long source stays scrubbable in the studio.
  // Mirrors worker-orchestrator's generateCandidateSprite + va-review/upload.
  let spriteUrl: string | undefined;
  let spriteFrames: number | undefined;
  if (metrics.durationSeconds > 0) {
    try {
      const spriteDir = join(MEDIA_ROOT, "ranking-sprites");
      await mkdir(spriteDir, { recursive: true });
      const frames = spriteFrameCount(metrics.durationSeconds);
      const fps = frames / metrics.durationSeconds;
      const spritePath = join(spriteDir, `${id}-${itemId}-cand${index}.jpg`);
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          absPath,
          "-frames:v",
          "1",
          "-vf",
          `fps=${fps},scale=-2:120,tile=${frames}x1`,
          "-q:v",
          "4",
          spritePath,
        ],
        { timeout: SPRITE_EXEC_TIMEOUT_MS },
      );
      spriteUrl = `file://${spritePath}`;
      spriteFrames = frames;
    } catch (err) {
      console.warn(
        `[va-review/add-url] sprite generation failed for ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const candidate: FootageCandidate = {
    url: `file://${absPath}`,
    source: "va-url",
    kind: "video",
    sourceUrl: url,
    ...(title ? { title } : {}),
    ...(productMatched !== undefined ? { productMatched } : {}),
    ...(metrics.durationSeconds > 0
      ? { durationSeconds: metrics.durationSeconds }
      : {}),
    ...(spriteUrl ? { spriteUrl } : {}),
    ...(spriteFrames ? { spriteFrames } : {}),
  };

  const newCandidates = [...existing, candidate];

  const updatedItem: RankingItem = {
    ...ranking.items[idx],
    footageCandidates: newCandidates,
  };
  const updatedItems = ranking.items.map((it, i) =>
    i === idx ? updatedItem : it,
  );
  const newMetadata = {
    ...job.metadata,
    ranking: { ...ranking, items: updatedItems },
  };

  await db
    .update(contentJobs)
    .set({ metadata: newMetadata, updated_at: new Date() })
    .where(eq(contentJobs.id, id));

  return NextResponse.json({
    candidate: {
      index,
      ...candidate,
      url: toMediaUrl(candidate.url, MEDIA_ROOT) ?? candidate.url,
      ...(candidate.spriteUrl
        ? { spriteUrl: toMediaUrl(candidate.spriteUrl, MEDIA_ROOT) }
        : {}),
    },
    index,
  });
}
