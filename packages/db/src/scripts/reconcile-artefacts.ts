#!/usr/bin/env tsx
/**
 * Artefact ⇄ disk reconciliation (decision C6, 2026-07-28).
 *
 * "Report first, act second." The database's record of artefacts and the actual
 * filesystem have drifted. Verified on prod 2026-07-28: of 244 manifest entries,
 * exactly 2 files existed and 242 were gone; 13 SPACE_VIDEO rows claim PUBLISHED
 * with an empty manifest and no folder (they were never rendered — a skeleton
 * script fast-forwarded them on 2026-05-31; the real space videos are safe in
 * Reelforge, a separate product). This tool makes the drift VISIBLE and, only
 * on explicit opt-in, stops the DB from lying — WITHOUT ever destroying data.
 *
 * ─── HARD RULES (do not weaken) ─────────────────────────────────────────────
 *  1. Report-only by default (--mode=report). --mode=apply also requires
 *     --report=<file> pointing at a JSON report from THIS run.
 *  2. NEVER delete a content_jobs row because a file is missing.
 *  3. NEVER delete a file because a DB row is missing. (File deletion for the
 *     5 named phantom dirs is a SEPARATE, explicitly-authorised op — decision
 *     D5 — and is not done here.)
 *  4. Nothing is written without a pg_dump backup first (path + size printed).
 *  5. No estimates. A path we cannot stat is reported "unknown", not "missing".
 *
 * What --mode=apply does (and only this):
 *   - B: rewrites each stale manifest entry in place with presence:"missing" +
 *        last_checked, PRESERVING key/type/size_bytes so the location Konrad
 *        asked for is still shown. It never drops entries.
 *   - writes content_jobs.artefacts_verified_at + artefacts_missing_count
 *        (migration 0048) so /dashboard and /system-health can show truth.
 *   - It does NOT change any job's status. Transitioning the 13 fake
 *        SPACE_VIDEO rows out of PUBLISHED is an OPEN QUESTION for Konrad
 *        (plan §11 Q1) and is deliberately NOT automated here.
 *
 * Usage (on the VPS, REAL Content Forge DB — docker pg :5432 per
 * /opt/content-forge/.env, NOT the AI-OS pg on :5434):
 *   pnpm --filter @repo/db exec tsx src/scripts/reconcile-artefacts.ts
 *   pnpm --filter @repo/db exec tsx src/scripts/reconcile-artefacts.ts \
 *       --mode=apply --report=/root/backups/2026-07-28-artefact-reconcile/report-<ts>.json
 */

import postgres from "postgres";
import {
  existsSync,
  statSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

// ── args ─────────────────────────────────────────────────────────────────────
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? "true");
}
const MODE = args.get("mode") === "apply" ? "apply" : "report";
const REPORT_ARG = args.get("report") ?? null;

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
const MEDIA_ROOT = (process.env["LOCAL_MEDIA_ROOT"] ?? "")
  .replace(/\\/g, "/")
  .replace(/\/+$/, "");

const OUT_DIR =
  args.get("out") ?? "/root/backups/2026-07-28-artefact-reconcile";

// Path prefixes that belong to OTHER subsystems — a directory under these is
// never a content-job orphan. (A naive first scan mis-flagged 400+ tutorial
// dirs; do not repeat that.)
const NON_CONTENT_PREFIXES = [
  "tutorial",
  "stitch-uploads",
  "video-stitch-jobs",
  "cf",
  "footage",
  "thumbnails",
  "assets",
  "fonts",
  "long-form-drama",
  "ranking-",
  "_reactor_char",
  "style-collections",
  "va-uploads",
  "bundestag",
  "narrators",
  "music",
];

const nowIso = new Date().toISOString();

function isRemote(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

/** stat → present | missing | unknown. Never guesses. */
function presenceOf(absPath: string): "present" | "missing" | "unknown" {
  try {
    return statSync(absPath).isFile() ? "present" : "missing";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is a real, definitive "missing". Anything else (permission,
    // I/O error) is genuinely unknown — never call it missing.
    return code === "ENOENT" ? "missing" : "unknown";
  }
}

function toAbs(raw: string): string | null {
  if (isRemote(raw)) return null;
  let p = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  p = p.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:\//.test(p)) return p;
  return MEDIA_ROOT ? join(MEDIA_ROOT, p).replace(/\\/g, "/") : null;
}

interface ManifestEntry {
  key: string;
  type?: string;
  size_bytes?: number;
  presence?: string;
  last_checked?: string;
}

/** Defensive read: the column is usually an array, sometimes a JSON string. */
function readManifest(raw: unknown): {
  entries: ManifestEntry[];
  shape: string;
} {
  if (raw == null) return { entries: [], shape: "null" };
  if (Array.isArray(raw))
    return { entries: raw as ManifestEntry[], shape: "array" };
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return {
          entries: parsed as ManifestEntry[],
          shape: "json-string(recovered)",
        };
    } catch {
      /* fall through */
    }
    return { entries: [], shape: "string(unparseable)" };
  }
  return { entries: [], shape: typeof raw };
}

const sql = postgres(DATABASE_URL, { max: 1 });

interface JobRow {
  id: string;
  channel_id: string | null;
  status: string;
  format: string;
  r2_asset_manifest: unknown;
  final_video_path: string | null;
}

type PresenceClass = "present" | "missing" | "unknown";

async function main() {
  console.log(
    `[reconcile] mode=${MODE}  media_root=${MEDIA_ROOT || "(unset!)"}`,
  );
  if (!MEDIA_ROOT) {
    console.warn(
      "[reconcile] LOCAL_MEDIA_ROOT is not set — every local path will be 'unknown'. " +
        "Run this on the VPS where the media lives.",
    );
  }

  const jobs = (await sql`
    SELECT id, channel_id, status, format, r2_asset_manifest, final_video_path
    FROM content_jobs
  `) as unknown as JobRow[];

  const jobIds = new Set(jobs.map((j) => j.id));

  // Populations A/B: manifest entries by presence.
  let present = 0;
  let missing = 0;
  let unknown = 0;
  const perJobMissing = new Map<string, number>();
  const perJobShape = new Map<string, string>();
  const missingSamples: Array<{ job: string; key: string }> = [];

  // Population D: jobs with neither a readable manifest entry nor a folder.
  const neverProduced: Array<{ id: string; status: string; format: string }> =
    [];

  for (const job of jobs) {
    const { entries, shape } = readManifest(job.r2_asset_manifest);
    perJobShape.set(job.id, shape);
    let jobMissing = 0;
    let jobHasAnyLocal = false;

    for (const e of entries) {
      if (!e || typeof e.key !== "string" || e.key === "skipped") continue;
      if (isRemote(e.key)) continue; // remote = not our disk; not A/B
      const abs = toAbs(e.key);
      if (!abs) continue;
      jobHasAnyLocal = true;
      const p = presenceOf(abs);
      if (p === "present") present += 1;
      else if (p === "missing") {
        missing += 1;
        jobMissing += 1;
        if (missingSamples.length < 25)
          missingSamples.push({ job: job.id, key: e.key });
      } else unknown += 1;
    }
    perJobMissing.set(job.id, jobMissing);

    // folder probe (content-job layouts only; tutorial layout excluded — D7)
    const folder = resolveJobDir(job.channel_id, job.id);
    if (!jobHasAnyLocal && !folder) {
      neverProduced.push({
        id: job.id,
        status: job.status,
        format: job.format,
      });
    }
  }

  // Population C: orphan dirs on disk with no content_jobs row.
  const orphanDirs = MEDIA_ROOT ? scanOrphanDirs(jobIds) : [];

  const report = {
    generated_at: nowIso,
    mode: MODE,
    media_root: MEDIA_ROOT || null,
    jobs_total: jobs.length,
    populations: {
      A_manifest_present: present,
      B_manifest_missing: missing,
      manifest_unknown: unknown,
      C_orphan_dirs: orphanDirs.length,
      D_never_produced: neverProduced.length,
    },
    manifest_shapes: countBy([...perJobShape.values()]),
    missing_samples: missingSamples,
    never_produced: neverProduced,
    orphan_dirs: orphanDirs,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = nowIso.replace(/[:.]/g, "-");
  const jsonPath = join(OUT_DIR, `report-${stamp}.json`);
  const mdPath = join(OUT_DIR, `report-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`[reconcile] report written:\n  ${jsonPath}\n  ${mdPath}`);
  console.table(report.populations);

  if (MODE === "report") {
    console.log(
      "[reconcile] report-only. To apply the (non-destructive) manifest/verified-at " +
        "writes, re-run with --mode=apply --report=" +
        jsonPath,
    );
    await sql.end();
    return;
  }

  // ── apply ──────────────────────────────────────────────────────────────────
  if (!REPORT_ARG || !existsSync(REPORT_ARG)) {
    console.error(
      "[reconcile] --mode=apply requires --report=<file> pointing at a report " +
        "JSON from a report-only run on the same data. Aborting (no changes made).",
    );
    process.exit(2);
  }
  console.error(
    "\n[reconcile] APPLY is a WRITE. Before running this you MUST have a backup:\n" +
      `  mkdir -p ${OUT_DIR}\n` +
      `  docker exec content-forge-postgres pg_dump -U postgres -Fc -t content_jobs -t space_video_clips content_forge \\\n` +
      `    > ${OUT_DIR}/content_jobs+space_video_clips.dump\n` +
      "This script does not perform the pg_dump for you — confirm it exists, then set --confirm-backup=yes.\n",
  );
  if (args.get("confirm-backup") !== "yes") {
    console.error(
      "[reconcile] --confirm-backup=yes not supplied. Aborting (no changes made).",
    );
    process.exit(3);
  }

  let updatedJobs = 0;
  for (const job of jobs) {
    const { entries, shape } = readManifest(job.r2_asset_manifest);
    if (shape !== "array" && shape !== "json-string(recovered)") continue;
    let changed = false;
    const rewritten = entries.map((e) => {
      if (!e || typeof e.key !== "string" || e.key === "skipped") return e;
      if (isRemote(e.key)) return e;
      const abs = toAbs(e.key);
      if (!abs) return e;
      const p = presenceOf(abs);
      const desired: PresenceClass = p;
      if (e.presence !== desired || !e.last_checked) {
        changed = true;
        return { ...e, presence: desired, last_checked: nowIso };
      }
      return e;
    });
    const missingCount = rewritten.filter(
      (e) => e?.presence === "missing",
    ).length;

    // Always stamp verified_at + missing_count; rewrite manifest only if changed.
    if (changed) {
      await sql`
        UPDATE content_jobs
        SET r2_asset_manifest = ${sql.json(rewritten as never)},
            artefacts_verified_at = ${nowIso},
            artefacts_missing_count = ${missingCount}
        WHERE id = ${job.id}
      `;
    } else {
      await sql`
        UPDATE content_jobs
        SET artefacts_verified_at = ${nowIso},
            artefacts_missing_count = ${missingCount}
        WHERE id = ${job.id}
      `;
    }
    updatedJobs += 1;
  }
  console.log(
    `[reconcile] apply complete. Stamped ${updatedJobs} jobs with verified_at/missing_count. ` +
      "No row deleted, no file touched, no status changed.",
  );
  await sql.end();
}

/** Content-job dir layouts only. Tutorial layout is intentionally excluded (D7). */
function resolveJobDir(channelId: string | null, jobId: string): string | null {
  if (!MEDIA_ROOT) return null;
  const candidates: string[] = [];
  if (channelId) candidates.push(join(MEDIA_ROOT, channelId, jobId));
  candidates.push(join(MEDIA_ROOT, jobId));
  candidates.push(join(MEDIA_ROOT, "long-form-drama", jobId));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrphanDir {
  path: string;
  jobId: string;
  hasFinalVideo: boolean;
  sizeHint: number | null;
}

/**
 * Directories whose name is a job id but which have no content_jobs row. Scans
 * the media root and each channel dir one level deep. Excludes the non-content
 * subsystem prefixes. Reports only; never deletes.
 */
function scanOrphanDirs(jobIds: Set<string>): OrphanDir[] {
  const out: OrphanDir[] = [];
  const roots = [MEDIA_ROOT];
  // also look one level into channel dirs (uuid-named)
  try {
    for (const e of readdirSync(MEDIA_ROOT, { withFileTypes: true })) {
      if (e.isDirectory() && UUID_RE.test(e.name)) {
        roots.push(join(MEDIA_ROOT, e.name));
      }
    }
  } catch {
    /* ignore */
  }

  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (NON_CONTENT_PREFIXES.some((p) => name.startsWith(p))) continue;
      if (!UUID_RE.test(name)) continue;
      if (jobIds.has(name)) continue; // has a row → not an orphan
      const full = join(root, name).replace(/\\/g, "/");
      const finalVid = ["final_video.mp4", "final.mp4", "output.mp4"]
        .map((n) => join(full, n))
        .find((p) => existsSync(p));
      let sizeHint: number | null = null;
      if (finalVid) {
        try {
          sizeHint = statSync(finalVid).size;
        } catch {
          sizeHint = null;
        }
      }
      out.push({
        path: full,
        jobId: name,
        hasFinalVideo: !!finalVid,
        sizeHint,
      });
    }
  }
  return out;
}

function countBy(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

function renderMarkdown(r: ReturnType<typeof buildReportShape>): string {
  const p = r.populations;
  return [
    `# Artefact reconciliation report`,
    ``,
    `- Generated: ${r.generated_at}`,
    `- Mode: ${r.mode}`,
    `- Media root: ${r.media_root ?? "(unset)"}`,
    `- Jobs total: ${r.jobs_total}`,
    ``,
    `## Populations`,
    ``,
    `| Population | Count |`,
    `| --- | --- |`,
    `| A — manifest entries whose file exists | ${p.A_manifest_present} |`,
    `| B — manifest entries whose file is missing | ${p.B_manifest_missing} |`,
    `| manifest entries: unknown (could not stat) | ${p.manifest_unknown} |`,
    `| C — orphan dirs on disk with no content_jobs row | ${p.C_orphan_dirs} |`,
    `| D — jobs with neither manifest nor folder (never produced) | ${p.D_never_produced} |`,
    ``,
    `## Manifest shapes`,
    ``,
    ...Object.entries(r.manifest_shapes).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Never produced (population D)`,
    ``,
    ...(r.never_produced.length === 0
      ? ["(none)"]
      : r.never_produced.map(
          (j) => `- \`${j.id}\` — ${j.format} / ${j.status}`,
        )),
    ``,
    `## Orphan dirs (population C) — report only, NOT deleted here`,
    ``,
    ...(r.orphan_dirs.length === 0
      ? ["(none)"]
      : r.orphan_dirs.map(
          (d) =>
            `- \`${d.path}\`${d.hasFinalVideo ? ` — final_video ${d.sizeHint ?? "?"} bytes` : " — no final video"}`,
        )),
    ``,
  ].join("\n");
}

// helper type inference bridge for renderMarkdown
function buildReportShape() {
  return {
    generated_at: "",
    mode: "",
    media_root: null as string | null,
    jobs_total: 0,
    populations: {
      A_manifest_present: 0,
      B_manifest_missing: 0,
      manifest_unknown: 0,
      C_orphan_dirs: 0,
      D_never_produced: 0,
    },
    manifest_shapes: {} as Record<string, number>,
    missing_samples: [] as Array<{ job: string; key: string }>,
    never_produced: [] as Array<{ id: string; status: string; format: string }>,
    orphan_dirs: [] as OrphanDir[],
  };
}

main().catch((err) => {
  console.error("[reconcile] fatal:", err);
  process.exit(1);
});
