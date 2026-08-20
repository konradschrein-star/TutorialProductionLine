/**
 * Clip Forge UI types. `_lib/fetch.ts` adapts the `/api/v1/clip-forge/console`
 * response into these shapes so the screens stay thin renderers.
 */

// Display strings used by the UI. Real DB platform enums (`tiktok`,
// `instagram`, `youtube_shorts`) are mapped to these at the adapter layer.
export type Platform = "TikTok" | "Instagram" | "YT Shorts";

// Persona NAMES are arbitrary strings from `cf_personas.name`.
export type Persona = string;

export interface CfSource {
  id: string;
  /** Full cf_sources.id UUID — used for /api/v1/clip-forge/sources/:id/* lookups. */
  fullId: string;
  title: string;
  persona: Persona;
  dur: number; // seconds
  status: "ingested" | "extracting" | "extracted" | "duplicate" | "failed";
  clips: number;
  date: string;
  dupOf: string | null;
  deleted: boolean;
  words: boolean;
  res: string;
  fps: number;
  codec: string;
  sizeMB: number;
  fp: string;
  kind: string;
  ext: number;
  url: string;
  downloaded: boolean;
  ingestedAt: string;
}

export interface CfClip {
  id: string;
  /** Full cf_raw_clips.id UUID — used for /api/v1/clip-forge/raw-clips/:id/* lookups. */
  fullId: string;
  score: number;
  cats: string[];
  source: string;
  persona: Persona;
  status: "pooled" | "classified" | "finishing" | "distributed" | "depooled";
  dist: number;
  dur: number;
  tStart: number;
  reason: string;
  splitScreen: boolean;
  blurBars: boolean;
}

export interface CfAccount {
  id: string;
  handle: string;
  persona: Persona;
  platform: Platform;
  seed: number;
  ppd: number;
  active: boolean;
  proxy: string;
  profile: string;
  flag: boolean;
  last: string;
  supply: number;
  viewsK: number;
  jitter: number | null;
  slots: number;
  niche: string;
  presetId: string;
}

export interface CfDist {
  id: string;
  /** Full cf_distributions.id — needed for QC verdict writes. */
  fullId: string;
  clip: string;
  account: string;
  handle: string;
  platform: Platform;
  persona: Persona;
  status:
    | "assigned"
    | "rendered"
    | "qc_pass"
    | "qc_flag"
    | "queued"
    | "live"
    | "failed"
    | "skipped";
  sched: string;
  up: string;
  url: string;
  viewsK: number;
  /**
   * cf_distributions.qc_report as stored. Nothing writes an automated report
   * today — the only producer is a human verdict from the QC screen — so this
   * is usually null. The QC screen says so rather than inventing checks.
   */
  qcReport: Record<string, unknown> | null;
}

export interface CfError {
  id: string;
  /** Full cf_job_failures.id — needed for requeue/discard writes. */
  fullId: string;
  ts: string;
  layer: string;
  cls: "transient" | "resource" | "data" | "platform" | "logic";
  corr: string;
  msg: string;
  retries: number;
  dlq: boolean;
  clip: string;
  /** BullMQ queue the job was on. */
  queue: string;
  /** The real job payload as stored. The console used to render a
   *  hand-written fake payload here while discarding this. */
  payload: Record<string, unknown>;
  /** The real stacktrace as stored, or null when the worker recorded none. */
  stacktrace: string | null;
  /** Original job id on the queue. */
  jobId: string;
}

export interface CfPreset {
  id: string;
  name: string;
  color: string;
  highlight: string;
  caps: boolean;
  outline: boolean;
  emoji: string;
  anim: string;
  pos: number;
  size: number;
  personas: Persona[];
}

export interface CfCaption {
  id: string;
  text: string;
  uses: number;
  cat: string;
}

export interface CfData {
  PERS: Persona[];
  CAT: string[];
  PLAT: Platform[];
  LAYERS: string[];
  sources: CfSource[];
  clips: CfClip[];
  accounts: CfAccount[];
  dists: CfDist[];
  errors: CfError[];
  presets: CfPreset[];
  captionPool: Record<Persona, CfCaption[]>;
  // Real-data-only extras: queue depth and stats from /api/v1/clip-forge/console
  queueDepths?: Array<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  }>;
  stats?: Record<string, number>;
  loaded?: boolean;
  loadError?: string | null;
}

export type ScreenId =
  | "dashboard"
  | "pipeline"
  | "sources"
  | "source"
  | "pool"
  | "inspector"
  | "studio"
  | "distribution"
  | "accounts"
  | "presets"
  | "qc"
  | "errors"
  | "config"
  | "analytics";
