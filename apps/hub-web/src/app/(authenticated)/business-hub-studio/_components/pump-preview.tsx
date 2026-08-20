"use client";

/**
 * Live preview: the head mark sitting on the head hitbox, pumped by a REAL
 * narration RMS envelope, with a scrubber.
 *
 * The envelope comes from `GET /api/business-hub/studio/envelope`, which calls
 * `computeRmsEnvelope` from `@repo/media-core` — the same function the presenter
 * compositor uses. The scale mapping and its 33-step quantisation are mirrored
 * from `buildHeadScaleSteps` / `quantiseEnvelopeToSteps`, so what the operator
 * sees here is what the renderer will emit, including the quantisation stair.
 *
 * There is no synthesised audio and no fake envelope anywhere in this component.
 * With no sample clip on disk it says so and offers an upload; it never animates
 * against a made-up curve, because the whole reason this preview exists is to
 * judge whether real narration drives the head convincingly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pose } from "@repo/contracts";

import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import {
  envelopeIndexAt,
  fitContain,
  headScaleForEnvelopeValue,
  normToDisplay,
  HEAD_SCALE_RANGE,
  HEAD_SCALE_STEPS,
  type HitboxDraft,
} from "../_lib/geometry";
import { HeadMark } from "../_lib/head-mark";
import { FORMAT, UI } from "../_lib/palette";
import {
  fetchEnvelope,
  fetchNarrationList,
  narrationAudioUrl,
  poseImageUrl,
  uploadNarration,
  type EnvelopeResponse,
  type NarrationFile,
} from "../_lib/api";

interface Props {
  pose: Pose;
  draft: HitboxDraft;
  /** Ground the preview paints on — both are shipped grounds (design §3.1). */
  ground: "dark" | "light";
}

/** The format's render frame rate (brief §3.5 `settings.fps`). */
const FPS = 30;

/** Preview panel height. */
const STAGE_HEIGHT = 420;

export function PumpPreview({ pose, draft, ground }: Props) {
  const [files, setFiles] = useState<NarrationFile[] | null>(null);
  const [directory, setDirectory] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<EnvelopeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setStage({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loadList = useCallback(async () => {
    try {
      const list = await fetchNarrationList();
      setFiles(list.files);
      setDirectory(list.directory);
      setSelected((current) => current ?? list.files[0]?.file ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) {
      setEnvelope(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetchEnvelope(selected, FPS)
      .then((result) => {
        if (!cancelled) setEnvelope(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setEnvelope(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Poll the audio element on every animation frame while playing. `timeupdate`
  // fires ~4x a second, which would make the head lurch between four positions
  // instead of pumping.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setTimeSec(audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const head = draft.head;

  let envelopeValue: number | null = null;
  let scale = 1;
  if (envelope && envelope.frameCount > 0) {
    const index = envelopeIndexAt(timeSec, envelope.fps, envelope.frameCount);
    if (index !== null) {
      const raw = envelope.values[index];
      if (raw === undefined) {
        throw new Error(
          `[PumpPreview] envelope index ${index} is out of range for ` +
            `${envelope.values.length} values — the server's frameCount and values ` +
            "array disagree.",
        );
      }
      envelopeValue = raw;
      scale = headScaleForEnvelopeValue(
        raw,
        HEAD_SCALE_RANGE,
        HEAD_SCALE_STEPS,
      );
    }
  }

  const [poseW, poseH] = pose.size;
  const box =
    stage === null
      ? null
      : fitContain({ w: poseW, h: poseH }, { w: stage.w, h: stage.h });

  const groundColour =
    ground === "dark" ? FORMAT.groundDark : FORMAT.groundLight;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 260, flex: 1 }}>
          <V2Listbox
            label="Sample narration"
            value={selected ?? ""}
            onChange={(value) => {
              setSelected(value);
              setTimeSec(0);
            }}
            placeholder={
              files === null
                ? "Loading…"
                : files.length === 0
                  ? "No narration clips on disk"
                  : "Select a clip…"
            }
            options={(files ?? []).map((f) => ({
              value: f.file,
              label: f.file,
              hint: `${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
            }))}
          />
        </div>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 12px",
            borderRadius: 8,
            border: `1px solid ${UI.accentBorder}`,
            background: UI.accentSoft,
            color: UI.accent,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            upload
          </span>
          Upload clip
          <input
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                const list = await uploadNarration(file);
                setFiles(list.files);
                setDirectory(list.directory);
                setSelected(file.name.replace(/[^A-Za-z0-9._-]/g, "-"));
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>

      {files !== null && files.length === 0 && (
        <Notice tone="info">
          No narration clips found in <code>{directory}</code>. Drop an mp3/wav
          there, or upload one above. The head pump is only ever driven by real
          narration — there is no synthetic waveform to fall back on.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {!head && (
        <Notice tone="warn">
          This pose has no <code>head</code> hitbox yet, so there is nowhere to
          put the mark. Place it on the Calibrate tab first.
        </Notice>
      )}

      <div
        ref={stageRef}
        style={{
          position: "relative",
          height: STAGE_HEIGHT,
          borderRadius: 12,
          overflow: "hidden",
          background: groundColour,
          border: `1px solid ${UI.hairline}`,
        }}
      >
        {/* Faint grid — the format's persistent mat (design §3.1). */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${gridLine(ground)} 1px, transparent 1px), linear-gradient(90deg, ${gridLine(ground)} 1px, transparent 1px)`,
            backgroundSize: "36px 36px",
            pointerEvents: "none",
          }}
        />

        {box && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poseImageUrl(pose.file)}
              alt={pose.slug}
              draggable={false}
              style={{
                position: "absolute",
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                userSelect: "none",
              }}
            />
            {head &&
              (() => {
                const centre = normToDisplay(head.center, box);
                const diameter = 2 * head.radius * box.w * scale;
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: centre.x - diameter / 2,
                      top: centre.y - diameter / 2,
                      width: diameter,
                      height: diameter,
                      // No transition: the envelope already carries the shape of
                      // the motion, and a CSS ease would lag it.
                      pointerEvents: "none",
                    }}
                  >
                    <HeadMark
                      sizePx={diameter}
                      markBg={FORMAT.navy}
                      markFg={
                        ground === "dark" ? "#ffffff" : FORMAT.groundLight
                      }
                    />
                  </div>
                );
              })()}
          </>
        )}

        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 8,
            fontSize: 10,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            color: ground === "dark" ? "#ffffff99" : "#00000099",
          }}
        >
          {envelopeValue === null
            ? "no envelope"
            : `env ${envelopeValue.toFixed(3)} · head ×${scale.toFixed(4)}`}
        </div>
      </div>

      {envelope && (
        <EnvelopeStrip
          envelope={envelope}
          timeSec={timeSec}
          onSeek={(sec) => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = sec;
            setTimeSec(sec);
          }}
        />
      )}

      {selected && (
        <audio
          ref={audioRef}
          src={narrationAudioUrl(selected)}
          controls
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onSeeked={(e) => setTimeSec(e.currentTarget.currentTime)}
          style={{ width: "100%" }}
        />
      )}

      {envelope && (
        <div style={{ fontSize: 10, color: UI.text2 }}>
          {envelope.frameCount} frames @ {envelope.fps}fps ·{" "}
          {envelope.durationSec.toFixed(2)}s · p
          {(envelope.percentile * 100).toFixed(0)} reference{" "}
          {envelope.reference.toFixed(5)} · {envelope.smoothingTaps}-tap
          smoothing · head {HEAD_SCALE_RANGE.min.toFixed(2)}–
          {HEAD_SCALE_RANGE.max.toFixed(2)} in {HEAD_SCALE_STEPS} steps
        </div>
      )}

      {busy && <div style={{ fontSize: 11, color: UI.text2 }}>Working…</div>}
    </div>
  );
}

/** Envelope as a bar strip with a playhead; click to seek. */
function EnvelopeStrip({
  envelope,
  timeSec,
  onSeek,
}: {
  envelope: EnvelopeResponse;
  timeSec: number;
  onSeek: (sec: number) => void;
}) {
  const height = 56;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One polyline point per screen column, taking the max of the frames that
  // land in it — a peak-preserving reduction, so a plosive is not dropped by
  // decimation.
  const columns = Math.max(1, Math.floor(width));
  const points: string[] = [];
  if (width > 0 && envelope.values.length > 0) {
    const perColumn = envelope.values.length / columns;
    for (let c = 0; c < columns; c++) {
      const start = Math.floor(c * perColumn);
      const end = Math.max(start + 1, Math.floor((c + 1) * perColumn));
      let peak = 0;
      for (let i = start; i < end && i < envelope.values.length; i++) {
        const v = envelope.values[i];
        if (v !== undefined && v > peak) peak = v;
      }
      points.push(`${c},${(1 - peak) * height}`);
    }
  }

  const playheadX =
    envelope.durationSec > 0
      ? (Math.min(timeSec, envelope.durationSec) / envelope.durationSec) * width
      : 0;

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const fraction = (e.clientX - rect.left) / rect.width;
        onSeek(Math.max(0, Math.min(1, fraction)) * envelope.durationSec);
      }}
      style={{
        position: "relative",
        height,
        borderRadius: 8,
        background: UI.surface,
        border: `1px solid ${UI.hairline}`,
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} style={{ display: "block" }}>
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={FORMAT.silver}
            strokeWidth={1}
          />
          <line
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={height}
            stroke="var(--v2-accent)"
            strokeWidth={1.5}
          />
        </svg>
      )}
    </div>
  );
}

function gridLine(ground: "dark" | "light"): string {
  return ground === "dark" ? "rgba(123,189,232,0.07)" : "rgba(0,29,57,0.07)";
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const colour =
    tone === "error" ? "#ffb4ab" : tone === "warn" ? UI.warning : UI.text2;
  const background =
    tone === "error"
      ? "rgba(255,180,171,0.08)"
      : tone === "warn"
        ? "rgba(249,115,22,0.08)"
        : UI.surface;
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background,
        border: `1px solid ${UI.hairline}`,
        fontSize: 11,
        color: colour,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
