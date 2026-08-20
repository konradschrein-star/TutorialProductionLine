"use client";

import { useEffect, useMemo, useState } from "react";
import type { CfData, ScreenId } from "../_lib/types";
import {
  Card,
  PersonaChip,
  SectionLabel,
  StatusPill,
} from "../_components/atoms";

interface DbClipRow {
  id: string;
  source_id: string;
  start_sec: number;
  end_sec: number;
  clip_score: number;
  status: string;
  score_reason: string;
  categories: string[];
  raw_mp4_key: string | null;
  /** Filesystem check — a key can outlive the file it points at. */
  raw_mp4_present?: boolean;
  raw_mp4_size_bytes?: number | null;
  variant_count: number;
  /** Variants that actually have an MP4 on disk right now. */
  playable_variant_count?: number;
  last_rendered_at: string | null;
  created_at: string;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  role?: string;
}
interface Hitbox {
  face_box: Box | null;
  face_conf: number;
  person_box: Box | null;
  person_conf: number;
}
interface PortraitCrops {
  main_hitbox: Hitbox | null;
  facecam_hitbox: Hitbox | null;
  // Crop boxes consumed by cf-render-variant.mjs. Keep the type aligned
  // with the DB shape even though this surface doesn't draw them.
  main_headshot?: Box | null;
  main_portrait?: Box | null;
  facecam_headshot?: Box | null;
  facecam_portrait?: Box | null;
  fullscreen_headshot?: Box | null;
  fullscreen_portrait?: Box | null;
  fullscreen_hitbox?: Hitbox | null;
}
interface FacecamLayout {
  boxes: Box[];
  frame_w: number;
  frame_h: number;
}
interface SourceProgress {
  phase: "downloading" | "transcribing" | "detecting_clips" | string;
  started_at?: string;
  updated_at?: string;
  source_kind?: string;
  bytes_done?: number;
  bytes_total?: number;
  chunks_done?: number;
  chunks_total?: number;
  duration_sec?: number;
  deepseek_pass?: number;
}
interface DbSourceRow {
  id: string;
  persona_id: string;
  title: string;
  source_url: string;
  source_kind: string;
  duration_sec: number;
  resolution: string | null;
  status: string;
  created_at: string;
  word_timings: Array<{ w: string; t0: number; t1: number }> | null;
  portrait_crops: PortraitCrops | null;
  facecam_layout: FacecamLayout | null;
  progress: SourceProgress | null;
}
interface SourceDetailResponse {
  source: DbSourceRow;
  persona: { id: string; name: string } | null;
  clips: DbClipRow[];
  stats: {
    total_clips: number;
    clips_with_raw_mp4?: number;
    rendered_variants: number;
    playable_variants?: number;
    last_mined_at: string | null;
  };
}

interface RenderAllResult {
  scope: string;
  clips_total: number;
  raw_renders_queued: number;
  raw_renders_skipped_already_present: number;
  variant_renders_queued: number;
  truncated: boolean;
}

interface Props {
  sourceId: string;
  data: CfData;
  setScreen: (s: ScreenId) => void;
  onOpenClip: (clipId: string) => void;
}

function fmtHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDur(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const scoreColor = (sc: number): string =>
  sc >= 0.85
    ? "#57a578"
    : sc >= 0.7
      ? "#7b93d4"
      : sc >= 0.55
        ? "#cf9e68"
        : "#cf7468";

export function SourceDetailScreen({ sourceId, setScreen, onOpenClip }: Props) {
  const [detail, setDetail] = useState<SourceDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mining, setMining] = useState(false);
  const [mineMsg, setMineMsg] = useState("");
  const [batching, setBatching] = useState(false);
  const [sortBy, setSortBy] = useState<"time" | "score" | "variants">("time");
  const [showDetection, setShowDetection] = useState(false);

  // While a progress phase is active, poll every 2s for tight feedback;
  // otherwise the standard 5s loop is fine.
  const pollFastMs = 2_000;
  const pollSlowMs = 5_000;

  async function refresh() {
    try {
      const r = await fetch(`/api/v1/clip-forge/sources/${sourceId}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const d = (await r.json()) as SourceDetailResponse;
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    refresh();
    // Adaptive interval: poll fast while a phase is in flight, slow otherwise.
    const id = setInterval(
      refresh,
      detail?.source.progress ? pollFastMs : pollSlowMs,
    );
    return () => clearInterval(id);
  }, [sourceId, detail?.source.progress?.phase]);

  async function onMine() {
    setMining(true);
    setMineMsg("");
    try {
      const r = await fetch(`/api/v1/clip-forge/sources/${sourceId}/mine`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(await r.text());
      setMineMsg("Mining queued. Watch the clip count below.");
      refresh();
    } catch (e) {
      setMineMsg(`Failed: ${String(e)}`);
    } finally {
      setMining(false);
    }
  }

  /**
   * Batch render for the whole source. `scope: "missing"` only rebuilds what
   * has no MP4 on disk; `"all"` rebuilds everything. This is the difference
   * between producing clips and clicking ↻ sixty-one times.
   */
  async function onRenderAll(scope: "missing" | "all") {
    if (
      scope === "all" &&
      !window.confirm(
        `Re-render EVERY clip of this source from scratch? That queues ${detail?.stats.total_clips ?? "?"} raw renders.`,
      )
    ) {
      return;
    }
    setBatching(true);
    setMineMsg("");
    try {
      const r = await fetch(
        `/api/v1/clip-forge/sources/${sourceId}/render-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as RenderAllResult;
      setMineMsg(
        j.raw_renders_queued === 0 && j.variant_renders_queued === 0
          ? "Nothing to render — every clip already has its MP4 on disk."
          : `Queued ${j.raw_renders_queued} raw render(s) + ${j.variant_renders_queued} variant render(s).` +
              (j.truncated ? " Batch capped — run again for the rest." : ""),
      );
      refresh();
    } catch (e) {
      setMineMsg(`Failed: ${String(e)}`);
    } finally {
      setBatching(false);
    }
  }

  const sortedClips = useMemo(() => {
    if (!detail) return [];
    const arr = [...detail.clips];
    if (sortBy === "score") arr.sort((a, b) => b.clip_score - a.clip_score);
    else if (sortBy === "variants")
      arr.sort((a, b) => b.variant_count - a.variant_count);
    return arr;
  }, [detail, sortBy]);

  if (error) {
    return (
      <div style={{ padding: 20, color: "#cf7468" }}>
        Source load failed: {error}
      </div>
    );
  }
  if (!detail) {
    return <div style={{ padding: 20, color: "#7d8893" }}>Loading source…</div>;
  }

  const { source, persona, stats } = detail;
  const isMining = source.status === "transcribed";
  const personaName = persona?.name ?? "Unknown";
  // Clips whose raw MP4 is gone (or was never produced). `raw_mp4_present`
  // is a real filesystem check; older API responses omit it, in which case
  // we fall back to "does it have a key at all".
  const missingCount = detail.clips.filter((c) =>
    c.raw_mp4_present === undefined ? !c.raw_mp4_key : !c.raw_mp4_present,
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
        }}
      >
        <button onClick={() => setScreen("sources")} style={btn("ghost")}>
          ‹ all sources
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#eef1f4" }}>
          {source.title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <PersonaChip name={personaName} size={18} />
          <span style={{ fontSize: 11, color: "#9aa1a9" }}>{personaName}</span>
        </span>
        <StatusPill status={source.status as never} />
        <span style={{ flex: 1 }} />
        {/* Batch render. `render missing` is the everyday repair action —
            it rebuilds only clips whose MP4 is gone. */}
        <button
          onClick={() => onRenderAll("missing")}
          disabled={batching}
          title="Queue a render for every clip of this source that has no MP4 on disk"
          style={btn(missingCount > 0 ? "primary" : "ghost", batching)}
        >
          {batching
            ? "queuing…"
            : missingCount > 0
              ? `▶ render ${missingCount} missing`
              : "▶ render missing"}
        </button>
        <button
          onClick={() => onRenderAll("all")}
          disabled={batching}
          title="Re-render every clip of this source from scratch"
          style={btn("ghost", batching)}
        >
          ↻ all
        </button>
        <button
          onClick={onMine}
          disabled={mining}
          style={btn("primary", mining)}
        >
          {mining ? "queuing…" : isMining ? "⛏ mining…" : "⛏ re-mine clips"}
        </button>
        <a
          href={source.source_url}
          target="_blank"
          rel="noreferrer"
          style={{ ...btn("ghost"), textDecoration: "none" }}
        >
          ↗ original
        </a>
      </div>

      {source.progress && <ProgressBanner progress={source.progress} />}

      <div
        style={{
          padding: "12px 16px",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 10,
          borderBottom: "1px solid #1d232a",
        }}
      >
        <StatChip label="DURATION" value={fmtHMS(source.duration_sec)} />
        <StatChip label="CLIPS MINED" value={String(stats.total_clips)} />
        {/* Playable vs total. A gap means artifacts were deleted and the
            source needs a batch re-render — the header button says how many. */}
        <StatChip
          label="PLAYABLE VARIANTS"
          value={
            stats.playable_variants === undefined
              ? String(stats.rendered_variants)
              : `${stats.playable_variants}/${stats.rendered_variants}`
          }
          color={
            stats.playable_variants !== undefined &&
            stats.playable_variants < stats.rendered_variants
              ? "#cf7468"
              : "#cfd4da"
          }
        />
        <StatChip
          label="LAST MINED"
          value={timeAgo(stats.last_mined_at)}
          color={isMining ? "#cf9e68" : "#cfd4da"}
        />
        <StatChip label="RESOLUTION" value={source.resolution ?? "—"} />
      </div>

      {mineMsg && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 11,
            color: mineMsg.startsWith("Failed") ? "#cf7468" : "#9bb1e0",
            background: mineMsg.startsWith("Failed")
              ? "rgba(207,116,104,.08)"
              : "rgba(155,177,224,.06)",
            borderBottom: "1px solid #1d232a",
          }}
        >
          {mineMsg}
        </div>
      )}

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid #1d232a",
        }}
      >
        <SectionLabel>
          CLIPS MINED FROM THIS SOURCE · {sortedClips.length}
        </SectionLabel>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setShowDetection(!showDetection)}
          style={{
            border: "1px solid",
            borderColor: showDetection ? "#3f4954" : "#1d232a",
            background: showDetection ? "#1a212a" : "transparent",
            color: showDetection ? "#eef1f4" : "#7d8893",
            borderRadius: 4,
            padding: "3px 8px",
            cursor: "pointer",
            fontSize: 10.5,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
          title="Overlay face + person + facecam markers from AI detection on every card"
        >
          detection {showDetection ? "ON" : "OFF"}
        </button>
        <span style={{ fontSize: 10.5, color: "#7d8893" }}>sort:</span>
        {(["time", "score", "variants"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            style={{
              border: "1px solid",
              borderColor: sortBy === k ? "#3f4954" : "#1d232a",
              background: sortBy === k ? "#1a212a" : "transparent",
              color: sortBy === k ? "#eef1f4" : "#7d8893",
              borderRadius: 4,
              padding: "3px 8px",
              cursor: "pointer",
              fontSize: 10.5,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "12px 16px 20px",
        }}
      >
        {sortedClips.length === 0 ? (
          <div
            style={{
              padding: "60px 0",
              textAlign: "center",
              color: "#7d8893",
              fontSize: 13,
            }}
          >
            {isMining
              ? "Mining in progress — clips will appear here as they land."
              : "No clips mined yet. Click re-mine to extract clips from this source."}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
              gap: 10,
            }}
          >
            {sortedClips.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                source={detail.source}
                showDetection={showDetection}
                onOpen={() => onOpenClip(c.id)}
              />
            ))}
          </div>
        )}
      </div>
      <SystemChip />
    </div>
  );
}

function ClipCard({
  clip,
  source,
  showDetection,
  onOpen,
}: {
  clip: DbClipRow;
  source: DbSourceRow;
  showDetection: boolean;
  onOpen: () => void;
}) {
  const dur = clip.end_sec - clip.start_sec;
  const cats = Array.isArray(clip.categories) ? clip.categories : [];
  const parsed = parseResolution(source.resolution);
  // `??` doesn't catch numeric 0 — see inspector.tsx for full reasoning.
  const frameW = pickPositive(source.facecam_layout?.frame_w, parsed.w, 1920);
  const frameH = pickPositive(source.facecam_layout?.frame_h, parsed.h, 1080);
  return (
    <Card pad={0} style={{ overflow: "hidden", cursor: "pointer" }}>
      <div onClick={onOpen} title="Click to open clip inspector">
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${frameW}/${frameH}`,
            background: "#0a0d11",
          }}
        >
          {clip.raw_mp4_key && clip.raw_mp4_present !== false ? (
            <video
              src={`/api/media/${clip.raw_mp4_key.replace(/\\/g, "/")}`}
              preload="metadata"
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                background: "#0a0d11",
              }}
              onMouseEnter={(e) => {
                void (e.currentTarget as HTMLVideoElement)
                  .play()
                  .catch(() => {});
              }}
              onMouseLeave={(e) => {
                const v = e.currentTarget as HTMLVideoElement;
                v.pause();
                v.currentTime = 0;
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                backgroundImage:
                  "repeating-linear-gradient(135deg,#171c23 0 6px,#12161c 6px 12px)",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 8,
                color: clip.raw_mp4_key ? "#dd8d83" : "#7d8893",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
              }}
            >
              {/* A key with no file means the artifact was deleted. Saying
                  "not extracted" for that case sent the operator hunting for
                  a pipeline failure that never happened. */}
              {clip.raw_mp4_key ? "MP4 MISSING" : "not extracted"}
              {clip.raw_mp4_key && (
                <span style={{ fontSize: 9, color: "#9aa1a9" }}>
                  file deleted — use “render missing”
                </span>
              )}
            </div>
          )}
          {showDetection && source.portrait_crops && (
            <svg
              viewBox={`0 0 ${frameW} ${frameH}`}
              preserveAspectRatio="xMidYMid meet"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                width: "100%",
                height: "100%",
              }}
            >
              <CardDetectionMarkers
                portraitCrops={source.portrait_crops}
                facecamLayout={source.facecam_layout}
              />
            </svg>
          )}
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: "#aeb4bb",
              }}
            >
              {fmtHMS(clip.start_sec)} → {fmtHMS(clip.end_sec)}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: "#7d8893",
              }}
            >
              {fmtDur(dur)}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                color: scoreColor(clip.clip_score),
              }}
            >
              {clip.clip_score.toFixed(2)}
            </span>
          </div>
          {clip.score_reason && (
            <p
              style={{
                fontSize: 11.5,
                color: "#cfd4da",
                margin: 0,
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {clip.score_reason}
            </p>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              flexWrap: "wrap",
            }}
          >
            {cats.slice(0, 3).map((cat) => (
              <span
                key={cat}
                style={{
                  fontSize: 9.5,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: "#9aa1a9",
                  border: "1px solid #2b333c",
                  borderRadius: 3,
                  padding: "1px 5px",
                }}
              >
                {cat}
              </span>
            ))}
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                color: clip.variant_count > 0 ? "#7fc79b" : "#7d8893",
              }}
            >
              {clip.variant_count > 0
                ? `${clip.variant_count} variant${clip.variant_count > 1 ? "s" : ""}`
                : "no variants"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #1d232a",
        borderRadius: 6,
        padding: "8px 12px",
        background: "#10141a",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: ".08em",
          color: "#59616a",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 14,
          fontWeight: 500,
          color: color ?? "#cfd4da",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function parseResolution(res: string | null): {
  w: number | null;
  h: number | null;
} {
  if (!res) return { w: null, h: null };
  // Handles both "1920×1080" (U+00D7) and "1920x1080" (ASCII).
  const m = res.match(/(\d{2,5})\s*[×x]\s*(\d{2,5})/);
  if (!m) return { w: null, h: null };
  return { w: Number(m[1]), h: Number(m[2]) };
}

function pickPositive(...values: Array<number | null | undefined>): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

/**
 * Compact face/person/facecam overlay for a clip card. Same source-frame coords
 * as the inspector overlay, but rendered tight (no labels, thin strokes) so the
 * card stays scan-able at a glance.
 */
function CardDetectionMarkers({
  portraitCrops,
  facecamLayout,
}: {
  portraitCrops: PortraitCrops;
  facecamLayout: FacecamLayout | null;
}) {
  const facecamBox = facecamLayout?.boxes.find((b) => b.role === "facecam");
  const main = portraitCrops.main_hitbox;
  const facecam = portraitCrops.facecam_hitbox;
  const facecamOff = facecamBox
    ? { x: facecamBox.x, y: facecamBox.y }
    : { x: 0, y: 0 };
  // Key by hitbox role, not by offset — when facecamBox is missing, both
  // hitboxes share off={0,0} and offset-derived keys collide, dropping one.
  const renderHitbox = (
    h: Hitbox | null,
    off: { x: number; y: number },
    role: "main" | "facecam",
  ) => {
    if (!h) return null;
    const nodes: React.ReactNode[] = [];
    if (h.person_box) {
      nodes.push(
        <rect
          key={`${role}-person`}
          x={h.person_box.x + off.x}
          y={h.person_box.y + off.y}
          width={h.person_box.w}
          height={h.person_box.h}
          fill="none"
          stroke="#7fc79b"
          strokeWidth={5}
        />,
      );
    }
    if (h.face_box) {
      nodes.push(
        <rect
          key={`${role}-face`}
          x={h.face_box.x + off.x}
          y={h.face_box.y + off.y}
          width={h.face_box.w}
          height={h.face_box.h}
          fill="none"
          stroke="#cf7468"
          strokeWidth={5}
        />,
      );
    }
    return nodes;
  };
  return (
    <g>
      {facecamBox && (
        <rect
          x={facecamBox.x}
          y={facecamBox.y}
          width={facecamBox.w}
          height={facecamBox.h}
          fill="none"
          stroke="#cf9e68"
          strokeWidth={4}
          strokeDasharray="14 10"
          opacity={0.85}
        />
      )}
      {renderHitbox(main, { x: 0, y: 0 }, "main")}
      {renderHitbox(facecam, facecamOff, "facecam")}
    </g>
  );
}

/**
 * Phase + percent + ETA strip at the top of the source-detail page. Shown
 * while cf_sources.progress is non-null; the worker clears it on terminal
 * phases so the strip disappears once the pipeline lands the source in
 * 'transcribed' or 'extracted'.
 */
function ProgressBanner({ progress }: { progress: SourceProgress }) {
  const phaseLabel: Record<string, string> = {
    downloading: "Downloading source",
    transcribing: "Transcribing audio",
    detecting_clips: "Detecting clippable moments",
    detecting_layout: "Detecting faces + facecam layout",
  };
  const label = phaseLabel[progress.phase] ?? `Working (${progress.phase})`;

  let pct: number | null = null;
  let detail = "";
  let eta = "";

  if (progress.phase === "transcribing") {
    const done = progress.chunks_done ?? 0;
    const total = progress.chunks_total ?? 0;
    if (total > 0) pct = Math.round((done / total) * 100);
    detail = `chunk ${done} / ${total}`;
    if (progress.started_at && done > 0 && total > done) {
      const elapsedMs = Date.now() - new Date(progress.started_at).getTime();
      const perChunk = elapsedMs / done;
      const remainingMs = perChunk * (total - done);
      eta = `~${humanizeMs(remainingMs)} remaining`;
    }
  } else if (progress.phase === "downloading") {
    const done = progress.bytes_done ?? 0;
    const total = progress.bytes_total ?? 0;
    if (total > 0) pct = Math.round((done / total) * 100);
    detail =
      total > 0
        ? `${humanizeBytes(done)} / ${humanizeBytes(total)}`
        : `${humanizeBytes(done)} downloaded`;
  } else if (progress.phase === "detecting_clips") {
    detail = progress.deepseek_pass
      ? `DeepSeek pass ${progress.deepseek_pass}`
      : "asking the model";
  }

  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid #1d232a",
        background:
          "linear-gradient(90deg,rgba(127,199,155,0.06),rgba(127,199,155,0))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: "#cfd4da", fontWeight: 600 }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: "#7d8893",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {detail}
        </span>
        <span style={{ flex: 1 }} />
        {eta && (
          <span
            style={{
              fontSize: 10.5,
              color: "#7fc79b",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {eta}
          </span>
        )}
        {pct !== null && (
          <span
            style={{
              fontSize: 10.5,
              color: "#cfd4da",
              fontFamily: "'IBM Plex Mono', monospace",
              minWidth: 32,
              textAlign: "right",
            }}
          >
            {pct}%
          </span>
        )}
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "#10141a",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: pct !== null ? `${pct}%` : "100%",
            background:
              pct !== null
                ? "#7fc79b"
                : "linear-gradient(90deg,#7fc79b,#1a212a,#7fc79b)",
            backgroundSize: pct !== null ? undefined : "200% 100%",
            animation:
              pct !== null ? undefined : "cfShimmer 1.6s linear infinite",
            transition: "width 0.4s ease-out",
          }}
        />
      </div>
      <style>{`@keyframes cfShimmer { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

function humanizeMs(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Persistent footer chip showing CPU / RAM / disk / queue load. Polls
 * /api/v1/clip-forge/system every 5 s. Visible on the source-detail screen
 * so you can spot a maxed-out VPS while a job runs.
 */
function SystemChip() {
  const [snap, setSnap] = useState<{
    cpu_pct: number;
    mem_pct: number;
    disk_gb_free: number;
    cpu_cores: number;
    queues: Record<string, { waiting: number; active: number }>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    async function tick() {
      try {
        const r = await fetch(`/api/v1/clip-forge/system`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = await r.json();
        if (live) setSnap(d);
      } catch {
        // silent; chip just stays stale
      }
    }
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!snap) return null;

  const cpuColor =
    snap.cpu_pct >= 85 ? "#cf7468" : snap.cpu_pct >= 60 ? "#cf9e68" : "#7fc79b";
  const memColor =
    snap.mem_pct >= 90 ? "#cf7468" : snap.mem_pct >= 70 ? "#cf9e68" : "#7fc79b";
  const activeJobs = Object.values(snap.queues).reduce(
    (s, q) => s + q.active + q.waiting,
    0,
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 16,
        zIndex: 50,
        display: "flex",
        gap: 10,
        padding: "6px 10px",
        borderRadius: 6,
        background: "rgba(11,14,18,0.95)",
        border: "1px solid #1d232a",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10.5,
        color: "#9aa1a9",
        backdropFilter: "blur(8px)",
      }}
      title={`Queues: ${Object.entries(snap.queues)
        .map(([k, v]) => `${k} ${v.active}/${v.waiting}`)
        .join(" · ")}`}
    >
      <span>
        cpu <span style={{ color: cpuColor }}>{snap.cpu_pct}%</span>
        <span style={{ color: "#59616a" }}> ({snap.cpu_cores})</span>
      </span>
      <span style={{ color: "#2b333c" }}>·</span>
      <span>
        ram <span style={{ color: memColor }}>{snap.mem_pct}%</span>
      </span>
      <span style={{ color: "#2b333c" }}>·</span>
      <span>
        disk{" "}
        <span style={{ color: "#cfd4da" }}>
          {snap.disk_gb_free >= 0 ? `${snap.disk_gb_free} GB free` : "—"}
        </span>
      </span>
      <span style={{ color: "#2b333c" }}>·</span>
      <span>
        jobs{" "}
        <span style={{ color: activeJobs > 0 ? "#cf9e68" : "#cfd4da" }}>
          {activeJobs}
        </span>
      </span>
    </div>
  );
}

function btn(kind: "ghost" | "primary", disabled = false): React.CSSProperties {
  if (kind === "primary") {
    return {
      border: "1px solid #3f4954",
      background: disabled ? "#10141a" : "#1a212a",
      color: disabled ? "#7d8893" : "#eef1f4",
      borderRadius: 5,
      padding: "5px 12px",
      cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      fontWeight: 500,
    };
  }
  return {
    border: "1px solid #2b333c",
    background: "transparent",
    color: "#aeb4bb",
    borderRadius: 5,
    padding: "5px 11px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
  };
}
