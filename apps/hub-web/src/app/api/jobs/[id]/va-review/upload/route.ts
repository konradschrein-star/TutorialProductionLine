import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db, contentJobs } from "@/lib/db";
import { loadRankingJob } from "@/lib/va-review-job";
import { toMediaUrl } from "@/lib/ranking-blocks";
import type { FootageCandidate, RankingItem } from "@repo/contracts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";
/**
 * Frame count tiled left→right into a candidate's filmstrip sprite, scaled to the
 * clip duration (~1 frame per 4s) and clamped. Replicated from
 * worker-orchestrator's ranking-footage-collection `spriteFrameCount` (do not
 * import across apps) — keep the two IDENTICAL. A 60s clip → 24 tiles (floor),
 * a 10-min clip → 120 tiles (ceiling).
 */
const SPRITE_MIN_FRAMES = 24;
const SPRITE_MAX_FRAMES = 120;
function spriteFrameCount(durationSeconds: number): number {
  const scaled = Math.round(durationSeconds / 4);
  return Math.max(SPRITE_MIN_FRAMES, Math.min(SPRITE_MAX_FRAMES, scaled));
}
/** Guard so a wedged ffmpeg/ffprobe can never stall the upload request. */
const SPRITE_EXEC_TIMEOUT_MS = 20_000;

/**
 * Human title from an uploaded filename: drop the extension, turn
 * underscores/dashes into spaces, collapse whitespace, cap the length.
 */
function deriveTitleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

/**
 * ffprobe a saved file for its duration (seconds). Best-effort: returns
 * undefined on any failure — duration is optional and must never fail an upload.
 * Mirrors the ffprobe call in worker-orchestrator's `generateCandidateSprite`.
 */
async function probeDurationSeconds(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nk=1:nv=1",
        path,
      ],
      { timeout: SPRITE_EXEC_TIMEOUT_MS },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Generate a CapCut-style filmstrip sprite (ONE JPG, SPRITE_FRAMES sampled
 * evenly across the clip and tiled left→right). Mirrors worker-orchestrator's
 * `generateCandidateSprite`. Requires a known duration; the caller wraps this in
 * try/catch so a sprite failure never fails the upload.
 */
async function generateUploadSprite(
  inputPath: string,
  jobId: string,
  itemId: string,
  candidateIndex: number,
  durationSeconds: number | undefined,
  spriteDir: string,
): Promise<{ spriteUrl: string; spriteFrames: number } | undefined> {
  if (!durationSeconds || durationSeconds <= 0) return undefined;
  const frames = spriteFrameCount(durationSeconds);
  const fps = frames / durationSeconds;
  const outPath = join(
    spriteDir,
    `${jobId}-${itemId}-cand${candidateIndex}.jpg`,
  );
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `fps=${fps},scale=-2:120,tile=${frames}x1`,
      "-q:v",
      "4",
      outPath,
    ],
    { timeout: SPRITE_EXEC_TIMEOUT_MS },
  );
  return { spriteUrl: `file://${outPath}`, spriteFrames: frames };
}

/**
 * POST /api/jobs/[id]/va-review/upload  (multipart)
 *
 * Fields: file (required), itemId (required), startMs?, endMs? (trim-on-import).
 * Saves under LOCAL_MEDIA_ROOT/va-uploads/<jobId>/<itemId>-<uuid>.mp4, appends a
 * source:"va-upload" candidate to that item's footageCandidates.
 * → { candidate, index }  (url rewritten to /api/media/...)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse form data: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const file = formData.get("file") as File | null;
  const itemId = formData.get("itemId");
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (typeof itemId !== "string" || itemId.length === 0) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const startMsRaw = formData.get("startMs");
  const endMsRaw = formData.get("endMs");
  const startMs =
    typeof startMsRaw === "string" && startMsRaw !== ""
      ? Number(startMsRaw)
      : undefined;
  const endMs =
    typeof endMsRaw === "string" && endMsRaw !== ""
      ? Number(endMsRaw)
      : undefined;

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

  // ── Hero-image replacement branch ─────────────────────────────────────────
  // target=hero: store the image (PNG/JPG/WEBP/GIF — transparency preserved) and
  // return its media URL. The client PATCHes it as heroSelection.imageUrl; the
  // render then uses it in the tier-board + reveal shots over the auto hero.
  if (formData.get("target") === "hero") {
    const ext = (
      (file.name.split(".").pop() || "png")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "png"
    ).slice(0, 5);
    const allowed = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
    const safeExt = allowed.has(ext) ? ext : "png";
    const heroDir = join(MEDIA_ROOT, "va-uploads", id);
    const heroPath = join(heroDir, `hero-${itemId}-${randomUUID()}.${safeExt}`);
    try {
      await mkdir(heroDir, { recursive: true });
      await writeFile(heroPath, Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      return NextResponse.json(
        {
          error: `Hero upload failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      heroUrl: `file://${heroPath}`,
      heroPreviewUrl: toMediaUrl(`file://${heroPath}`, MEDIA_ROOT),
    });
  }

  // Persist the file. TODO(trim-on-import): when startMs/endMs are provided we
  // should ffmpeg-trim to [startMs,endMs] to save disk. For v1 we store the full
  // file and record the intended trim in `attribution` so a follow-up can apply
  // it; the render still honours the block's brollSelection segment window.
  const uploadDir = join(MEDIA_ROOT, "va-uploads", id);
  const filename = `${itemId}-${randomUUID()}.mp4`;
  const absPath = join(uploadDir, filename);
  try {
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, buffer);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // ── Enrich the candidate: friendly title, duration, filmstrip sprite ──────
  // All three are best-effort — a failure here must NOT fail an otherwise
  // successful upload. Mirrors worker-orchestrator's generateCandidateSprite so
  // the studio (candidatesForItem) renders the same CapCut-style preview.
  const title = deriveTitleFromFilename(file.name);
  const durationSeconds = await probeDurationSeconds(absPath);

  const existing: FootageCandidate[] =
    ranking.items[idx].footageCandidates ?? [];
  const index = existing.length; // this upload's index in footageCandidates

  let spriteUrl: string | undefined;
  let spriteFrames: number | undefined;
  try {
    const spriteDir = join(MEDIA_ROOT, "ranking-sprites");
    await mkdir(spriteDir, { recursive: true });
    const sprite = await generateUploadSprite(
      absPath,
      id,
      itemId,
      index,
      durationSeconds,
      spriteDir,
    );
    if (sprite) {
      spriteUrl = sprite.spriteUrl;
      spriteFrames = sprite.spriteFrames;
    }
  } catch (err) {
    console.warn(
      `[va-review/upload] sprite generation failed for ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const intendedTrim =
    startMs !== undefined && endMs !== undefined
      ? `intended-trim:${startMs}-${endMs}ms`
      : undefined;

  const candidate: FootageCandidate = {
    url: `file://${absPath}`,
    source: "va-upload",
    kind: "video",
    ...(title ? { title } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(spriteUrl ? { spriteUrl } : {}),
    ...(spriteFrames ? { spriteFrames } : {}),
    ...(intendedTrim ? { attribution: intendedTrim } : {}),
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
    // `index` is embedded in the candidate to match the session-payload
    // candidate shape (BlockCandidate carries its own index); the UI appends
    // this object directly and references it via segment.candidateIndex.
    candidate: {
      index,
      ...candidate,
      url: toMediaUrl(candidate.url, MEDIA_ROOT) ?? candidate.url,
      ...(candidate.spriteUrl
        ? { spriteUrl: toMediaUrl(candidate.spriteUrl, MEDIA_ROOT) }
        : {}),
      ...(candidate.thumbnailUrl
        ? { thumbnailUrl: toMediaUrl(candidate.thumbnailUrl, MEDIA_ROOT) }
        : {}),
    },
    index,
  });
}
