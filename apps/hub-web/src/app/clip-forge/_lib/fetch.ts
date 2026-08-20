/**
 * Clip Forge — real-data loader.
 *
 * Calls `/api/v1/clip-forge/console`, the single aggregator that returns
 * the full state every screen needs, and adapts the DB row shape into the
 * UI's CfData shape so the screen components stay thin renderers.
 *
 * No fallbacks: if the API errors, the loader surfaces `loadError`. Empty
 * arrays in real data are NOT errors — that's just the truth before
 * anything has been ingested.
 */
import type {
  CfAccount,
  CfCaption,
  CfClip,
  CfData,
  CfDist,
  CfError,
  CfPreset,
  CfSource,
  Persona,
  Platform,
} from "./types";

const CATEGORIES = [
  "wisdom",
  "funny",
  "controversial",
  "story",
  "educational",
  "hot_take",
  "hype",
  "insight",
  "reaction",
  "rant",
  "wholesome",
  "other",
];
const PLATFORMS: Platform[] = ["TikTok", "Instagram", "YT Shorts"];
const LAYERS = [
  "Ingest",
  "Extraction",
  "Classification",
  "Finishing",
  "QC",
  "Distribution",
  "View-Sync",
];

export function emptyCfData(): CfData {
  return {
    PERS: [],
    CAT: CATEGORIES,
    PLAT: PLATFORMS,
    LAYERS,
    sources: [],
    clips: [],
    accounts: [],
    dists: [],
    errors: [],
    presets: [],
    captionPool: {},
    queueDepths: [],
    stats: {},
    loaded: false,
    loadError: null,
  };
}

const PLATFORM_DB_TO_UI: Record<string, Platform> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube_shorts: "YT Shorts",
};

function shortId(uuid: string): string {
  // Show a compact, stable handle in the UI. The full UUID is still on
  // the row and is used by all writes/links.
  return uuid.slice(0, 8);
}

function asDate(s: string | Date | null | undefined): Date {
  if (!s) return new Date(0);
  return s instanceof Date ? s : new Date(s);
}

interface ApiPersonaRow {
  id: string;
  name: string;
  rights_confirmed: boolean;
  created_at: string;
}
interface ApiSourceRow {
  id: string;
  persona_id: string;
  source_url: string;
  source_kind: string;
  title: string;
  duration_sec: number;
  status: string;
  created_at: string;
  resolution: string | null;
  codec: string | null;
  fps: number | null;
  size_bytes: number | null;
  audio_fingerprint: string | null;
  raw_video_deleted: boolean;
  word_timings: Array<{ w: string; t0: number; t1: number }> | null;
  duplicate_of: string | null;
  external_id: string;
}
interface ApiRawClipRow {
  id: string;
  persona_id: string;
  source_id: string;
  start_sec: number;
  end_sec: number;
  clip_score: number;
  score_reason: string;
  categories: string[];
  suggested_caption: string | null;
  reframe_recipe: Record<string, unknown>;
  raw_mp4_key: string | null;
  status: string;
  created_at: string;
}
interface ApiAccountRow {
  id: string;
  persona_id: string;
  platform: string;
  handle: string;
  variant_seed: number;
  posts_per_day: number;
  active: boolean;
  proxy_endpoint: string | null;
  browser_profile_id: string | null;
  niche: string | null;
  jitter_hours_override: number | null;
  daily_slots: number;
  caption_preset_id: string | null;
  flagged_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}
interface ApiDistributionRow {
  id: string;
  raw_clip_id: string;
  variant_id: string | null;
  account_id: string;
  platform: string;
  status: string;
  scheduled_for: string | null;
  uploaded_at: string | null;
  post_url: string | null;
  view_count: number;
  qc_report: Record<string, unknown> | null;
  last_error: string | null;
  error_class: string | null;
  retry_count: number;
  created_at: string;
}
interface ApiJobFailureRow {
  id: string;
  job_id: string;
  queue: string;
  error_class: string;
  correlation_id: string | null;
  payload: Record<string, unknown>;
  last_error: string | null;
  stacktrace: string | null;
  created_at: string;
}
interface ApiPresetRow {
  id: string;
  name: string;
  text_color: string;
  highlight_color: string;
  all_caps: boolean;
  outline: boolean;
  font_size: number;
  position_pct: number;
  animation: string;
  emoji_set: string;
  assigned_personas: string[];
  created_at: string;
}
interface ApiCaptionPoolRow {
  id: string;
  persona_id: string;
  text: string;
  category: string | null;
  uses: number;
  created_at: string;
}
interface ApiQueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}
interface ConsoleResponse {
  personas: ApiPersonaRow[];
  sources: ApiSourceRow[];
  raw_clips: ApiRawClipRow[];
  accounts: ApiAccountRow[];
  distributions: ApiDistributionRow[];
  job_failures: ApiJobFailureRow[];
  caption_presets: ApiPresetRow[];
  caption_pool: ApiCaptionPoolRow[];
  queue_depths: ApiQueueDepth[];
  stats: Record<string, number>;
}

export async function fetchCfData(): Promise<CfData> {
  const res = await fetch("/api/v1/clip-forge/console", { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `/api/v1/clip-forge/console: HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const raw = (await res.json()) as ConsoleResponse;

  // Maps for joining: persona_id -> name, account_id -> account
  const personaName = new Map<string, string>();
  raw.personas.forEach((p) => personaName.set(p.id, p.name));

  const accountById = new Map<string, ApiAccountRow>();
  raw.accounts.forEach((a) => accountById.set(a.id, a));

  const clipById = new Map<string, ApiRawClipRow>();
  raw.raw_clips.forEach((c) => clipById.set(c.id, c));

  // ── PERS ───────────────────────────────────────────────────────────────
  const PERS: Persona[] = raw.personas.map((p) => p.name);

  // ── sources ────────────────────────────────────────────────────────────
  const sources: CfSource[] = raw.sources.map((s) => {
    const persona = personaName.get(s.persona_id) ?? "Unknown";
    const status = mapSourceStatus(s.status);
    return {
      id: shortId(s.id),
      fullId: s.id,
      title: s.title,
      persona,
      dur: Math.round(s.duration_sec),
      status,
      clips: raw.raw_clips.filter((c) => c.source_id === s.id).length,
      date: s.created_at.slice(0, 10),
      dupOf: s.duplicate_of ? shortId(s.duplicate_of) : null,
      deleted: s.raw_video_deleted,
      words: (s.word_timings ?? []).length > 0,
      res: s.resolution ?? "—",
      fps: s.fps ?? 0,
      codec: s.codec ?? "—",
      sizeMB: s.size_bytes ? Math.round(s.size_bytes / 1024 / 1024) : 0,
      fp: s.audio_fingerprint ?? "—",
      kind: s.source_kind,
      ext: 0,
      url: s.source_url.replace(/^https?:\/\//, ""),
      downloaded: s.status !== "ingested",
      ingestedAt: s.created_at.slice(11, 16),
    };
  });

  // ── clips ──────────────────────────────────────────────────────────────
  const clips: CfClip[] = raw.raw_clips.map((c) => {
    const persona = personaName.get(c.persona_id) ?? "Unknown";
    const sourceShort = shortId(c.source_id);
    // Distribution count for this clip
    const dist = raw.distributions.filter((d) => d.raw_clip_id === c.id).length;
    return {
      id: shortId(c.id),
      fullId: c.id,
      score: c.clip_score,
      cats: c.categories ?? [],
      source: sourceShort,
      persona,
      status: mapClipStatus(c.status),
      dist,
      dur: Math.round(c.end_sec - c.start_sec),
      tStart: c.start_sec,
      reason: c.score_reason || c.suggested_caption || "",
      splitScreen: (c.reframe_recipe?.["splitScreen"] as boolean) ?? false,
      blurBars: (c.reframe_recipe?.["blurBars"] as boolean) ?? false,
    };
  });

  // ── accounts ──────────────────────────────────────────────────────────
  const accounts: CfAccount[] = raw.accounts.map((a) => {
    const persona = personaName.get(a.persona_id) ?? "Unknown";
    const platform = PLATFORM_DB_TO_UI[a.platform] ?? "TikTok";
    return {
      id: shortId(a.id),
      handle: a.handle,
      persona,
      platform,
      seed: a.variant_seed,
      ppd: a.posts_per_day,
      active: a.active,
      proxy: a.proxy_endpoint ?? "",
      profile: a.browser_profile_id ?? "",
      flag: !!a.flagged_at,
      last: a.last_activity_at ? minutesAgo(a.last_activity_at) + "m" : "—",
      supply: clips.filter(
        (c) => c.persona === persona && c.dist === 0 && c.status !== "depooled",
      ).length,
      viewsK: 0, // will sum from dists below
      jitter: a.jitter_hours_override,
      slots: a.daily_slots,
      niche: a.niche ?? "other",
      presetId: a.caption_preset_id ?? "",
    };
  });

  // ── distributions ────────────────────────────────────────────────────
  const dists: CfDist[] = raw.distributions.map((d) => {
    const acc = accountById.get(d.account_id);
    const persona = acc ? acc.persona_id : "";
    const personaName2 = personaName.get(persona) ?? "Unknown";
    const platform = PLATFORM_DB_TO_UI[d.platform] ?? "TikTok";
    return {
      id: shortId(d.id),
      fullId: d.id,
      clip: shortId(d.raw_clip_id),
      account: shortId(d.account_id),
      handle: acc?.handle ?? "—",
      platform,
      persona: personaName2,
      status: mapDistStatus(d.status),
      sched: d.scheduled_for ? hoursRel(d.scheduled_for) : "—",
      up: d.uploaded_at ? d.uploaded_at.slice(5, 16) : "",
      url: d.post_url ?? "",
      viewsK: d.view_count > 0 ? +(d.view_count / 1000).toFixed(1) : 0,
      qcReport: d.qc_report ?? null,
    };
  });

  // Sum viewsK into accounts
  for (const a of accounts) {
    a.viewsK = dists
      .filter((d) => d.handle === a.handle)
      .reduce((s, d) => s + (d.viewsK ?? 0), 0);
  }

  // ── errors ────────────────────────────────────────────────────────────
  // cf_job_failures only ever receives jobs that exhausted their retries, so
  // `dlq: true` is accurate. `retries` is genuinely not stored on the row —
  // it is surfaced as -1 and the UI renders "—" rather than a confident 0.
  const errors: CfError[] = raw.job_failures.map((e) => ({
    id: shortId(e.id),
    fullId: e.id,
    ts: e.created_at.slice(11, 19),
    layer: queueToLayer(e.queue),
    cls: (e.error_class as CfError["cls"]) ?? "transient",
    corr: e.correlation_id ?? "",
    msg: e.last_error ?? "(no message)",
    retries: -1,
    dlq: true,
    clip:
      ((e.payload?.["raw_clip_id"] as string) ?? "").slice(0, 8) ||
      ((e.payload?.["source_id"] as string) ?? "").slice(0, 8) ||
      "",
    queue: e.queue,
    payload: e.payload ?? {},
    stacktrace: e.stacktrace,
    jobId: e.job_id,
  }));

  // ── presets ───────────────────────────────────────────────────────────
  const presets: CfPreset[] = raw.caption_presets.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.text_color,
    highlight: p.highlight_color,
    caps: p.all_caps,
    outline: p.outline,
    emoji: p.emoji_set,
    anim: p.animation,
    pos: p.position_pct,
    size: p.font_size,
    personas: (p.assigned_personas ?? [])
      .map((id) => personaName.get(id))
      .filter((n): n is string => !!n),
  }));

  // ── captionPool ────────────────────────────────────────────────────────
  const captionPool: Record<Persona, CfCaption[]> = {};
  for (const cap of raw.caption_pool) {
    const persona = personaName.get(cap.persona_id) ?? "Unknown";
    captionPool[persona] = captionPool[persona] ?? [];
    captionPool[persona].push({
      id: cap.id,
      text: cap.text,
      uses: cap.uses,
      cat: cap.category ?? "other",
    });
  }

  return {
    PERS,
    CAT: CATEGORIES,
    PLAT: PLATFORMS,
    LAYERS,
    sources,
    clips,
    accounts,
    dists,
    errors,
    presets,
    captionPool,
    queueDepths: raw.queue_depths,
    stats: raw.stats,
    loaded: true,
    loadError: null,
  };
}

function mapSourceStatus(s: string): CfSource["status"] {
  switch (s) {
    case "ingested":
      return "ingested";
    case "transcribed":
      return "extracting"; // UI vocabulary for "downloaded, not yet mined"
    case "extracted":
      return "extracted";
    case "duplicate":
      return "duplicate";
    case "failed":
      return "failed";
    default:
      return "ingested";
  }
}
function mapClipStatus(s: string): CfClip["status"] {
  switch (s) {
    case "detected":
      return "classified";
    case "rendering":
      return "finishing";
    case "ready":
      return "pooled";
    case "rejected":
      return "depooled";
    case "cancelled":
      return "depooled";
    default:
      return "pooled";
  }
}
function mapDistStatus(s: string): CfDist["status"] {
  if (
    [
      "assigned",
      "rendered",
      "qc_pass",
      "qc_flag",
      "queued",
      "live",
      "failed",
      "skipped",
    ].includes(s)
  ) {
    return s as CfDist["status"];
  }
  return "assigned";
}
function queueToLayer(q: string): string {
  if (q.includes("ingest") || q.includes("transcribe")) return "Ingest";
  if (q.includes("clip-detection")) return "Extraction";
  if (q.includes("raw-render")) return "Finishing";
  if (q.includes("qc")) return "QC";
  if (q.includes("upload")) return "Distribution";
  return "Distribution";
}
function minutesAgo(iso: string): number {
  return Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
}
function hoursRel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const hours = Math.round(diff / 3600000);
  return `${hours >= 0 ? "+" : ""}${hours}h`;
}
