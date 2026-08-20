"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  claimHITLJob,
  getNextVAReviewJob,
  releaseHITLJob,
} from "@/app/actions/jobs";
import { useHotkeyHelp } from "@/components/hitl/hotkey-help";
import {
  fitSelectionToBlock,
  selectionTotalMs,
  SELECTION_TOLERANCE_MS,
} from "@/lib/broll-selection-fit";

// ── Contract types (mirror GET /api/jobs/[id]/va-review) ─────────────────────

interface Candidate {
  index: number;
  url: string;
  source: string;
  kind: "video" | "photo";
  durationMs?: number;
  thumbnailUrl?: string | null;
  /** Filmstrip sprite (one image, N frames tiled left→right) + frame count. */
  spriteUrl?: string;
  spriteFrames?: number;
  /** Real source title (YouTube title for yt-dlp). Primary row label. */
  title?: string;
  /** false → the source title did NOT name this product (wrong-product warn). */
  productMatched?: boolean;
  /** Index of the earlier row holding the IDENTICAL clip (same URL or same file
   *  bytes). Switching a segment between the two changes nothing — the studio
   *  says so instead of letting the VA hunt for a difference that isn't there. */
  duplicateOfIndex?: number;
}

interface HeroCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Segment {
  candidateIndex: number;
  startMs: number;
  endMs: number;
}

interface Block {
  itemId: string;
  itemName: string;
  tierName: string;
  blockDurationMs: number;
  /** Narration ms where this block's B-roll starts (fixed composition timing). */
  narrationStartMs: number;
  /** false → narration anchoring failed for the job (fixed 4s fallback). */
  anchored?: boolean;
  /** Effective hero image used in the auto tier-board + reveal shots. */
  heroImageUrl?: string | null;
  /** Raw (file://) VA hero override, round-tripped so crop saves preserve it. */
  heroOverrideRawUrl?: string;
  /** VA crop rect (image-fraction coords) applied to the hero. */
  heroCrop?: HeroCrop;
  /** Solid background/fill color behind the hero (hex). */
  heroBackground?: string;
  narrationText: string;
  candidates: Candidate[];
  selection: { segments: Segment[] };
  /** true → the stored selection didn't sum to the block window and the server
   *  rescaled it before sending. Surfaced, never silent. */
  selectionRefitted?: boolean;
  /** ms the sources still fall short of the block after the refit (0 = fine). */
  selectionShortfallMs?: number;
  approved: boolean;
  skipped: boolean;
}

interface WordTs {
  word: string;
  start: number; // seconds
  end: number; // seconds
}

interface Payload {
  job: { id: string; topic: string; status: string };
  narration: { audioUrl: string; wordTimestamps?: WordTs[] };
  blocks: Block[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEXT = "#e5e2e1";
const SUBTLE = "#cdc3d7";
const DIM = "rgba(205,195,215,0.4)";

function segDur(s: Segment): number {
  return Math.max(0, s.endMs - s.startMs);
}

function candDurationMs(cand: Candidate | undefined, fallback: number): number {
  if (cand?.durationMs && cand.durationMs > 0) return cand.durationMs;
  return fallback;
}

function fmt(ms: number): string {
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

/**
 * Background CSS that shows a single sprite tile (frame `i` of `frames`)
 * scaled to fill its box. The sprite is one image of `frames` tiles laid out
 * left→right; percentage background-position maps tile i to the viewport.
 */
function spriteTileBackground(
  spriteUrl: string,
  frames: number,
  i: number,
): React.CSSProperties {
  const idx = Math.max(0, Math.min(frames - 1, Math.round(i)));
  const posX = frames > 1 ? (idx / (frames - 1)) * 100 : 0;
  return {
    backgroundImage: `url(${spriteUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${frames * 100}% 100%`,
    backgroundPosition: `${posX}% 0`,
  };
}

/** Which sprite tile covers source time `timeMs` of a `candDurMs`-long clip. */
function tileForTime(
  timeMs: number,
  candDurMs: number,
  frames: number,
): number {
  if (candDurMs <= 0 || frames <= 0) return 0;
  return Math.max(
    0,
    Math.min(frames - 1, Math.floor((timeMs / candDurMs) * frames)),
  );
}

/**
 * Word starts (ms, block-local) that fall inside this block's narration window.
 * These are the ONLY legal cut points: a cut must land where a word begins.
 */
function blockWordCutsMs(
  words: WordTs[] | undefined,
  narrationStartMs: number,
  blockDurationMs: number,
): number[] {
  if (!words || words.length === 0) return [];
  const startS = narrationStartMs / 1000;
  const endS = (narrationStartMs + blockDurationMs) / 1000;
  const cuts: number[] = [];
  for (const w of words) {
    if (w.start >= startS && w.start < endS) {
      cuts.push(Math.round(w.start * 1000 - narrationStartMs));
    }
  }
  return cuts;
}

/** Snap a block-local cut time to the nearest legal word-start; null if none. */
function snapCutToWord(cutMs: number, cuts: number[]): number | null {
  if (cuts.length === 0) return null;
  let best = cuts[0];
  let bestD = Math.abs(cutMs - best);
  for (const c of cuts) {
    const d = Math.abs(cutMs - c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Block-local start (ms) of segment `idx` — Σ of prior segment durations
 *  (playback is 1:1, so a segment's block-time span == its source duration). */
function segCumStartMs(segments: Segment[], idx: number): number {
  let cum = 0;
  for (let i = 0; i < idx && i < segments.length; i++)
    cum += segDur(segments[i]!);
  return cum;
}

/** Interior boundary positions (block-local ms) between consecutive segments. */
function blockBoundariesMs(segments: Segment[]): number[] {
  const b: number[] = [];
  let cum = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    cum += segDur(segments[i]!);
    b.push(cum);
  }
  return b;
}

/**
 * Ensure a block's selection is renderable: at least one segment, and Σ segment
 * durations == the block window.
 *
 * Σ is a hard render invariant — `BRollShot` lays the segments out to fill
 * `blockFrames` and lets the LAST one absorb the remainder, so a Σ that doesn't
 * match means the VA is trimming one thing and the render plays another. The
 * server now refits before sending; this is the client-side backstop (and the
 * "Fit to block" button's implementation), sharing ONE fit function with it.
 */
function normalizeBlock(b: Block): Block {
  const fit = fitSelectionToBlock(
    b.selection?.segments ?? [],
    b.blockDurationMs,
    (b.candidates ?? []).map((c) => c.durationMs),
  );
  if (!fit.changed) return b;
  return { ...b, selection: { segments: fit.segments } };
}

/** Σ of the block's selected segments vs. the window it must fill. */
function selectionDeltaMs(b: Block): number {
  return selectionTotalMs(b.selection?.segments ?? []) - b.blockDurationMs;
}

// ── Main component ────────────────────────────────────────────────────────────

export function BRollStudioClient({ jobId }: { jobId: string }) {
  const router = useRouter();

  const [payload, setPayload] = useState<Payload | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeSegIndex, setActiveSegIndex] = useState(0);
  // Per-candidate VIEW window (ms) for the source rows — trim handles zoom a
  // long source down to the relevant stretch. View-only (doesn't change the
  // selection/render); keyed by candidateIndex, reset when the block changes.
  const [viewTrims, setViewTrims] = useState<
    Record<number, { startMs: number; endMs: number }>
  >({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 0..1 upload progress for the current clip upload (null = not uploading).
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  // VA productivity tally for TODAY (per station, localStorage-backed): videos
  // submitted, blocks approved, and total B-roll minutes worked.
  const [vaStats, setVaStats] = useState<{
    videos: number;
    blocks: number;
    brollMs: number;
  }>({ videos: 0, blocks: 0, brollMs: 0 });
  // "Placing" mode for Split: a red line follows the cursor on the block
  // timeline; the next click drops a word-snapped cut. Toggled by Split / X.
  const [splitPlacing, setSplitPlacing] = useState(false);
  // While placing a split, the (word-snapped) block-local ms the cursor is over
  // — drives the "Split here" frame preview. null when not hovering.
  const [splitHoverBlockMs, setSplitHoverBlockMs] = useState<number | null>(
    null,
  );
  // Item index whose hero crop/arrange editor is open (null = closed).
  const [heroEditIndex, setHeroEditIndex] = useState<number | null>(null);
  // Paste-a-URL box value + in-flight flag + inline error (422 etc.).
  const [urlValue, setUrlValue] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  // Dedicated flag for "Fetch more" so it never borrows the approve/skip
  // spinner (which would mislabel unrelated buttons as "Fetching…").
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // True only while the VA is playing the selection — the (lazily-loaded)
  // preview video is mounted over the sprite frame just for that stretch.
  const [playing, setPlaying] = useState(false);
  // Candidate open in the double-click scrub-preview player (null = closed).
  const [previewCand, setPreviewCand] = useState<Candidate | null>(null);
  const [notification, setNotification] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  // Shared HITL help overlay (bound to `?` on every gate). A and S act on the
  // BLOCK here — the block is this gate's item — so they override the shared
  // job-level descriptions.
  const help = useHotkeyHelp("B-Roll Studio shortcuts", [
    { keys: "J / K", description: "Next / previous block" },
    { keys: "A", description: "Approve this block" },
    { keys: "S", description: "Skip this block" },
    { keys: "1–9", description: "Swap the active source row" },
    { keys: "X", description: "Split (place a cut)" },
    { keys: "U", description: "Upload a clip" },
    { keys: "Esc", description: "Cancel split" },
  ]);

  const previewRef = useRef<HTMLVideoElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const activeBlockRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);

  const block = blocks[currentIndex];
  const segments = block?.selection.segments ?? [];
  const activeSeg = segments[activeSegIndex] ?? segments[0];
  const activeCand = block?.candidates[activeSeg?.candidateIndex ?? 0];
  const activeCandDur = candDurationMs(
    activeCand,
    block?.blockDurationMs ?? 1000,
  );

  // ── Load payload ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/jobs/${jobId}/va-review`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Payload;
        if (cancelled) return;
        setPayload(data);
        setBlocks((data.blocks ?? []).map(normalizeBlock));
        // Start on the first pending block, if any.
        const firstPending = (data.blocks ?? []).findIndex(
          (b) => !b.approved && !b.skipped,
        );
        setCurrentIndex(firstPending >= 0 ? firstPending : 0);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Reset the active segment + source-row trims whenever the block changes.
  useEffect(() => {
    setActiveSegIndex(0);
    setViewTrims({});
  }, [currentIndex]);

  // Claim this job (soft lease) so the next-item handout routes other VAs
  // around it — this gate takes 15–45 minutes, so two people landing on the
  // same job is 45 minutes of duplicated work, not 45 seconds.
  useEffect(() => {
    let cancelled = false;
    claimHITLJob("va-review", jobId).then((claim) => {
      if (!cancelled && !claim.mine) {
        setNotification({
          text: "Another VA is already working this job — check with them before you start.",
          type: "error",
        });
      }
    });
    return () => {
      cancelled = true;
      // Best effort release when the VA leaves the studio; otherwise the claim
      // just expires on its own.
      void releaseHITLJob(jobId);
    };
  }, [jobId]);

  // The visible source range for a candidate's row (defaults to the whole clip).
  const viewOf = useCallback(
    (candIdx: number, candDur: number) => {
      const t = viewTrims[candIdx];
      if (!t) return { start: 0, len: candDur };
      const start = Math.max(0, Math.min(t.startMs, candDur - 500));
      const end = Math.max(start + 500, Math.min(t.endMs, candDur));
      return { start, len: Math.max(1, end - start) };
    },
    [viewTrims],
  );

  const setTrim = useCallback(
    (candIdx: number, startMs: number, endMs: number) => {
      setViewTrims((prev) => ({ ...prev, [candIdx]: { startMs, endMs } }));
    },
    [],
  );

  // Keep the active block visible in the (horizontally scrollable) top strip so
  // it stays navigable even with many scenes.
  useEffect(() => {
    activeBlockRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentIndex]);

  // ── VA productivity counter (today, per station) ────────────────────────────
  const vaDayKey = useMemo(() => {
    const d = new Date();
    return `va-activity:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(vaDayKey);
      if (raw) setVaStats(JSON.parse(raw));
      else setVaStats({ videos: 0, blocks: 0, brollMs: 0 });
    } catch {
      /* localStorage unavailable */
    }
  }, [vaDayKey]);
  const bumpVaStats = useCallback(
    (patch: { videos?: number; blocks?: number; brollMs?: number }) => {
      setVaStats((prev) => {
        const next = {
          videos: prev.videos + (patch.videos ?? 0),
          blocks: prev.blocks + (patch.blocks ?? 0),
          brollMs: prev.brollMs + (patch.brollMs ?? 0),
        };
        try {
          localStorage.setItem(vaDayKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [vaDayKey],
  );

  // Freeze the active preview video at the active segment start. Skipped when
  // the candidate has a sprite — the sprite tile shows the frame, so we must
  // NOT touch the video (setting currentTime would force the clip to download,
  // defeating the whole point of the sprite).
  useEffect(() => {
    const v = previewRef.current;
    if (!v || !activeSeg || activeCand?.kind !== "video") return;
    if (activeCand.spriteUrl) return;
    const seek = () => {
      try {
        v.currentTime = activeSeg.startMs / 1000;
      } catch {
        /* ignore seek-before-ready */
      }
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIndex,
    activeSegIndex,
    activeSeg?.startMs,
    activeCand?.url,
    activeCand?.spriteUrl,
  ]);

  function showNotification(text: string, type: "success" | "error") {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 2500);
  }

  // ── Block/segment mutation ─────────────────────────────────────────────────
  const patchLocalBlock = useCallback(
    (idx: number, updater: (b: Block) => Block) => {
      setBlocks((prev) => prev.map((b, i) => (i === idx ? updater(b) : b)));
    },
    [],
  );

  const updateActiveSeg = useCallback(
    (patch: Partial<Segment>) => {
      patchLocalBlock(currentIndex, (b) => {
        const segs = b.selection.segments.map((s, i) =>
          i === activeSegIndex ? { ...s, ...patch } : s,
        );
        return { ...b, selection: { segments: segs } };
      });
    },
    [currentIndex, activeSegIndex, patchLocalBlock],
  );

  // Legal cut points (block-local word starts) for the CURRENT block.
  const blockCuts = useMemo(
    () =>
      block
        ? blockWordCutsMs(
            payload?.narration.wordTimestamps,
            block.narrationStartMs,
            block.blockDurationMs,
          )
        : [],
    [block, payload],
  );

  /** Toggle split "placing" mode. While active a red line tracks the cursor on
   *  the block timeline; the next click drops a word-snapped cut. */
  const toggleSplitPlacing = useCallback(() => {
    setSplitPlacing((p) => !p);
    setSplitHoverBlockMs(null); // don't show a stale "Split here" frame
  }, []);

  /**
   * Drop a split at block-local position `cutBlock` (ms). Divides whichever
   * segment contains that position into two contiguous pieces of the SAME
   * source (Σ preserved — the block's total length never changes). The cut is
   * snapped to the nearest word start; positions too close to an existing
   * boundary are rejected. Multiple splits allowed.
   */
  const placeSplitAtBlockMs = useCallback(
    (rawCutBlock: number) => {
      if (!block) return;
      const MIN = 200; // each resulting piece must be at least this long
      const snapped = snapCutToWord(rawCutBlock, blockCuts);
      const cutBlock = snapped ?? Math.round(rawCutBlock);
      const segs = block.selection.segments;

      let cum = 0;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]!;
        const d = segDur(seg);
        if (cutBlock > cum + MIN && cutBlock < cum + d - MIN) {
          const off = cutBlock - cum; // block-local == source-local offset
          const s1: Segment = {
            candidateIndex: seg.candidateIndex,
            startMs: seg.startMs,
            endMs: seg.startMs + off,
          };
          const s2: Segment = {
            candidateIndex: seg.candidateIndex,
            startMs: seg.startMs + off,
            endMs: seg.endMs,
          };
          patchLocalBlock(currentIndex, (b) => {
            const next = [...b.selection.segments];
            next.splice(i, 1, s1, s2);
            return { ...b, selection: { segments: next } };
          });
          setActiveSegIndex(i);
          setSplitPlacing(false);
          setSplitHoverBlockMs(null);
          showNotification(
            snapped !== null ? "Split snapped to word start" : "Split placed",
            "success",
          );
          return;
        }
        cum += d;
      }
      showNotification(
        "Too close to an edge/split — pick another spot",
        "error",
      );
    },
    [block, blockCuts, currentIndex, patchLocalBlock],
  );

  /**
   * Move the shared boundary between segments `bIdx` and `bIdx+1` to block-local
   * position `blockPos` (word-snapped). The left segment grows / the right one
   * shrinks by the same amount, so Σ (the block length) is preserved; neither
   * side may fall below MIN and each must stay within its own source clip.
   */
  const moveBoundary = useCallback(
    (bIdx: number, rawBlockPos: number) => {
      if (!block) return;
      const MIN = 200;
      const segs = block.selection.segments;
      const left = segs[bIdx];
      const right = segs[bIdx + 1];
      if (!left || !right) return;

      const cumBefore = segCumStartMs(segs, bIdx);
      const leftDur = segDur(left);
      const rightDur = segDur(right);
      const curBoundary = cumBefore + leftDur;

      const snapped = snapCutToWord(rawBlockPos, blockCuts);
      const target = snapped ?? Math.round(rawBlockPos);
      let delta = target - curBoundary;

      const leftCandDur = candDurationMs(
        block.candidates[left.candidateIndex],
        block.blockDurationMs,
      );
      // left grows by delta: endMs+delta ∈ [start+MIN, candDur]; right shrinks:
      // startMs+delta ∈ [0, endMs-MIN].
      const maxDeltaPos = Math.min(
        leftCandDur - left.endMs, // left endMs can't exceed its source
        rightDur - MIN, // right keeps ≥ MIN
      );
      const maxDeltaNeg = Math.max(
        -(leftDur - MIN), // left keeps ≥ MIN
        -right.startMs, // right startMs can't go below 0
      );
      delta = Math.max(maxDeltaNeg, Math.min(delta, maxDeltaPos));
      if (delta === 0) return;

      const nLeft: Segment = { ...left, endMs: left.endMs + delta };
      const nRight: Segment = { ...right, startMs: right.startMs + delta };
      patchLocalBlock(currentIndex, (b) => {
        const next = [...b.selection.segments];
        next.splice(bIdx, 2, nLeft, nRight);
        return { ...b, selection: { segments: next } };
      });
    },
    [block, blockCuts, currentIndex, patchLocalBlock],
  );

  /**
   * Resize a segment from one of its EDGES, on the source row where the VA is
   * actually looking.
   *
   * The block timeline already exposed this as "drag the boundary between two
   * chunks", but the green window on the source row — the thing the VA thinks
   * of as "the selection" — had no resize affordance at all, only slide. So the
   * studio read as "I can't change the size of the selection".
   *
   * A segment edge and a block boundary are the same control: playback is 1:1,
   * so growing a segment by Δ source-ms moves its shared boundary by Δ
   * block-ms. Routing through `moveBoundary` keeps Σ (and therefore the render)
   * exactly on the block window, and reuses its word-snapping and clamping.
   *
   * The block's OUTER edges (left of the first segment, right of the last) are
   * deliberately inert: moving them would change Σ, which no renderable
   * selection can do. To make a piece shorter than the whole block, Split (X)
   * it first — that is what Split is for.
   */
  const resizeSegEdge = useCallback(
    (segIdx: number, side: "l" | "r", newSourceMs: number) => {
      if (!block) return;
      const segs = block.selection.segments;
      const seg = segs[segIdx];
      if (!seg) return;
      const cum = segCumStartMs(segs, segIdx);
      if (side === "r") {
        if (segIdx >= segs.length - 1) return; // outer edge — Σ is fixed
        moveBoundary(segIdx, cum + (newSourceMs - seg.startMs));
      } else {
        if (segIdx === 0) return; // outer edge — Σ is fixed
        moveBoundary(segIdx - 1, cum + (newSourceMs - seg.startMs));
      }
    },
    [block, moveBoundary],
  );

  /**
   * Remove a segment, merging its block-time span into a neighbour so Σ (the
   * block length) is preserved and the remaining segments still fit exactly
   * within the track. The neighbour absorbs the freed duration; if extending
   * its source end would run past the clip, its start is shifted back instead
   * (never distorting the block length).
   */
  const removeSegment = useCallback(
    (segIdx: number) => {
      if (!block || block.selection.segments.length <= 1) return;
      patchLocalBlock(currentIndex, (b) => {
        const segs = [...b.selection.segments];
        const removed = segs[segIdx]!;
        const donateTo = segIdx === 0 ? 1 : segIdx - 1;
        const target = segs[donateTo]!;
        const extra = segDur(removed);
        const candDur = candDurationMs(
          b.candidates[target.candidateIndex],
          b.blockDurationMs,
        );
        // Grow toward the end first; if it overflows the source, shift start back.
        let start = target.startMs;
        let end = target.endMs + extra;
        if (end > candDur) {
          const overflow = end - candDur;
          end = candDur;
          start = Math.max(0, start - overflow);
        }
        segs[donateTo] = { ...target, startMs: start, endMs: end };
        segs.splice(segIdx, 1);
        return { ...b, selection: { segments: segs } };
      });
      setActiveSegIndex((i) => Math.max(0, Math.min(i, segments.length - 2)));
    },
    [block, currentIndex, patchLocalBlock, segments.length],
  );

  /**
   * Rescale this block's segments so Σ == the block window again.
   *
   * The escape hatch for the failure the studio shipped with: an anchored job's
   * selection is seeded at the fixed 4s constant while its real window is
   * 44–58s, and NO studio control changes Σ (split divides, boundary drag
   * trades, remove donates, source drag slides), so approve was unreachable
   * with nothing on screen able to fix it. Uses the same fit as the server.
   */
  const refitSelection = useCallback(() => {
    if (!block) return;
    const fit = fitSelectionToBlock(
      block.selection.segments,
      block.blockDurationMs,
      block.candidates.map((c) => c.durationMs),
    );
    patchLocalBlock(currentIndex, (b) => ({
      ...b,
      selection: { segments: fit.segments },
    }));
    showNotification(
      fit.shortfallMs > 0
        ? `Sources are ${fmt(fit.shortfallMs)} short of the block — add a longer clip`
        : "Selection resized to the block length",
      fit.shortfallMs > 0 ? "error" : "success",
    );
  }, [block, currentIndex, patchLocalBlock]);

  /** Point the active (sub-)window at a different candidate. */
  const setActiveCandidate = useCallback(
    (candIdx: number) => {
      if (!block || !activeSeg) return;
      const dur = segDur(activeSeg);
      const newCandDur = candDurationMs(
        block.candidates[candIdx],
        block.blockDurationMs,
      );
      const start = Math.max(0, Math.min(activeSeg.startMs, newCandDur - dur));
      updateActiveSeg({
        candidateIndex: candIdx,
        startMs: start,
        endMs: start + dur,
      });
    },
    [block, activeSeg, updateActiveSeg],
  );

  /** Mutate a specific segment by index. */
  const updateSeg = useCallback(
    (segIdx: number, patch: Partial<Segment>) => {
      patchLocalBlock(currentIndex, (b) => {
        const segs = b.selection.segments.map((s, i) =>
          i === segIdx ? { ...s, ...patch } : s,
        );
        return { ...b, selection: { segments: segs } };
      });
    },
    [currentIndex, patchLocalBlock],
  );

  // ── Selection-window drag (horizontal slide + vertical row reassign) ────────
  // A single pointer gesture on a segment window:
  //   - selects that segment (activates it),
  //   - horizontal motion slides startMs within whatever source ROW the cursor
  //     is over (duration constant),
  //   - vertical motion onto another source row reassigns candidateIndex to that
  //     row's candidate, clamping startMs so [start,start+dur] fits.
  const beginSegDrag = useCallback(
    (e: React.PointerEvent, segIdx: number) => {
      if (!block || !rowsRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveSegIndex(segIdx);

      const seg0 = block.selection.segments[segIdx];
      if (!seg0) return;
      const dur = segDur(seg0);

      const rowEls = Array.from(
        rowsRef.current.querySelectorAll<HTMLElement>("[data-cand]"),
      );

      // How far into the window the user grabbed (ms), so the slide feels natural.
      let grabWithin = dur / 2;
      const startRow = rowEls.find(
        (el) => Number(el.dataset.cand) === seg0.candidateIndex,
      );
      if (startRow) {
        const r = startRow.getBoundingClientRect();
        const startCandDur = candDurationMs(
          block.candidates[seg0.candidateIndex],
          block.blockDurationMs,
        );
        const sv = viewOf(seg0.candidateIndex, startCandDur);
        const pointerMs = sv.start + ((e.clientX - r.left) / r.width) * sv.len;
        grabWithin = Math.max(0, Math.min(pointerMs - seg0.startMs, dur));
      }

      const onMove = (ev: PointerEvent) => {
        if (rowEls.length === 0) return;
        // Pick the row under the cursor (or nearest by vertical distance).
        let target = rowEls[0];
        let best = Infinity;
        for (const el of rowEls) {
          const r = el.getBoundingClientRect();
          if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
            target = el;
            break;
          }
          const d = Math.abs(ev.clientY - (r.top + r.height / 2));
          if (d < best) {
            best = d;
            target = el;
          }
        }
        const r = target.getBoundingClientRect();
        const candIdx = Number(target.dataset.cand);
        const candDur = candDurationMs(
          block.candidates[candIdx],
          block.blockDurationMs,
        );
        const view = viewOf(candIdx, candDur);
        const posMs = view.start + ((ev.clientX - r.left) / r.width) * view.len;
        const maxStart = Math.max(0, candDur - dur);
        const ns = Math.round(
          Math.max(0, Math.min(posMs - grabWithin, maxStart)),
        );
        updateSeg(segIdx, {
          candidateIndex: candIdx,
          startMs: ns,
          endMs: ns + dur,
        });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [block, updateSeg, viewOf],
  );

  /** Click anywhere on a source row → jump the ACTIVE segment so its middle
   *  lands at that source time (and re-point it at that row's candidate). Fast
   *  coarse positioning without a drag. */
  const jumpActiveSegTo = useCallback(
    (candIdx: number, sourceMs: number) => {
      if (!block || !activeSeg) return;
      const dur = segDur(activeSeg);
      const candDur = candDurationMs(
        block.candidates[candIdx],
        block.blockDurationMs,
      );
      const maxStart = Math.max(0, candDur - dur);
      const start = Math.round(
        Math.max(0, Math.min(sourceMs - dur / 2, maxStart)),
      );
      updateActiveSeg({
        candidateIndex: candIdx,
        startMs: start,
        endMs: start + dur,
      });
    },
    [block, activeSeg, updateActiveSeg],
  );

  // ── Play selection (active segment) ─────────────────────────────────────────
  // Mounts/loads the preview video only for the duration of playback (it is
  // preload="none" and hidden behind the sprite frame the rest of the time).
  const playSelection = useCallback(() => {
    const v = previewRef.current;
    if (!v || !activeSeg || activeCand?.kind !== "video") return;
    const startS = activeSeg.startMs / 1000;
    const endS = activeSeg.endMs / 1000;
    const onTime = () => {
      if (v.currentTime >= endS) v.pause();
    };
    const cleanup = () => {
      setPlaying(false);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
    function onPause() {
      cleanup();
    }
    const seekToStart = () => {
      try {
        v.currentTime = startS;
      } catch {
        /* ignore */
      }
    };
    setPlaying(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    // A clip shorter than the selection end fires `ended`, not `pause` — handle
    // both so the play state / listeners never leak.
    v.addEventListener("ended", onPause);
    // Seek immediately when we already have metadata; otherwise the play() call
    // below triggers the load (clips are preload="none") and we seek the moment
    // metadata arrives — so playback always starts at the segment, not clip 0.
    if (v.readyState >= 1) seekToStart();
    else v.addEventListener("loadedmetadata", seekToStart, { once: true });
    void v.play().catch(cleanup);
  }, [activeSeg, activeCand?.kind]);

  // Space (and the transport button) toggles: play the selection, or stop it if
  // it's already playing.
  const togglePlaySelection = useCallback(() => {
    const v = previewRef.current;
    if (playing && v) {
      v.pause();
      return;
    }
    playSelection();
  }, [playing, playSelection]);

  // ── Server actions ─────────────────────────────────────────────────────────
  async function patchBlock(
    itemId: string,
    body: {
      selection?: { segments: Segment[] };
      approved?: boolean;
      skipped?: boolean;
      heroSelection?: {
        imageUrl?: string;
        crop?: HeroCrop;
        background?: string;
      } | null;
    },
  ): Promise<Block> {
    const res = await fetch(`/api/jobs/${jobId}/va-review/blocks/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    return (data.block ?? data) as Block;
  }

  const advanceToNextPending = useCallback(
    (fromIdx: number) => {
      const n = blocks.length;
      for (let step = 1; step <= n; step++) {
        const i = (fromIdx + step) % n;
        const b = blocks[i];
        if (b && !b.approved && !b.skipped) {
          setCurrentIndex(i);
          return;
        }
      }
      // Nothing pending — stay put.
    },
    [blocks],
  );

  /** Replace an item's hero image (used in the auto tier-board + reveal shots).
   *  Defaults to the current block, but takes an explicit index so the arrange
   *  modal (which can edit ANY block from the top strip) replaces the right one. */
  async function handleHeroUpload(
    files: FileList | null,
    blockIdx: number = currentIndex,
  ) {
    const f = files?.[0];
    const target = blocks[blockIdx];
    if (!f || !target || saving) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("itemId", target.itemId);
      fd.set("target", "hero");
      const up = await fetch(`/api/jobs/${jobId}/va-review/upload`, {
        method: "POST",
        body: fd,
      });
      const uj = await up.json();
      if (!up.ok) throw new Error(uj?.error ?? `HTTP ${up.status}`);
      // A fresh image clears any prior crop (it won't fit the new picture).
      const updated = await patchBlock(target.itemId, {
        heroSelection: { imageUrl: uj.heroUrl },
      });
      patchLocalBlock(blockIdx, (b) => ({
        ...b,
        heroImageUrl: updated.heroImageUrl,
        heroOverrideRawUrl: updated.heroOverrideRawUrl,
        heroCrop: updated.heroCrop,
        heroBackground: updated.heroBackground,
      }));
      showNotification("Hero image replaced", "success");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Hero upload failed",
        "error",
      );
    } finally {
      setSaving(false);
      if (heroInputRef.current) heroInputRef.current.value = "";
    }
  }

  /** Drop the VA hero override — the render falls back to the auto-fetched hero. */
  async function handleHeroReset() {
    if (!block || saving) return;
    setSaving(true);
    try {
      const updated = await patchBlock(block.itemId, { heroSelection: null });
      patchLocalBlock(currentIndex, (b) => ({
        ...b,
        heroImageUrl: updated.heroImageUrl,
        heroOverrideRawUrl: updated.heroOverrideRawUrl,
        heroCrop: updated.heroCrop,
        heroBackground: updated.heroBackground,
      }));
      showNotification("Hero reset to auto", "success");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Hero reset failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  /** Persist the VA's crop + background arrangement for a given block's hero.
   *  Preserves any prior image override so a crop-only save doesn't drop it. */
  async function handleHeroSaveCrop(
    blockIdx: number,
    crop: HeroCrop,
    background: string,
  ) {
    const b = blocks[blockIdx];
    if (!b || saving) return;
    setSaving(true);
    try {
      const updated = await patchBlock(b.itemId, {
        heroSelection: {
          ...(b.heroOverrideRawUrl ? { imageUrl: b.heroOverrideRawUrl } : {}),
          crop,
          background,
        },
      });
      patchLocalBlock(blockIdx, (prev) => ({
        ...prev,
        heroImageUrl: updated.heroImageUrl,
        heroOverrideRawUrl: updated.heroOverrideRawUrl,
        heroCrop: updated.heroCrop,
        heroBackground: updated.heroBackground,
      }));
      showNotification("Hero framing saved", "success");
      setHeroEditIndex(null);
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Hero save failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  /** Add a pasted YouTube URL as a new source for the current block. Downloads
   *  + quality-gates it server-side (yt-dlp), then appends the candidate. */
  async function handleAddUrl() {
    const url = urlValue.trim();
    if (!url || !block || addingUrl) return;
    setAddingUrl(true);
    setUrlError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/va-review/blocks/${block.itemId}/add-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const { candidate } = data as { candidate: Candidate };
      patchLocalBlock(currentIndex, (b) => ({
        ...b,
        candidates: [...b.candidates, candidate],
      }));
      setUrlValue("");
      showNotification("Source added from URL", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Add-URL failed";
      setUrlError(msg);
      showNotification(msg, "error");
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleApprove() {
    if (!block || saving) return;
    setSaving(true);
    try {
      const updated = await patchBlock(block.itemId, {
        selection: block.selection,
        approved: true,
      });
      const merged = normalizeBlock({ ...updated, approved: true });
      patchLocalBlock(currentIndex, () => merged);
      // Only count the FIRST approval of a block toward the daily tally.
      if (!block.approved) {
        bumpVaStats({ blocks: 1, brollMs: block.blockDurationMs });
      }
      showNotification(`Approved “${block.itemName}”`, "success");
      advanceToNextPending(currentIndex);
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Approve failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (!block || saving) return;
    setSaving(true);
    try {
      const updated = await patchBlock(block.itemId, { skipped: true });
      const merged = normalizeBlock({ ...updated, skipped: true });
      patchLocalBlock(currentIndex, () => merged);
      showNotification(`Skipped “${block.itemName}”`, "success");
      advanceToNextPending(currentIndex);
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Skip failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  /** Upload one file via XHR so we can surface real byte-level progress (fetch
   *  has no upload-progress event). Resolves with the appended candidate. */
  function uploadOneFileWithProgress(
    file: File,
    itemId: string,
  ): Promise<Candidate> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("itemId", itemId);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/jobs/${jobId}/va-review/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        // Fully uploaded — server is now transcoding/spriting; show 100%.
        setUploadProgress(1);
        let body: { candidate?: Candidate; error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error body */
        }
        if (xhr.status >= 200 && xhr.status < 300 && body.candidate) {
          resolve(body.candidate);
        } else {
          reject(new Error(body.error ?? `HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(fd);
    });
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || !block) return;
    const itemId = block.itemId;
    setUploading(true);
    setUploadProgress(0);
    try {
      for (const file of Array.from(files)) {
        setUploadProgress(0);
        const candidate = await uploadOneFileWithProgress(file, itemId);
        patchLocalBlock(currentIndex, (b) => ({
          ...b,
          candidates: [...b.candidates, candidate],
        }));
      }
      showNotification("Clip uploaded", "success");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Upload failed",
        "error",
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleFetchMore() {
    if (!block || fetching) return;
    setFetching(true);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/va-review/blocks/${block.itemId}/fetch-more`,
        { method: "POST" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const { candidates, note } = (await res.json()) as {
        candidates: Candidate[];
        note?: string;
      };
      const before = block.candidates.length;
      patchLocalBlock(currentIndex, (b) => ({ ...b, candidates }));
      // The server route is still a stub that echoes the existing candidates.
      // Claiming "Fetched more" when nothing arrived sends the VA looking for a
      // row that does not exist — say what actually happened.
      const added = candidates.length - before;
      showNotification(
        added > 0
          ? `Fetched ${added} more candidate${added === 1 ? "" : "s"}`
          : `No new candidates — paste a URL or upload a clip instead${note ? ` (${note})` : ""}`,
        added > 0 ? "success" : "error",
      );
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Fetch failed",
        "error",
      );
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/va-review/submit`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      bumpVaStats({ videos: 1 });
      showNotification("Submitted for render", "success");
      // Straight on to the next unclaimed job in this queue — submitting used
      // to dump the VA back on the job detail page with no way onward except
      // the generic jobs list.
      const { jobId: nextId } = await getNextVAReviewJob(jobId);
      router.push(nextId ? `/jobs/${nextId}/va-review` : "/jobs/va-review");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Submit failed",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestRegen() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/va-review/request-regen`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      showNotification("Regeneration requested", "success");
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Regen failed",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      ) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          setCurrentIndex((i) => Math.max(0, i - 1));
          break;
        case "j":
          e.preventDefault();
          setCurrentIndex((i) => Math.min(blocks.length - 1, i + 1));
          break;
        case "a":
          e.preventDefault();
          void handleApprove();
          break;
        case "s":
          e.preventDefault();
          void handleSkip();
          break;
        case "x":
          e.preventDefault();
          toggleSplitPlacing();
          break;
        case "escape":
          if (splitPlacing) {
            e.preventDefault();
            setSplitPlacing(false);
          }
          break;
        case "u":
          e.preventDefault();
          fileInputRef.current?.click();
          break;
        case " ":
          e.preventDefault();
          togglePlaySelection();
          break;
        default:
          // Number keys 1..9 → move the active segment onto source row N
          if (e.key >= "1" && e.key <= "9") {
            const idx = Number(e.key) - 1;
            if (block && idx < block.candidates.length) {
              e.preventDefault();
              setActiveCandidate(idx);
            }
          }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blocks.length,
    block,
    activeSeg,
    activeSegIndex,
    currentIndex,
    saving,
    splitPlacing,
    playing,
    togglePlaySelection,
  ]);

  // ── Derived counts ───────────────────────────────────────────────────────
  const doneCount = useMemo(
    () => blocks.filter((b) => b.approved || b.skipped).length,
    [blocks],
  );
  const allDone = blocks.length > 0 && doneCount === blocks.length;

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return <CenterMessage text="Loading B-Roll Studio…" />;
  }
  if (loadError) {
    return (
      <CenterMessage text={loadError} tone="error">
        <Link href={`/jobs/${jobId}`} style={backLinkStyle}>
          ← Back to job
        </Link>
      </CenterMessage>
    );
  }
  if (!payload || !block) {
    return (
      <CenterMessage text="No B-roll blocks for this job.">
        <Link href={`/jobs/${jobId}`} style={backLinkStyle}>
          ← Back to job
        </Link>
      </CenterMessage>
    );
  }

  // Map a block-local ms to the source frame under it (segment + source time).
  const frameAtBlockMs = (
    blockMs: number,
  ): { cand: Candidate; timeMs: number } | null => {
    let cum = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      const d = segDur(s);
      if (blockMs <= cum + d || i === segments.length - 1) {
        const cand = block.candidates[s.candidateIndex];
        if (!cand) return null;
        return { cand, timeMs: Math.max(0, s.startMs + (blockMs - cum)) };
      }
      cum += d;
    }
    return null;
  };

  // Right frame pane: normally the ACTIVE segment's end frame; while placing a
  // split and hovering, the frame at the prospective cut ("Split here").
  const splitPreview =
    splitPlacing && splitHoverBlockMs != null
      ? frameAtBlockMs(splitHoverBlockMs)
      : null;
  const endFrameMs = Math.max(0, (activeSeg?.endMs ?? 0) - 40);

  // Σ of the selection vs. the block window — the ONE thing that gates Approve.
  const selectedMs = selectionTotalMs(segments);
  const selectionDelta = selectedMs - block.blockDurationMs;
  const lengthOff = Math.abs(selectionDelta) > SELECTION_TOLERANCE_MS;

  // Highlight window: when the block has multiple segments and one is active,
  // highlight ONLY that segment's slice of the narration (its block-time span
  // mapped to absolute audio ms). A single-segment block highlights the whole
  // block window (unchanged).
  const hlStartMs =
    segments.length > 1 && activeSeg
      ? block.narrationStartMs + segCumStartMs(segments, activeSegIndex)
      : block.narrationStartMs;
  const hlEndMs =
    segments.length > 1 && activeSeg
      ? hlStartMs + segDur(activeSeg)
      : block.narrationStartMs + block.blockDurationMs;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 64px)",
        overflow: "hidden",
      }}
    >
      <style>{"@keyframes brollspin{to{transform:rotate(360deg)}}"}</style>
      {notification && (
        <div style={toastStyle(notification.type)}>{notification.text}</div>
      )}

      {previewCand && (
        <ClipPreviewModal
          cand={previewCand}
          onClose={() => setPreviewCand(null)}
        />
      )}

      {heroEditIndex !== null && blocks[heroEditIndex] && (
        <HeroEditorModal
          key={blocks[heroEditIndex].itemId}
          block={blocks[heroEditIndex]}
          saving={saving}
          onClose={() => setHeroEditIndex(null)}
          onSave={(crop, background) =>
            handleHeroSaveCrop(heroEditIndex, crop, background)
          }
          onReplace={(files) => handleHeroUpload(files, heroEditIndex)}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
          }}
        >
          <Link
            href={`/jobs/${jobId}`}
            style={{ ...backLinkStyle, display: "flex" }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20 }}
            >
              arrow_back
            </span>
          </Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
              B-Roll Selection Studio
            </div>
            <div
              style={{
                fontSize: 10,
                color: DIM,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {payload.job.topic}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <VaCounter stats={vaStats} />
          {/* The worklist for this gate — reachable from inside the studio so a
              VA can get back to the queue without going via the jobs list. */}
          <Link
            href="/jobs/va-review"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.03em",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: SUBTLE,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              list_alt
            </span>
            Queue
          </Link>
          <HotkeyLegend onOpen={help.open} />
          <ProgressMeter done={doneCount} total={blocks.length} />
        </div>
      </div>

      {/* Shared HITL hotkey overlay — identical panel on every gate (`?`). */}
      {help.overlay}

      {/* ── Top timeline ──────────────────────────────────────────────── */}
      {/* Interleaves the B-roll blocks (clickable → select) with the AUTO-
          generated shot nodes (tier-board tile + reveal hero for each item).
          Clicking a hero node opens the crop/arrange editor for that shot's
          imagery. */}
      <div style={topTimelineStyle}>
        {blocks.map((b, i) => (
          <div
            key={b.itemId}
            ref={i === currentIndex ? activeBlockRef : undefined}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            {i > 0 && <AutoSpacer />}
            <HeroNode block={b} onClick={() => setHeroEditIndex(i)} />
            <TimelineBlock
              block={b}
              active={i === currentIndex}
              onClick={() => setCurrentIndex(i)}
            />
          </div>
        ))}
      </div>

      {/* ── Body: center + right rail ─────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 324px",
          gap: 14,
          flex: 1,
          minHeight: 0,
          padding: "12px 16px",
          overflow: "hidden",
        }}
      >
        {/* Center column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {/* Block heading */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h2
              style={{ fontSize: 15, fontWeight: 800, color: TEXT, margin: 0 }}
            >
              {block.itemName}
            </h2>
            <span style={pillStyle}>{block.tierName}</span>
            <span
              title={
                lengthOff
                  ? "Σ of the selected segments must equal the block window before this block can be approved."
                  : "Selection matches the block window."
              }
              style={{
                fontSize: 11,
                color: lengthOff ? "#ff6b6b" : DIM,
                fontWeight: lengthOff ? 700 : 400,
              }}
            >
              block {fmt(block.blockDurationMs)} · Σ selected {fmt(selectedMs)}
              {lengthOff
                ? ` · ${selectionDelta < 0 ? "short" : "over"} by ${fmt(Math.abs(selectionDelta))}`
                : " ✓"}
            </span>
            {lengthOff && (
              <button
                type="button"
                onClick={refitSelection}
                title="Rescale the selected segments so they add up to the block length"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.5)",
                  background: "rgba(var(--v2-accent-rgb),0.14)",
                  color: "var(--v2-accent)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 13 }}
                >
                  straighten
                </span>
                Fit to block
              </button>
            )}
          </div>

          {/* Sources genuinely can't cover the window — say so plainly instead
              of leaving the VA to guess why Approve keeps refusing. */}
          {(block.selectionShortfallMs ?? 0) > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(255,90,90,0.1)",
                border: "1px solid rgba(255,90,90,0.35)",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16, color: "#ff6b6b", flexShrink: 0 }}
              >
                error
              </span>
              <span
                style={{ fontSize: 11, color: "#ff9b9b", lineHeight: 1.45 }}
              >
                The source clips are{" "}
                <b>{fmt(block.selectionShortfallMs ?? 0)}</b> shorter than this{" "}
                {fmt(block.blockDurationMs)} block. Paste a longer YouTube URL
                or upload a clip, then <b>Split</b> (X) the block so it draws
                from more than one source.
              </span>
            </div>
          )}

          {/* Anchoring-failure banner: when the job couldn't locate items in the
              narration, blocks fall back to a fixed 4s window (too short +
              misaligned). Surface it instead of silently shipping bad timing. */}
          {block.anchored === false && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(255,140,0,0.1)",
                border: "1px solid rgba(255,140,0,0.35)",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16, color: "#ff8c00", flexShrink: 0 }}
              >
                warning
              </span>
              <span
                style={{ fontSize: 11, color: "#ffb15c", lineHeight: 1.45 }}
              >
                Narration anchoring failed for this job — B-roll blocks are on a
                fixed 4s fallback, so they’re short and won’t line up with the
                voiceover. Best to <b>Request regen</b> rather than fine-tune
                here (usually caused by product names Whisper can’t match).
              </span>
            </div>
          )}

          {/* First / last frozen frames — pulled straight from the candidate's
              sprite (one image, no video download). The start pane also carries
              a lazily-loaded video that only mounts while playing. */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <FramePane
              label={`Selection start · active seg ${activeSegIndex + 1}`}
            >
              {activeCand ? (
                activeCand.kind === "video" &&
                activeCand.spriteUrl &&
                activeCand.spriteFrames ? (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    <FrameMedia
                      cand={activeCand}
                      timeMs={activeSeg?.startMs ?? 0}
                      hidden={playing}
                    />
                    <video
                      ref={previewRef}
                      src={activeCand.url}
                      muted
                      playsInline
                      preload="none"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: playing ? "block" : "none",
                      }}
                    />
                  </div>
                ) : (
                  <FrameMedia
                    cand={activeCand}
                    timeMs={activeSeg?.startMs ?? 0}
                    videoRef={previewRef}
                  />
                )
              ) : (
                <NoMedia hint="No footage — fetch or paste a clip" />
              )}
            </FramePane>
            <FramePane
              label={
                splitPreview
                  ? "Split here"
                  : `Selection end · active seg ${activeSegIndex + 1}`
              }
            >
              {/* Keys are per SOURCE CLIP, never per timestamp: keying on the
                  ms remounted the element on every drag step, which for a
                  sprite-less candidate re-downloaded the clip each time. */}
              {splitPreview ? (
                <FrameMedia
                  key={`split:${splitPreview.cand.url}`}
                  cand={splitPreview.cand}
                  timeMs={splitPreview.timeMs}
                />
              ) : activeCand ? (
                <FrameMedia
                  key={`end:${activeCand.url}`}
                  cand={activeCand}
                  timeMs={endFrameMs}
                />
              ) : (
                <NoMedia hint="No footage yet" />
              )}
            </FramePane>
          </div>

          {/* Transport row */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <StudioButton
              icon={playing ? "stop" : "play_arrow"}
              label={playing ? "Stop" : "Play selection"}
              kbd="Space"
              onClick={togglePlaySelection}
              active={playing}
            />
            <StudioButton
              icon={splitPlacing ? "close" : "call_split"}
              label={splitPlacing ? "Cancel split" : "Split"}
              kbd="X"
              onClick={toggleSplitPlacing}
              active={splitPlacing}
            />
            {segments.length > 1 && (
              <StudioButton
                icon="delete"
                label="Remove split"
                onClick={() => removeSegment(activeSegIndex)}
              />
            )}
            <StudioButton
              icon={fetching ? "progress_activity" : "cloud_download"}
              label={fetching ? "Fetching…" : "Fetch more"}
              onClick={handleFetchMore}
              disabled={fetching}
              busy={fetching}
            />
            <AddUrlBox
              value={urlValue}
              onChange={(v) => {
                setUrlValue(v);
                if (urlError) setUrlError(null);
              }}
              onSubmit={handleAddUrl}
              busy={addingUrl}
              error={urlError}
            />
          </div>

          {/* Honest-coverage empty state: a block with no fetched footage must
              read as an explicit call-to-action, never a blank gap. */}
          {block.candidates.length === 0 && (
            <EmptyFootageBanner fetching={fetching} onFetch={handleFetchMore} />
          )}

          {/* Block timeline — block-time (0 → block length). The green bar is the
              VA's fill; segment chunks sum to exactly the block length. Drag a
              boundary to move a shared split (word-snapped); in Split mode a red
              line follows the cursor and the next click drops a word-snapped
              cut. This is the split/boundary surface; the source rows below pick
              WHICH clip + slide the source window. */}
          {/* Primary workspace: this is the core VA task (pick a source + trim
              it to the block), so it carries the strongest visual container. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "14px 14px 16px",
              borderRadius: 12,
              background: "rgba(var(--v2-accent-rgb),0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.22)",
            }}
          >
            <div>
              <SectionLabel
                text={
                  splitPlacing
                    ? "Block timeline — click to drop a split (snaps to word start · Esc cancels)"
                    : "Block timeline — drag a boundary to move a split (X to add one)"
                }
              />
              <BlockTimeline
                segments={segments}
                activeSegIndex={activeSegIndex}
                blockDurationMs={block.blockDurationMs}
                wordCutsMs={blockCuts}
                placing={splitPlacing}
                onSelectSeg={setActiveSegIndex}
                onPlaceSplit={placeSplitAtBlockMs}
                onMoveBoundary={moveBoundary}
                onHoverSplit={setSplitHoverBlockMs}
              />
            </div>

            {/* Stacked per-source timelines */}
            <div>
              <SectionLabel text="Source rows — drag the green window ⇆ to slide, ⇅ to another source (1–9) · after a Split, drag a window's end handle to resize it · row edge handles zoom · click to jump · double-click to preview" />
              <SourceRows
                rowsRef={rowsRef}
                candidates={block.candidates}
                segments={segments}
                activeSegIndex={activeSegIndex}
                blockDurationMs={block.blockDurationMs}
                viewTrims={viewTrims}
                onSegPointerDown={beginSegDrag}
                onSegEdgeDrag={resizeSegEdge}
                onPreview={setPreviewCand}
                onJump={jumpActiveSegTo}
                onTrim={setTrim}
              />
            </div>
          </div>

          {/* Auto-generated shots — preview + replace the hero imagery that the
              tier-board and reveal shots render for this item (the "red" blocks
              in the plan: not human-gated, but still checkable pre-render). */}
          <HeroPanel
            block={block}
            saving={saving}
            heroInputRef={heroInputRef}
            onUpload={handleHeroUpload}
            onReset={handleHeroReset}
            onEdit={() => setHeroEditIndex(currentIndex)}
          />
        </div>

        {/* Right rail: actions pinned on top (no page scroll needed to reach
            Approve/Skip/Submit), then this block's narration + clipbase in a
            scroll region below. Replaces the old full-width bottom bar. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
          }}
        >
          {/* Actions — block nav + skip/approve + regen/submit */}
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StudioButton
                icon="chevron_left"
                label="Prev"
                kbd="K"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              />
              <span
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 12,
                  color: SUBTLE,
                  fontWeight: 700,
                }}
              >
                {currentIndex + 1} / {blocks.length}
              </span>
              <StudioButton
                icon="chevron_right"
                label="Next"
                kbd="J"
                onClick={() =>
                  setCurrentIndex((i) => Math.min(blocks.length - 1, i + 1))
                }
              />
            </div>
            {!allDone && (
              <StudioButton
                icon="skip_next"
                label="Next unreviewed"
                onClick={() => advanceToNextPending(currentIndex)}
              />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <ActionBtn
                  label={saving ? "Skipping…" : "Skip"}
                  icon="skip_next"
                  kbd="S"
                  color={DIM}
                  border="rgba(255,255,255,0.12)"
                  bg="rgba(255,255,255,0.04)"
                  onClick={handleSkip}
                  disabled={saving}
                  fullWidth
                />
              </div>
              <div style={{ flex: 1 }}>
                <ActionBtn
                  label={saving ? "Approving…" : "Approve"}
                  icon="check_circle"
                  kbd="A"
                  color="#00dc82"
                  border="rgba(0,220,130,0.3)"
                  bg="rgba(0,220,130,0.1)"
                  onClick={handleApprove}
                  disabled={saving}
                  fullWidth
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <ActionBtn
                  label="Regen"
                  icon="refresh"
                  color="#ff8c00"
                  border="rgba(255,140,0,0.3)"
                  bg="rgba(255,140,0,0.08)"
                  onClick={handleRequestRegen}
                  disabled={submitting}
                  fullWidth
                />
              </div>
              <div style={{ flex: 1 }}>
                <ActionBtn
                  label={
                    submitting
                      ? "Submitting…"
                      : `Submit (${doneCount}/${blocks.length})`
                  }
                  icon="movie"
                  color={allDone ? "#000" : DIM}
                  border={
                    allDone ? "var(--v2-accent)" : "rgba(255,255,255,0.12)"
                  }
                  bg={allDone ? "var(--v2-accent)" : "rgba(255,255,255,0.04)"}
                  onClick={handleSubmit}
                  disabled={!allDone || submitting}
                  fullWidth
                />
              </div>
            </div>
          </div>

          {/* Scroll region — narration + clipbase (scrolls internally past a
              threshold so the whole page never scrolls). */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              paddingRight: 2,
            }}
          >
            <div style={scriptPanelStyle}>
              <SectionLabel
                text={
                  segments.length > 1
                    ? `Narration for this block — green = active segment ${activeSegIndex + 1}`
                    : "Narration for this block"
                }
              />
              <ScriptTranscript
                words={payload.narration?.wordTimestamps}
                blockStartMs={block.narrationStartMs}
                blockEndMs={block.narrationStartMs + block.blockDurationMs}
                hlStartMs={hlStartMs}
                hlEndMs={hlEndMs}
                fallback={block.narrationText?.trim() || block.itemName}
              />
              <NarrationPlayer
                audioUrl={payload.narration?.audioUrl ?? null}
                selectionStartMs={block.narrationStartMs}
                selectionEndMs={block.narrationStartMs + block.blockDurationMs}
              />
            </div>

            <ClipbaseRail
              block={block}
              uploading={uploading}
              uploadProgress={uploadProgress}
              fileInputRef={fileInputRef}
              onFiles={handleUploadFiles}
              onPickCandidate={setActiveCandidate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Stacked per-candidate source timelines. One full-width row per candidate;
 * each selection segment is drawn on the row matching its candidateIndex.
 * The active segment carries the ⇆ drag affordance; dragging it vertically to
 * another row reassigns its candidate (handled by the parent's pointer logic).
 */
function SourceRows({
  rowsRef,
  candidates,
  segments,
  activeSegIndex,
  blockDurationMs,
  viewTrims,
  onSegPointerDown,
  onSegEdgeDrag,
  onPreview,
  onJump,
  onTrim,
}: {
  rowsRef: React.RefObject<HTMLDivElement>;
  candidates: Candidate[];
  segments: Segment[];
  activeSegIndex: number;
  blockDurationMs: number;
  viewTrims: Record<number, { startMs: number; endMs: number }>;
  onSegPointerDown: (e: React.PointerEvent, segIdx: number) => void;
  /** Resize a segment from one edge (Σ-preserving — see `resizeSegEdge`). */
  onSegEdgeDrag: (segIdx: number, side: "l" | "r", newSourceMs: number) => void;
  onPreview: (cand: Candidate) => void;
  onJump: (candIdx: number, sourceMs: number) => void;
  onTrim: (candIdx: number, startMs: number, endMs: number) => void;
}) {
  // A single click jumps; a double-click previews. We defer the jump briefly so
  // the second click of a double-click can cancel it.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (candidates.length === 0) {
    return (
      <span style={{ fontSize: 12, color: DIM, fontStyle: "italic" }}>
        No source clips yet — Fetch more, paste a URL, or upload one on the
        right.
      </span>
    );
  }
  return (
    <div
      ref={rowsRef}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {candidates.map((cand) => {
        const candDur = candDurationMs(cand, blockDurationMs);
        // Trim/zoom view for this row (defaults to the whole clip). Handles let
        // the VA zoom a long (up-to-10-min) source down to the relevant stretch.
        const t = viewTrims[cand.index];
        const viewStart = t
          ? Math.max(0, Math.min(t.startMs, candDur - 500))
          : 0;
        const viewEnd = t
          ? Math.max(viewStart + 500, Math.min(t.endMs, candDur))
          : candDur;
        const viewLen = Math.max(1, viewEnd - viewStart);
        const zoomed = viewLen < candDur - 1;
        // Bidirectional trim drag: uses window listeners so the pointer can go
        // past the row edge to EXPAND the view back out.
        const beginTrim = (side: "l" | "r") => (e: React.PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const track = e.currentTarget.parentElement as HTMLElement | null;
          if (!track) return;
          const rowW = track.getBoundingClientRect().width || 1;
          const startX = e.clientX;
          const vs0 = viewStart;
          const ve0 = viewEnd;
          const MINVIEW = 1000;
          const move = (ev: PointerEvent) => {
            const deltaMs = ((ev.clientX - startX) / rowW) * viewLen;
            if (side === "l") {
              onTrim(
                cand.index,
                Math.max(0, Math.min(vs0 + deltaMs, ve0 - MINVIEW)),
                ve0,
              );
            } else {
              onTrim(
                cand.index,
                vs0,
                Math.max(vs0 + MINVIEW, Math.min(ve0 + deltaMs, candDur)),
              );
            }
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        const spriteBg: React.CSSProperties = cand.spriteUrl
          ? zoomed
            ? {
                backgroundImage: `url(${cand.spriteUrl})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${(candDur / viewLen) * 100}% 100%`,
                backgroundPosition: `${
                  (viewStart / Math.max(1, candDur - viewLen)) * 100
                }% 0`,
              }
            : {
                backgroundImage: `url(${cand.spriteUrl})`,
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
              }
          : cand.thumbnailUrl
            ? {
                background: `center / cover no-repeat url(${cand.thumbnailUrl})`,
              }
            : { background: "rgba(255,255,255,0.05)" };
        // Segments assigned to THIS source. If any needs more footage than the
        // clip holds, surface a "too short" hint (rare now with 10-min sources).
        const rowSegs = segments.filter((s) => s.candidateIndex === cand.index);
        const tooShort = rowSegs.some(
          (s) => segDur(s) > candDur + 1 || s.endMs > candDur + 1,
        );
        const handleStyle = (side: "l" | "r"): React.CSSProperties => ({
          position: "absolute",
          top: 0,
          bottom: 0,
          [side === "l" ? "left" : "right"]: 0,
          width: 14,
          cursor: "ew-resize",
          zIndex: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            side === "l"
              ? "linear-gradient(90deg, rgba(var(--v2-accent-rgb),0.55), transparent)"
              : "linear-gradient(270deg, rgba(var(--v2-accent-rgb),0.55), transparent)",
        });
        return (
          <div
            key={cand.index}
            style={{ display: "flex", flexDirection: "column", gap: 3 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: SUBTLE,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={
                    cand.title ??
                    `Source ${cand.index + 1} — ${cand.source} · ${cand.kind}`
                  }
                >
                  {cand.title
                    ? cand.title
                    : `Source ${cand.index + 1} — ${cand.source} · ${cand.kind}${
                        cand.source === "va-upload" ? " · VA" : ""
                      }`}
                </span>
                {cand.duplicateOfIndex !== undefined && (
                  <span
                    title={`Byte-for-byte the same clip as source ${cand.duplicateOfIndex + 1}. Putting a segment on this row instead of that one changes nothing on screen or in the render.`}
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 9,
                      fontWeight: 700,
                      border: "1px solid rgba(205,195,215,0.35)",
                      background: "rgba(205,195,215,0.12)",
                      color: SUBTLE,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 12 }}
                    >
                      content_copy
                    </span>
                    same as {cand.duplicateOfIndex + 1}
                  </span>
                )}
                {cand.productMatched === false && (
                  <span
                    title="Title may not match this product — check before using"
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 9,
                      fontWeight: 700,
                      border: "1px solid rgba(245,166,35,0.4)",
                      background: "rgba(245,166,35,0.12)",
                      color: "#f5a623",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 12 }}
                    >
                      warning
                    </span>
                    check product
                  </span>
                )}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {tooShort && (
                  <span
                    title="This clip is shorter than the part of the block assigned to it — fetch/upload a longer source or trim the block."
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 9,
                      fontWeight: 700,
                      border: "1px solid rgba(255,90,90,0.45)",
                      background: "rgba(255,90,90,0.12)",
                      color: "#ff6b6b",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 12 }}
                    >
                      error
                    </span>
                    clip too short
                  </span>
                )}
                {zoomed && (
                  <button
                    type="button"
                    onClick={() => onTrim(cand.index, 0, candDur)}
                    title="Reset trim — show the whole clip"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "1px 4px",
                      borderRadius: 6,
                      border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                      background: "rgba(var(--v2-accent-rgb),0.1)",
                      color: "var(--v2-accent)",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 12 }}
                    >
                      zoom_out_map
                    </span>
                  </button>
                )}
                <span style={{ fontSize: 10, color: DIM }}>
                  {zoomed
                    ? `${fmt(viewStart)}–${fmt(viewEnd)} / ${fmt(candDur)}`
                    : fmt(candDur)}
                </span>
              </span>
            </div>
            <div
              data-cand={cand.index}
              title="Click to jump the window here · double-click to preview"
              onDoubleClick={() => {
                if (clickTimer.current) {
                  clearTimeout(clickTimer.current);
                  clickTimer.current = null;
                }
                onPreview(cand);
              }}
              style={{
                position: "relative",
                height: 46,
                borderRadius: 8,
                cursor: "pointer",
                // Filmstrip: the duration-scaled sprite, rescaled to the trim
                // view so a long source zooms to the relevant stretch (CapCut).
                ...spriteBg,
                border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                overflow: "hidden",
                userSelect: "none",
              }}
            >
              <div
                title="Click to jump the selected window here"
                onClick={(e) => {
                  if (e.detail !== 1) return; // ignore the 2nd click of a dbl-click
                  const r = e.currentTarget.getBoundingClientRect();
                  const frac = Math.max(
                    0,
                    Math.min(1, (e.clientX - r.left) / r.width),
                  );
                  const candIdx = cand.index;
                  const sourceMs = viewStart + frac * viewLen;
                  // Defer so a following double-click (preview) can cancel it.
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  clickTimer.current = setTimeout(() => {
                    onJump(candIdx, sourceMs);
                    clickTimer.current = null;
                  }, 220);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.25)",
                }}
              />
              {/* Trim / zoom handles (drag inward to zoom, outward to expand). */}
              <div
                onPointerDown={beginTrim("l")}
                title="Trim / zoom from the left"
                style={handleStyle("l")}
              >
                <div
                  style={{
                    width: 3,
                    height: "62%",
                    background: "var(--v2-accent)",
                    borderRadius: 2,
                  }}
                />
              </div>
              <div
                onPointerDown={beginTrim("r")}
                title="Trim / zoom from the right"
                style={handleStyle("r")}
              >
                <div
                  style={{
                    width: 3,
                    height: "62%",
                    background: "var(--v2-accent)",
                    borderRadius: 2,
                  }}
                />
              </div>
              {segments.map((s, i) => {
                if (s.candidateIndex !== cand.index) return null;
                // Skip segments fully outside the current trim view.
                if (s.endMs <= viewStart || s.startMs >= viewEnd) return null;
                // Position by the VISIBLE span so a segment clipped on either
                // edge draws at its true width in the zoomed row.
                const visStart = Math.max(s.startMs, viewStart);
                const visEnd = Math.min(s.endMs, viewEnd);
                const leftPct = Math.max(
                  0,
                  Math.min(100, ((visStart - viewStart) / viewLen) * 100),
                );
                const widthPct = Math.max(
                  0,
                  Math.min(
                    100 - leftPct,
                    ((visEnd - visStart) / viewLen) * 100,
                  ),
                );
                const active = i === activeSegIndex;
                // Only INTERIOR edges resize: they trade duration with the
                // neighbouring segment, so Σ stays locked to the block window.
                // The block's outer edges cannot move — Split (X) first.
                const canResizeLeft = i > 0;
                const canResizeRight = i < segments.length - 1;
                const beginEdgeDrag =
                  (side: "l" | "r") => (e: React.PointerEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const track = (
                      e.currentTarget as HTMLElement
                    ).closest<HTMLElement>("[data-cand]");
                    if (!track) return;
                    const move = (ev: PointerEvent) => {
                      const r = track.getBoundingClientRect();
                      const frac = Math.max(
                        0,
                        Math.min(1, (ev.clientX - r.left) / (r.width || 1)),
                      );
                      onSegEdgeDrag(i, side, viewStart + frac * viewLen);
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  };
                const segHandleStyle = (
                  side: "l" | "r",
                ): React.CSSProperties => ({
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  [side === "l" ? "left" : "right"]: 0,
                  width: 9,
                  cursor: "ew-resize",
                  zIndex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,220,130,0.55)",
                  borderRadius: side === "l" ? "6px 0 0 6px" : "0 6px 6px 0",
                });
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => onSegPointerDown(e, i)}
                    title={
                      active
                        ? canResizeLeft || canResizeRight
                          ? "Drag ⇆ to slide · ⇅ to another source · drag an end handle to resize this piece"
                          : "Drag ⇆ to slide · ⇅ to another source · Split (X) to divide the block into resizable pieces"
                        : "Click to select this segment"
                    }
                    style={{
                      position: "absolute",
                      top: active ? 0 : 6,
                      bottom: active ? 0 : 6,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: 10,
                      boxSizing: "border-box",
                      borderRadius: 6,
                      cursor: "grab",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      background: active
                        ? "rgba(var(--v2-accent-rgb),0.28)"
                        : "rgba(0,220,130,0.14)",
                      border: active
                        ? "2px solid var(--v2-accent)"
                        : "1px solid rgba(0,220,130,0.5)",
                      boxShadow: active
                        ? "0 0 10px rgba(var(--v2-accent-rgb),0.4)"
                        : "none",
                    }}
                  >
                    {active && (
                      <>
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14, color: "var(--v2-accent)" }}
                        >
                          chevron_left
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: "var(--v2-accent)",
                          }}
                        >
                          {i + 1}
                        </span>
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14, color: "var(--v2-accent)" }}
                        >
                          chevron_right
                        </span>
                      </>
                    )}
                    {!active && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#00dc82",
                        }}
                      >
                        {i + 1}
                      </span>
                    )}
                    {/* Interior resize handles — grow this piece, shrink the
                        neighbour, Σ unchanged. */}
                    {canResizeLeft && (
                      <div
                        onPointerDown={beginEdgeDrag("l")}
                        title={`Resize — takes from / gives to segment ${i}`}
                        style={segHandleStyle("l")}
                      />
                    )}
                    {canResizeRight && (
                      <div
                        onPointerDown={beginEdgeDrag("r")}
                        title={`Resize — takes from / gives to segment ${i + 2}`}
                        style={segHandleStyle("r")}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Static advisory: reminds the VA to route their connection through a VPN
 *  before working (footage sources can rate-limit/geo-block by IP). Not a
 *  control — just a notice. */
/**
 * Double-click scrub-preview player. Efficient by construction: the <video>
 * only mounts while the modal is open (loads on demand) and scrubbing shows
 * sprite-tile thumbnails (YouTube-style) instead of hammering the video with
 * seeks — the real seek happens once, on release. Defaults to 2× playback,
 * speed adjustable. Photos just show the image.
 */
function ClipPreviewModal({
  cand,
  onClose,
}: {
  cand: Candidate;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [rate, setRate] = useState(2);
  const [progress, setProgress] = useState(0); // 0..1 (playback)
  const [scrub, setScrub] = useState<number | null>(null); // 0..1 while dragging
  const [durationMs, setDurationMs] = useState(candDurationMs(cand, 0));
  const [paused, setPaused] = useState(false);

  const SPEEDS = [1, 1.5, 2, 3, 4];
  const frames = cand.spriteFrames ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  const fractionFromX = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const beginScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    setScrub(fractionFromX(e.clientX));
    const move = (ev: PointerEvent) => setScrub(fractionFromX(ev.clientX));
    const up = (ev: PointerEvent) => {
      const f = fractionFromX(ev.clientX);
      const v = videoRef.current;
      if (v && v.duration) v.currentTime = f * v.duration;
      setScrub(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const barFrac = scrub ?? progress;
  const scrubTile =
    scrub != null && cand.spriteUrl && frames > 0
      ? Math.max(0, Math.min(frames - 1, Math.floor(scrub * frames)))
      : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 94vw)",
          background: "#0d0d12",
          borderRadius: 12,
          border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>
            Preview — Source {cand.index + 1} · {cand.source}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              color: SUBTLE,
              cursor: "pointer",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              close
            </span>
          </button>
        </div>

        <div
          style={{
            position: "relative",
            background: "#000",
            aspectRatio: "16 / 9",
          }}
        >
          {cand.kind === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cand.url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <video
              ref={videoRef}
              src={cand.url}
              autoPlay
              playsInline
              preload="auto"
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                v.playbackRate = rate;
                if (v.duration && isFinite(v.duration))
                  setDurationMs(v.duration * 1000);
              }}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProgress(v.currentTime / v.duration);
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                cursor: "pointer",
              }}
            />
          )}

          {scrubTile != null && cand.spriteUrl && (
            <div
              style={{
                position: "absolute",
                bottom: 10,
                left: `${(scrub ?? 0) * 100}%`,
                transform: "translateX(-50%)",
                width: 168,
                height: 94,
                borderRadius: 6,
                border: "2px solid #fff",
                boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                pointerEvents: "none",
                ...spriteTileBackground(cand.spriteUrl, frames, scrubTile),
              }}
            />
          )}
        </div>

        {cand.kind !== "photo" && (
          <>
            {/* Scrubber */}
            <div
              ref={barRef}
              onPointerDown={beginScrub}
              style={{
                position: "relative",
                height: 16,
                margin: "10px 14px 2px",
                background: "rgba(255,255,255,0.14)",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${barFrac * 100}%`,
                  background: "var(--v2-accent)",
                  borderRadius: 8,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${barFrac * 100}%`,
                  top: "50%",
                  transform: "translate(-50%,-50%)",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                }}
              />
            </div>

            {/* Controls */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 14px 12px",
              }}
            >
              <button
                type="button"
                onClick={togglePlay}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: TEXT,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  {paused ? "play_arrow" : "pause"}
                </span>
              </button>
              <span style={{ fontSize: 11, color: DIM, marginLeft: 4 }}>
                Speed
              </span>
              {SPEEDS.map((s) => {
                const on = rate === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRate(s)}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 7,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: on
                        ? "rgba(var(--v2-accent-rgb),0.18)"
                        : "rgba(255,255,255,0.05)",
                      border: on
                        ? "1px solid var(--v2-accent)"
                        : "1px solid rgba(255,255,255,0.12)",
                      color: on ? "var(--v2-accent)" : SUBTLE,
                    }}
                  >
                    {s}×
                  </button>
                );
              })}
              <span style={{ marginLeft: "auto", fontSize: 11, color: DIM }}>
                {fmt(barFrac * durationMs)} / {fmt(durationMs)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Block-time timeline (0 → block length). Segment chunks are laid out by their
 * block-time share so they ALWAYS sum to exactly the track width (the "green
 * selection bar" can never overflow). Interior boundaries are draggable to move
 * a shared split (word-snapped upstream); in `placing` mode a RED line tracks
 * the cursor and a click drops a word-snapped split. The block's total length
 * is constant — this divides it, it never resizes it.
 */
function BlockTimeline({
  segments,
  activeSegIndex,
  blockDurationMs,
  wordCutsMs,
  placing,
  onSelectSeg,
  onPlaceSplit,
  onMoveBoundary,
  onHoverSplit,
}: {
  segments: Segment[];
  activeSegIndex: number;
  blockDurationMs: number;
  wordCutsMs: number[];
  placing: boolean;
  onSelectSeg: (i: number) => void;
  onPlaceSplit: (blockMs: number) => void;
  onMoveBoundary: (boundaryIdx: number, blockMs: number) => void;
  /** Report the word-snapped block-ms the cursor is over while placing (null on
   *  leave) so the parent can preview the frame at the prospective cut. */
  onHoverSplit: (blockMs: number | null) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const total = Math.max(1, blockDurationMs);

  const blockMsFromX = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return frac * total;
  };

  // Word-snapped block-ms under the cursor while placing (null otherwise).
  const snappedHoverMs = (() => {
    if (hoverFrac == null) return null;
    const raw = hoverFrac * total;
    return snapCutToWord(raw, wordCutsMs) ?? raw;
  })();
  const snapPreviewFrac =
    snappedHoverMs == null ? null : snappedHoverMs / total;

  const boundaries = blockBoundariesMs(segments);

  // Cumulative starts for chunk layout.
  const chunks: Array<{ leftPct: number; widthPct: number }> = [];
  let cum = 0;
  for (const s of segments) {
    const d = segDur(s);
    chunks.push({
      leftPct: (cum / total) * 100,
      widthPct: (d / total) * 100,
    });
    cum += d;
  }

  const beginBoundaryDrag = (bIdx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) =>
      onMoveBoundary(bIdx, blockMsFromX(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={barRef}
      onMouseMove={(e) => {
        if (!placing) return;
        const r = e.currentTarget.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        setHoverFrac(frac);
        const raw = frac * total;
        onHoverSplit(snapCutToWord(raw, wordCutsMs) ?? raw);
      }}
      onMouseLeave={() => {
        setHoverFrac(null);
        onHoverSplit(null);
      }}
      onClick={(e) => {
        if (placing) onPlaceSplit(blockMsFromX(e.clientX));
      }}
      style={{
        position: "relative",
        height: 44,
        borderRadius: 8,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
        overflow: "hidden",
        cursor: placing ? "crosshair" : "default",
        userSelect: "none",
      }}
    >
      {/* Word-start ticks — the only legal cut positions. */}
      {wordCutsMs.map((c, i) => (
        <div
          key={`t${i}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(c / total) * 100}%`,
            width: 1,
            background: "rgba(255,255,255,0.12)",
          }}
        />
      ))}

      {/* Segment chunks (the green selection bar) — widths sum to 100%. */}
      {segments.map((s, i) => {
        const c = chunks[i]!;
        const active = i === activeSegIndex;
        return (
          <div
            key={i}
            onClick={(e) => {
              if (placing) return;
              e.stopPropagation();
              onSelectSeg(i);
            }}
            title={placing ? undefined : `Segment ${i + 1} — click to select`}
            style={{
              position: "absolute",
              top: 4,
              bottom: 4,
              left: `${c.leftPct}%`,
              width: `${c.widthPct}%`,
              boxSizing: "border-box",
              borderRadius: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: placing ? "crosshair" : "pointer",
              background: active
                ? "rgba(var(--v2-accent-rgb),0.28)"
                : "rgba(0,220,130,0.16)",
              border: active
                ? "2px solid var(--v2-accent)"
                : "1px solid rgba(0,220,130,0.5)",
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: active ? "var(--v2-accent)" : "#00dc82",
              }}
            >
              {i + 1}
            </span>
          </div>
        );
      })}

      {/* Draggable boundary handles (not in placing mode). */}
      {!placing &&
        boundaries.map((bMs, bIdx) => (
          <div
            key={`b${bIdx}`}
            onPointerDown={beginBoundaryDrag(bIdx)}
            title="Drag to move this split (snaps to word start)"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${(bMs / total) * 100}%`,
              width: 12,
              transform: "translateX(-50%)",
              cursor: "ew-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 3,
            }}
          >
            <div
              style={{
                width: 3,
                height: "100%",
                background: "#fff",
                boxShadow: "0 0 4px rgba(0,0,0,0.6)",
              }}
            />
          </div>
        ))}

      {/* Red placement line following the cursor (snapped preview). */}
      {placing && snapPreviewFrac != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${snapPreviewFrac * 100}%`,
            width: 2,
            transform: "translateX(-50%)",
            background: "#ff3b3b",
            boxShadow: "0 0 6px rgba(255,59,59,0.8)",
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
      )}
    </div>
  );
}

/** Compact paste-a-YouTube-URL box: adds the pasted clip as a new source for
 *  the current block (server downloads + quality-gates it). */
function AddUrlBox({
  value,
  onChange,
  onSubmit,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error?: string | null;
}) {
  const canSubmit = !busy && value.trim().length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 2px 2px 8px",
          borderRadius: 6,
          border: error
            ? "1px solid rgba(255,80,80,0.5)"
            : "1px solid rgba(255,255,255,0.12)",
          background: error ? "rgba(255,80,80,0.06)" : "rgba(255,255,255,0.04)",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 15, color: error ? "#ff5050" : DIM }}
        >
          link
        </span>
        <input
          type="url"
          value={value}
          placeholder="Paste YouTube URL…"
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          style={{
            width: 180,
            background: "transparent",
            border: "none",
            outline: "none",
            color: TEXT,
            fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          title="Download this clip and add it as a source (server checks quality)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 9px",
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 700,
            cursor: busy ? "wait" : canSubmit ? "pointer" : "not-allowed",
            border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
            background: "rgba(var(--v2-accent-rgb),0.1)",
            color: "var(--v2-accent)",
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              ...(busy ? { animation: "brollspin 0.8s linear infinite" } : {}),
            }}
          >
            {busy ? "progress_activity" : "add"}
          </span>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: "#ff8080",
            maxWidth: 260,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 12, flexShrink: 0 }}
          >
            error
          </span>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Narration preview player. Points at the job's narration audio (served with
 * HTTP Range so seeking works). Play/Pause toggles the whole track; "Play
 * selection" plays only this block's window [selectionStartMs, selectionEndMs].
 * Degrades to a clear empty state when no audio is available.
 */
function NarrationPlayer({
  audioUrl,
  selectionStartMs,
  selectionEndMs,
}: {
  audioUrl: string | null;
  selectionStartMs: number;
  selectionEndMs: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null); // seconds; pause when reached
  const [playing, setPlaying] = useState(false);
  const [curMs, setCurMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [audioError, setAudioError] = useState(false);

  if (!audioUrl) {
    return (
      <p
        style={{
          fontSize: 11,
          color: DIM,
          fontStyle: "italic",
          margin: "10px 0 0",
        }}
      >
        Narration audio unavailable for this job.
      </p>
    );
  }

  const seekTo = (ms: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, ms / 1000);
  };

  const playAll = () => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = null;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const playSelection = () => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = selectionEndMs / 1000;
    a.currentTime = selectionStartMs / 1000;
    void a.play().catch(() => {});
  };

  const seekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seekTo(frac * durMs);
  };

  const progress = durMs > 0 ? curMs / durMs : 0;

  const iconBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: TEXT,
  };

  return (
    <div style={{ marginTop: 10 }}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDurMs(d * 1000);
          setAudioError(false);
        }}
        onDurationChange={(e) => {
          // Some streamed responses only report a finite duration after the
          // first metadata refresh — pick it up here too.
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDurMs(d * 1000);
        }}
        onError={() => setAudioError(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setCurMs(a.currentTime * 1000);
          if (stopAtRef.current != null && a.currentTime >= stopAtRef.current) {
            a.pause();
            stopAtRef.current = null;
          }
        }}
      />
      {audioError && (
        <p
          style={{
            fontSize: 10,
            color: "#ff6b6b",
            margin: "0 0 6px",
            fontWeight: 700,
          }}
        >
          Couldn’t load narration audio for this job.
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={playAll} style={iconBtn}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {playing ? "pause" : "play_arrow"}
          </span>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={playSelection}
          style={{
            ...iconBtn,
            border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
            background: "rgba(var(--v2-accent-rgb),0.1)",
            color: "var(--v2-accent)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            graphic_eq
          </span>
          Play selection
        </button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: DIM }}>
          {fmt(curMs)} / {fmt(durMs)}
        </span>
      </div>
      <div
        onClick={seekBarClick}
        style={{
          position: "relative",
          height: 10,
          marginTop: 8,
          background: "rgba(255,255,255,0.12)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {/* Block-window marker so the VA sees where this block sits. */}
        {durMs > 0 && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${(selectionStartMs / durMs) * 100}%`,
              width: `${((selectionEndMs - selectionStartMs) / durMs) * 100}%`,
              background: "rgba(0,220,130,0.25)",
              borderRadius: 6,
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress * 100}%`,
            background: "var(--v2-accent)",
            borderRadius: 6,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}

/*
 * REMOVED: `VpnChip` — a hardcoded "Please use a VPN" badge in the studio
 * header. It was not a signal of anything: every fetch in this studio (yt-dlp
 * add-url, fetch-more, uploads) runs on the VPS, so the VA's own connection
 * cannot affect a single one of them. It read as a live warning about the job
 * and sent the operator chasing his own network while the real failure mode is
 * server-side YouTube auth (see `explainYtDlpFailure` in the add-url route,
 * which now names cookies / PO-token explicitly).
 */

function FrameMedia({
  cand,
  timeMs,
  videoRef,
  hidden,
}: {
  cand: Candidate;
  timeMs: number;
  videoRef?: React.RefObject<HTMLVideoElement>;
  hidden?: boolean;
}) {
  if (cand.kind === "photo") {
    return (
      <img
        src={cand.url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    );
  }
  // Efficient path: pull the frame from the sprite (one image, already loaded
  // for the filmstrip) — no per-frame video download / seek.
  if (cand.spriteUrl && cand.spriteFrames && cand.spriteFrames > 0) {
    const candDur = candDurationMs(cand, 4000);
    const i = tileForTime(timeMs, candDur, cand.spriteFrames);
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          visibility: hidden ? "hidden" : "visible",
          ...spriteTileBackground(cand.spriteUrl, cand.spriteFrames, i),
        }}
      />
    );
  }
  // Fallback (candidates with no sprite): load the clip and seek to the frame.
  return (
    <SeekingVideo
      cand={cand}
      timeMs={timeMs}
      videoRef={videoRef}
      hidden={hidden}
    />
  );
}

/**
 * A `<video>` that SEEKS to `timeMs` instead of remounting.
 *
 * Why it is its own component: the frame panes used to key their `<video>` on
 * `…:${timeMs}`, so every ms of a drag threw the element away and mounted a
 * fresh one — a new HTTP request and a fresh metadata parse of a 26 MB clip per
 * step. On the "Selection end" pane, whose timeMs changes constantly, that is
 * exactly the "the second image takes quite a while" symptom: the pane was
 * downloading the source over and over. The element is now stable per source
 * clip and an effect moves `currentTime`, which is a byte-range seek.
 *
 * Sprited candidates never reach here at all (the sprite tile is instant); this
 * only matters for candidates that were stored without a sprite.
 */
function SeekingVideo({
  cand,
  timeMs,
  videoRef,
  hidden,
}: {
  cand: Candidate;
  timeMs: number;
  videoRef?: React.RefObject<HTMLVideoElement>;
  hidden?: boolean;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? localRef;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const seek = () => {
      try {
        v.currentTime = timeMs / 1000;
      } catch {
        /* seek before metadata — the loadedmetadata handler retries */
      }
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    return () => v.removeEventListener("loadedmetadata", seek);
  }, [ref, timeMs, cand.url]);

  return (
    <video
      ref={ref}
      src={cand.url}
      muted
      playsInline
      preload="metadata"
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: hidden ? "none" : "block",
      }}
    />
  );
}

/**
 * The spoken narration for THE CURRENT BLOCK only. We slice the full Whisper
 * word list down to the block window [blockStartMs, blockEndMs) so the VA reads
 * exactly the words that play under this B-roll (not the whole video). Within
 * that slice, the ACTIVE SEGMENT's sub-window [hlStartMs, hlEndMs) is painted
 * green — so a split block highlights only the piece you're editing, and a
 * single-segment block highlights its whole text. Degrades to a plain fallback
 * string when no word timings exist or none fall in this block.
 */
function endsSentence(word: string): boolean {
  return /[.!?]["')\]]?$/.test(word.trim());
}

function ScriptTranscript({
  words,
  blockStartMs,
  blockEndMs,
  hlStartMs,
  hlEndMs,
  fallback,
}: {
  words?: WordTs[];
  blockStartMs: number;
  blockEndMs: number;
  hlStartMs: number;
  hlEndMs: number;
  fallback: string;
}) {
  const blockStartS = blockStartMs / 1000;
  const blockEndS = blockEndMs / 1000;
  const hlStartS = hlStartMs / 1000;
  const hlEndS = hlEndMs / 1000;

  const all = words ?? [];
  // Indices of the block's words (start inside the window).
  let blockFirst = -1;
  let blockLast = -1;
  for (let i = 0; i < all.length; i++) {
    const s = all[i]!.start;
    if (s >= blockStartS && s < blockEndS) {
      if (blockFirst === -1) blockFirst = i;
      blockLast = i;
    }
  }

  if (blockFirst === -1) {
    return (
      <p
        style={{
          fontSize: 13,
          color: SUBTLE,
          lineHeight: 1.6,
          margin: "6px 0 0",
        }}
      >
        {fallback}
      </p>
    );
  }

  // One sentence of context BEFORE the block: walk back to the start of the
  // sentence that precedes the block's first word.
  let ctxStart = blockFirst;
  while (ctxStart > 0 && !endsSentence(all[ctxStart - 1]!.word)) ctxStart--;
  if (ctxStart > 0) {
    ctxStart--; // include the punctuation-terminated prev word
    while (ctxStart > 0 && !endsSentence(all[ctxStart - 1]!.word)) ctxStart--;
  }
  // One sentence of context AFTER the block: extend to the next sentence end.
  let ctxEnd = blockLast;
  while (ctxEnd < all.length - 1 && !endsSentence(all[ctxEnd]!.word)) ctxEnd++;
  if (ctxEnd < all.length - 1) {
    ctxEnd++;
    while (ctxEnd < all.length - 1 && !endsSentence(all[ctxEnd]!.word))
      ctxEnd++;
  }

  const dim: React.CSSProperties = {
    color: "rgba(205,195,215,0.3)", // dark gray, barely readable context
    display: "inline-block",
    marginRight: 4,
  };
  const activeStyle: React.CSSProperties = {
    color: "#0b1220",
    background: "var(--v2-accent)",
    borderRadius: 3,
    padding: "1px 3px",
    marginRight: 4,
    fontWeight: 700,
    display: "inline-block",
  };
  const blockStyle: React.CSSProperties = {
    color: "#cdc3d7",
    background: "rgba(0,220,130,0.13)",
    borderRadius: 3,
    padding: "1px 3px",
    marginRight: 4,
    display: "inline-block",
  };

  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: 1.9,
        margin: "6px 0 0",
        // Words wrap at whole-word boundaries (each span is inline-block, so a
        // word never splits mid-letter). No inner scroll — the sidebar scrolls.
        whiteSpace: "normal",
        wordBreak: "normal",
        overflowWrap: "normal",
      }}
    >
      {all.slice(ctxStart, ctxEnd + 1).map((w, i) => {
        const idx = ctxStart + i;
        const inBlock = idx >= blockFirst && idx <= blockLast;
        if (!inBlock) {
          return (
            <span key={idx} style={dim}>
              {w.word}
            </span>
          );
        }
        // Active segment → bright green; rest of the block → faint green wash.
        const active = w.start >= hlStartS && w.start < hlEndS;
        return (
          <span key={idx} style={active ? activeStyle : blockStyle}>
            {w.word}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Renders a hero image inside a fixed SQUARE frame on a SOLID background —
 * mirrors the worker-render `HeroImage` math so the studio preview matches the
 * final video. No transparency treatment: heroes always sit on a consistent
 * neutral fill. Applies the VA's crop (image-fraction coords) with background
 * fill for any out-of-bounds area.
 */
function HeroPreview({
  src,
  name,
  crop,
  background,
  sizePx,
}: {
  src?: string | null;
  name: string;
  crop?: HeroCrop;
  background?: string;
  sizePx: number;
}) {
  const bg = background ?? "#ffffff";
  const base: React.CSSProperties = {
    width: sizePx,
    height: sizePx,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
    flexShrink: 0,
    border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
    backgroundColor: bg,
  };
  if (!src) {
    return (
      <div
        style={{
          ...base,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1f2933",
        }}
      >
        <span style={{ fontSize: 10, color: DIM }}>no image</span>
      </div>
    );
  }
  if (crop && crop.w > 0 && crop.h > 0) {
    const dispW = sizePx / crop.w;
    const dispH = sizePx / crop.h;
    return (
      <div style={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          style={{
            position: "absolute",
            left: -crop.x * dispW,
            top: -crop.y * dispH,
            width: dispW,
            height: dispH,
            objectFit: "fill",
          }}
        />
      </div>
    );
  }
  return (
    <div style={base}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

/**
 * Preview + replace + arrange the hero image the auto-generated tier-board and
 * reveal shots render for this item. Rendered on a consistent SOLID background
 * (no transparency). Crop/arrange happens in the dedicated editor (opened from
 * here or from the top block strip). Replacement is stored as a heroSelection
 * override that wins over the auto-fetched hero at render time.
 */
function HeroPanel({
  block,
  saving,
  heroInputRef,
  onUpload,
  onReset,
  onEdit,
}: {
  block: Block;
  saving: boolean;
  heroInputRef: React.RefObject<HTMLInputElement>;
  onUpload: (files: FileList | null) => void;
  onReset: () => void;
  onEdit: () => void;
}) {
  const btn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 8,
    background: "rgba(var(--v2-accent-rgb),0.1)",
    border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
    color: "var(--v2-accent)",
    fontSize: 11,
    fontWeight: 700,
    cursor: saving ? "wait" : "pointer",
  };
  return (
    <div style={scriptPanelStyle}>
      <SectionLabel text="Auto-generated shots — hero image (tier board + reveal)" />
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          marginTop: 6,
        }}
      >
        <HeroPreview
          src={block.heroImageUrl}
          name={block.itemName}
          crop={block.heroCrop}
          background={block.heroBackground}
          sizePx={84}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 11,
              color: SUBTLE,
              lineHeight: 1.5,
              margin: "0 0 8px",
            }}
          >
            Shown for <b>{block.itemName}</b> in the <b>{block.tierName}</b>{" "}
            tier board tile and its reveal shot. Every hero renders on a solid
            background at the same square aspect — use <b>Arrange</b> to pan /
            zoom and re-centre the product.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btn}
              disabled={saving || !block.heroImageUrl}
              onClick={onEdit}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                crop
              </span>
              Arrange
            </button>
            <button
              type="button"
              style={btn}
              disabled={saving}
              onClick={() => heroInputRef.current?.click()}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                upload
              </span>
              Replace image
            </button>
            <button
              type="button"
              style={{
                ...btn,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: SUBTLE,
              }}
              disabled={saving}
              onClick={onReset}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                restart_alt
              </span>
              Reset to auto
            </button>
            <input
              ref={heroInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => onUpload(e.target.files)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small clickable node in the top strip that previews an item's auto-shot hero
 *  (tier-board tile + reveal) and opens the crop/arrange editor on click. */
function HeroNode({ block, onClick }: { block: Block; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Edit auto-shot imagery — ${block.itemName}`}
      style={{
        position: "relative",
        width: 40,
        height: 40,
        flexShrink: 0,
        padding: 0,
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        border: "1px dashed rgba(var(--v2-accent-rgb),0.4)",
        background: "#fff",
      }}
    >
      <HeroPreview
        src={block.heroImageUrl}
        name={block.itemName}
        crop={block.heroCrop}
        background={block.heroBackground}
        sizePx={38}
      />
      <span
        className="material-symbols-outlined"
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          fontSize: 12,
          color: "#fff",
          background: "rgba(0,0,0,0.55)",
          borderTopLeftRadius: 4,
          padding: "1px 2px",
        }}
      >
        crop
      </span>
    </button>
  );
}

/**
 * Hero crop / arrange editor. The VA pans (drag) and zooms (wheel / slider) the
 * hero within a FIXED SQUARE output frame; the frame is exactly what the render
 * keeps. Anything outside the image fills with the chosen background colour
 * (never distorted). Saves `heroSelection.crop` (image-fraction coords) +
 * background. Math mirrors worker-render `HeroImage` so preview == final.
 */
function HeroEditorModal({
  block,
  saving,
  onClose,
  onSave,
  onReplace,
}: {
  block: Block;
  saving: boolean;
  onClose: () => void;
  onSave: (crop: HeroCrop, background: string) => void;
  onReplace: (files: FileList | null) => void;
}) {
  const WORK = 360; // on-screen work box (square), px
  const MIN = 40; // smallest crop square, px
  const PAD = 40; // background margin around the image inside the work box
  const INNER = WORK - PAD * 2; // the image is contained within this inner box
  const VIS = 44; // keep at least this much of the crop box on-screen
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Crop square in work-box px (top-left + size). null until the image loads.
  const [crop, setCrop] = useState<{
    x: number;
    y: number;
    size: number;
  } | null>(null);
  const [background, setBackground] = useState(
    block.heroBackground ?? "#ffffff",
  );
  // Paintbrush: cover watermarks/labels inside the crop box before the render.
  const [paintMode, setPaintMode] = useState(false);
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(16);
  const [strokes, setStrokes] = useState<
    Array<{ color: string; size: number; pts: Array<{ x: number; y: number }> }>
  >([]);
  const [applyingPaint, setApplyingPaint] = useState(false);
  const [paintError, setPaintError] = useState<string | null>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const src = block.heroImageUrl ?? undefined;

  // Contain-fit the image inside the INNER box (uniform scale → a screen-square
  // maps to a square region of the image, so the kept crop never distorts). The
  // PAD margin gives room to drag the crop box partly off the image — that area
  // fills with the background so an off-centre product can be re-centred.
  const aspect = natural && natural.h > 0 ? natural.w / natural.h : 1;
  const imgW = aspect >= 1 ? INNER : INNER * aspect;
  const imgH = aspect >= 1 ? INNER / aspect : INNER;
  const imgLeft = (WORK - imgW) / 2;
  const imgTop = (WORK - imgH) / 2;

  // Clamp keeps size sane but lets the box slide PAST the work-box edges (only
  // VIS px must stay visible) so you can push a product to the centre with
  // background fill on the outer side.
  const clamp = (c: { x: number; y: number; size: number }) => {
    const size = Math.min(WORK, Math.max(MIN, c.size));
    return {
      size,
      x: Math.min(WORK - VIS, Math.max(VIS - size, c.x)),
      y: Math.min(WORK - VIS, Math.max(VIS - size, c.y)),
    };
  };

  // Seed the crop square from an existing crop, else default to the whole image
  // (largest square showing all of it — extends past the short axis, which
  // fills with the background, exactly like the auto hero).
  useEffect(() => {
    if (!natural) return;
    const c = block.heroCrop;
    if (c && c.w > 0 && c.h > 0) {
      // clamp: legacy crops from the old pan/zoom editor could be larger than
      // the work box (zoomed out → c.w > 1); snap them into range on open.
      const size = c.w * imgW;
      setCrop(clamp({ x: imgLeft + c.x * imgW, y: imgTop + c.y * imgH, size }));
    } else {
      const size = Math.max(imgW, imgH);
      setCrop({
        x: imgLeft + (imgW - size) / 2,
        y: imgTop + (imgH - size) / 2,
        size,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, block.itemId]);

  // Crop → image-fraction coords. May go negative / exceed 1 when the square
  // extends past the image; the render fills those areas with the background.
  const toFractions = (c: {
    x: number;
    y: number;
    size: number;
  }): HeroCrop => ({
    x: (c.x - imgLeft) / imgW,
    y: (c.y - imgTop) / imgH,
    w: c.size / imgW,
    h: c.size / imgH,
  });

  // Drag the whole square to reposition it.
  const beginBodyDrag = (e: React.PointerEvent) => {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const b = crop;
    const move = (ev: PointerEvent) =>
      setCrop(
        clamp({
          x: b.x + (ev.clientX - startX),
          y: b.y + (ev.clientY - startY),
          size: b.size,
        }),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag a corner to resize (aspect-locked square, opposite corner anchored).
  const beginCornerDrag =
    (corner: "tl" | "tr" | "bl" | "br") => (e: React.PointerEvent) => {
      if (!crop || !workRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const b = crop;
      const anchorX = corner === "tl" || corner === "bl" ? b.x + b.size : b.x;
      const anchorY = corner === "tl" || corner === "tr" ? b.y + b.size : b.y;
      const rect = workRef.current.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const size = Math.max(
          MIN,
          Math.max(Math.abs(px - anchorX), Math.abs(py - anchorY)),
        );
        const nx =
          corner === "tl" || corner === "bl" ? anchorX - size : anchorX;
        const ny =
          corner === "tl" || corner === "tr" ? anchorY - size : anchorY;
        setCrop(clamp({ x: nx, y: ny, size }));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  // Slider: resize the square around its own centre.
  const setSizeCentered = (newSize: number) => {
    if (!crop) return;
    const cx = crop.x + crop.size / 2;
    const cy = crop.y + crop.size / 2;
    const size = Math.min(WORK, Math.max(MIN, newSize));
    setCrop(clamp({ x: cx - size / 2, y: cy - size / 2, size }));
  };

  const resetFraming = () => {
    if (!natural) {
      setBackground("#ffffff");
      return;
    }
    const size = Math.max(imgW, imgH);
    setCrop({
      x: imgLeft + (imgW - size) / 2,
      y: imgTop + (imgH - size) / 2,
      size,
    });
    setBackground("#ffffff");
  };

  // ── Paintbrush ─────────────────────────────────────────────────────────────
  // Points captured in work-box px, clamped INSIDE the crop box (its edges bound
  // where you can paint). On apply, composite the strokes onto the image at
  // natural resolution and re-upload it as the hero.
  const clampToBox = (px: number, py: number) => {
    if (!crop) return { x: px, y: py };
    return {
      x: Math.max(crop.x, Math.min(crop.x + crop.size, px)),
      y: Math.max(crop.y, Math.min(crop.y + crop.size, py)),
    };
  };

  const beginPaint = (e: React.PointerEvent) => {
    if (!paintMode || !workRef.current || !crop) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = workRef.current.getBoundingClientRect();
    const at = (cx: number, cy: number) =>
      clampToBox(cx - rect.left, cy - rect.top);
    const first = at(e.clientX, e.clientY);
    setStrokes((s) => [
      ...s,
      { color: brushColor, size: brushSize, pts: [first] },
    ]);
    const move = (ev: PointerEvent) => {
      const p = at(ev.clientX, ev.clientY);
      setStrokes((s) => {
        if (s.length === 0) return s;
        const last = s[s.length - 1]!;
        return [...s.slice(0, -1), { ...last, pts: [...last.pts, p] }];
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const applyPaint = async () => {
    if (!src || !natural || strokes.length === 0 || applyingPaint) return;
    setApplyingPaint(true);
    setPaintError(null);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image load failed"));
        img.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = natural.w;
      canvas.height = natural.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0, natural.w, natural.h);
      const sx = natural.w / imgW;
      const sy = natural.h / imgH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const st of strokes) {
        if (st.pts.length === 0) continue;
        ctx.strokeStyle = st.color;
        ctx.fillStyle = st.color;
        ctx.lineWidth = st.size * sx;
        if (st.pts.length === 1) {
          const p = st.pts[0]!;
          ctx.beginPath();
          ctx.arc(
            (p.x - imgLeft) * sx,
            (p.y - imgTop) * sy,
            (st.size * sx) / 2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else {
          ctx.beginPath();
          st.pts.forEach((p, i) => {
            const nx = (p.x - imgLeft) * sx;
            const ny = (p.y - imgTop) * sy;
            if (i === 0) ctx.moveTo(nx, ny);
            else ctx.lineTo(nx, ny);
          });
          ctx.stroke();
        }
      }
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res, "image/png"),
      );
      if (!blob) throw new Error("export failed");
      const file = new File([blob], `${block.itemName || "hero"}-painted.png`, {
        type: "image/png",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      onReplace(dt.files); // re-uploads as the hero (framing resets to the new image)
      setStrokes([]);
      setPaintMode(false);
    } catch {
      setPaintError(
        "Couldn’t bake the paint (image may be from another source). Try Replace image with a local file first.",
      );
    } finally {
      setApplyingPaint(false);
    }
  };

  const cornerStyle = (
    corner: "tl" | "tr" | "bl" | "br",
  ): React.CSSProperties => ({
    position: "absolute",
    width: 16,
    height: 16,
    background: "#00dc82",
    border: "2px solid #0d0d12",
    borderRadius: 3,
    cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
    ...(corner === "tl" ? { left: -8, top: -8 } : {}),
    ...(corner === "tr" ? { right: -8, top: -8 } : {}),
    ...(corner === "bl" ? { left: -8, bottom: -8 } : {}),
    ...(corner === "br" ? { right: -8, bottom: -8 } : {}),
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 94vw)",
          background: "#0d0d12",
          borderRadius: 12,
          border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>
            Arrange hero — {block.itemName}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              color: SUBTLE,
              cursor: "pointer",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              close
            </span>
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            padding: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* Crop frame (fixed square). The image is transformed inside; the
              frame edge IS the crop boundary — anything outside is cut, any
              gap fills with `background`. */}
          <div
            ref={workRef}
            style={{
              position: "relative",
              width: WORK,
              height: WORK,
              flexShrink: 0,
              overflow: "hidden",
              borderRadius: 8,
              backgroundColor: background,
              touchAction: "none",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
            }}
          >
            {src ? (
              <>
                {/* Full image on the background — background shows wherever the
                    image doesn't cover / where the crop extends past it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={block.itemName}
                  draggable={false}
                  onLoad={(e) =>
                    setNatural({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    })
                  }
                  style={{
                    position: "absolute",
                    left: imgLeft,
                    top: imgTop,
                    width: imgW,
                    height: imgH,
                    objectFit: "fill",
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                />
                {crop && (
                  <div
                    onPointerDown={paintMode ? beginPaint : beginBodyDrag}
                    style={{
                      position: "absolute",
                      left: crop.x,
                      top: crop.y,
                      width: crop.size,
                      height: crop.size,
                      boxSizing: "border-box",
                      border: "2px solid rgba(0,220,130,0.95)",
                      // Dim everything outside the crop square (clipped by the
                      // work box's overflow:hidden).
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                      cursor: paintMode ? "crosshair" : "move",
                    }}
                  >
                    {/* Corner handles hidden in paint mode so the box body is a
                        pure painting surface. */}
                    {!paintMode &&
                      (["tl", "tr", "bl", "br"] as const).map((c) => (
                        <div
                          key={c}
                          onPointerDown={beginCornerDrag(c)}
                          style={cornerStyle(c)}
                        />
                      ))}
                  </div>
                )}
                {/* Live paint strokes — work-box px == SVG units. */}
                {strokes.length > 0 && (
                  <svg
                    width={WORK}
                    height={WORK}
                    viewBox={`0 0 ${WORK} ${WORK}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                    }}
                  >
                    {strokes.map((st, i) =>
                      st.pts.length === 1 ? (
                        <circle
                          key={i}
                          cx={st.pts[0]!.x}
                          cy={st.pts[0]!.y}
                          r={st.size / 2}
                          fill={st.color}
                        />
                      ) : (
                        <polyline
                          key={i}
                          points={st.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                          fill="none"
                          stroke={st.color}
                          strokeWidth={st.size}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ),
                    )}
                  </svg>
                )}
              </>
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: DIM,
                  fontSize: 12,
                }}
              >
                no image to arrange
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <p
              style={{
                fontSize: 11,
                color: SUBTLE,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Drag the green box to move it, or drag a corner to resize. The box
              is exactly what the render keeps; anything outside the image fills
              with the background colour.
            </p>
            <div style={{ marginTop: 14 }}>
              <SectionLabel text="Crop size" />
              <input
                type="range"
                min={MIN}
                max={WORK}
                step={1}
                value={crop?.size ?? WORK}
                onChange={(e) => setSizeCentered(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <SectionLabel text="Background fill" />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  style={{
                    width: 36,
                    height: 28,
                    padding: 0,
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    background: "none",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: 11, color: DIM }}>{background}</span>
                <button
                  type="button"
                  onClick={() => setBackground("#ffffff")}
                  style={swatchBtnStyle}
                >
                  White
                </button>
                <button
                  type="button"
                  onClick={() => setBackground("#000000")}
                  style={swatchBtnStyle}
                >
                  Black
                </button>
              </div>
            </div>

            {/* Paintbrush — cover a watermark/label inside the crop box. */}
            <div style={{ marginTop: 12 }}>
              <SectionLabel text="Paintbrush (cover labels inside the box)" />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => setPaintMode((p) => !p)}
                  style={{
                    ...swatchBtnStyle,
                    color: paintMode ? "#000" : SUBTLE,
                    background: paintMode
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.05)",
                    border: paintMode
                      ? "1px solid var(--v2-accent)"
                      : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {paintMode ? "Painting…" : "Paint"}
                </button>
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                  title="Brush colour"
                  style={{
                    width: 30,
                    height: 26,
                    padding: 0,
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    background: "none",
                    cursor: "pointer",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setBrushColor("#ffffff")}
                  style={swatchBtnStyle}
                >
                  White
                </button>
                <button
                  type="button"
                  onClick={() => setBrushColor("#000000")}
                  style={swatchBtnStyle}
                >
                  Black
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <span style={{ fontSize: 10, color: DIM, minWidth: 52 }}>
                  Thickness
                </span>
                <input
                  type="range"
                  min={2}
                  max={64}
                  step={1}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
              {strokes.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    disabled={applyingPaint || saving}
                    onClick={applyPaint}
                    style={{
                      ...swatchBtnStyle,
                      color: "var(--v2-accent)",
                      border: "1px solid rgba(var(--v2-accent-rgb),0.4)",
                      background: "rgba(var(--v2-accent-rgb),0.1)",
                    }}
                  >
                    {applyingPaint ? "Applying…" : "Apply paint"}
                  </button>
                  <button
                    type="button"
                    disabled={applyingPaint}
                    onClick={() => setStrokes((s) => s.slice(0, -1))}
                    style={swatchBtnStyle}
                  >
                    Undo stroke
                  </button>
                  <button
                    type="button"
                    disabled={applyingPaint}
                    onClick={() => setStrokes([])}
                    style={swatchBtnStyle}
                  >
                    Clear
                  </button>
                </div>
              )}
              {strokes.length > 0 && !paintError && (
                <p
                  style={{
                    fontSize: 9,
                    color: DIM,
                    margin: "6px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  Apply bakes the paint into the image and re-uploads it
                  (framing resets to the painted image).
                </p>
              )}
              {paintError && (
                <p
                  style={{
                    fontSize: 10,
                    color: "#ff6b6b",
                    fontWeight: 700,
                    margin: "6px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {paintError}
                </p>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 18,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                disabled={saving || !src || !crop}
                onClick={() => crop && onSave(toFractions(crop), background)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: saving ? "wait" : "pointer",
                  border: "1px solid var(--v2-accent)",
                  background: "var(--v2-accent)",
                  color: "#000",
                  opacity: saving || !src || !crop ? 0.5 : 1,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  save
                </span>
                {saving ? "Saving…" : "Save framing"}
              </button>
              {/* Replace image — doubled here so a VA can swap the picture
                  without leaving the arrange view. */}
              <button
                type="button"
                disabled={saving}
                onClick={() => replaceInputRef.current?.click()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: saving ? "wait" : "pointer",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                  background: "rgba(var(--v2-accent-rgb),0.1)",
                  color: "var(--v2-accent)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  upload
                </span>
                Replace image
              </button>
              <input
                ref={replaceInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  onReplace(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={resetFraming}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: SUBTLE,
                }}
              >
                Reset framing
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FramePane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <SectionLabel text={label} />
      <div
        style={{
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function NoMedia({ hint }: { hint?: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(205,195,215,0.3)",
        padding: 12,
        textAlign: "center",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 34 }}>
        videocam_off
      </span>
      {hint && (
        <span
          style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.02em" }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Loud, unmistakable empty state for a B-roll block that has zero fetched
 * candidates — the honest-coverage case. Reads as a task ("get footage"), never
 * a blank area, so the VA always knows the next action.
 */
function EmptyFootageBanner({
  fetching,
  onFetch,
}: {
  fetching: boolean;
  onFetch: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px dashed rgba(245,166,35,0.4)",
        background: "rgba(245,166,35,0.07)",
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 30, color: "#f5a623", flexShrink: 0 }}
      >
        movie_off
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
          No footage found for this item
        </div>
        <div style={{ fontSize: 11, color: SUBTLE, marginTop: 2 }}>
          Use <b>Fetch more</b> to search again, paste a YouTube URL, or drop
          your own clip in the Clipbase on the right. You can also <b>Skip</b>{" "}
          this block if no footage fits.
        </div>
      </div>
      <button
        type="button"
        onClick={onFetch}
        disabled={fetching}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          cursor: fetching ? "wait" : "pointer",
          border: "1px solid rgba(245,166,35,0.5)",
          background: "rgba(245,166,35,0.14)",
          color: "#f5a623",
          opacity: fetching ? 0.6 : 1,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 16,
            ...(fetching
              ? { animation: "brollspin 0.8s linear infinite" }
              : {}),
          }}
        >
          {fetching ? "progress_activity" : "cloud_download"}
        </span>
        {fetching ? "Fetching…" : "Fetch footage"}
      </button>
    </div>
  );
}

function ClipbaseRail({
  block,
  uploading,
  uploadProgress,
  fileInputRef,
  onFiles,
  onPickCandidate,
}: {
  block: Block;
  uploading: boolean;
  uploadProgress: number | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFiles: (files: FileList | null) => void;
  onPickCandidate: (idx: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const uploads = block.candidates.filter((c) => c.source === "va-upload");
  const pct = Math.round((uploadProgress ?? 0) * 100);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
        overflowY: "auto",
        padding: "0 2px",
      }}
    >
      <SectionLabel text="Clipbase — your uploads" />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          borderRadius: 10,
          border: dragOver
            ? "2px dashed var(--v2-accent)"
            : "2px dashed rgba(var(--v2-accent-rgb),0.25)",
          background: dragOver
            ? "rgba(var(--v2-accent-rgb),0.08)"
            : "rgba(255,255,255,0.03)",
          padding: "22px 12px",
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          {uploading ? "hourglass_empty" : "upload_file"}
        </span>
        <p style={{ fontSize: 12, color: SUBTLE, margin: "6px 0 2px" }}>
          {uploading
            ? pct >= 100
              ? "Processing clip…"
              : `Uploading… ${pct}%`
            : "Drop a clip or click (U)"}
        </p>
        <p style={{ fontSize: 10, color: "rgba(205,195,215,0.35)", margin: 0 }}>
          appended as a candidate for this block
        </p>
        {uploading && (
          <div
            style={{
              marginTop: 10,
              height: 6,
              borderRadius: 4,
              overflow: "hidden",
              background: "rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: 4,
                background: "var(--v2-accent)",
                transition: "width 120ms linear",
                // At 100% (bytes sent, server transcoding) pulse so the VA knows
                // work is still happening.
                opacity: pct >= 100 ? 0.6 : 1,
              }}
            />
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {uploads.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel text="Uploaded clips (click → active window source)" />
          {uploads.map((c) => (
            <button
              key={c.index}
              onClick={() => onPickCandidate(c.index)}
              title={c.title ?? `Candidate ${c.index + 1}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                color: TEXT,
                minWidth: 0,
              }}
            >
              {c.spriteUrl ? (
                <span
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 22,
                    borderRadius: 4,
                    backgroundImage: `url(${c.spriteUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "left center",
                  }}
                />
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: "var(--v2-accent)" }}
                >
                  movie
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {c.title ?? `Candidate ${c.index + 1}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineBlock({
  block,
  active,
  onClick,
}: {
  block: Block;
  active: boolean;
  onClick: () => void;
}) {
  // Thumbnail for the block strip. `thumbnailUrl` is only set by the Pexels
  // path, so on a yt-dlp job every tile fell through to the same grey "movie"
  // glyph and the whole top strip looked identical block to block ("the block
  // timeline looks the same in the first and second keyboard"). The filmstrip
  // sprite is present on those candidates — its first tile is a real frame of
  // THIS block's footage, so use it.
  const cand0 = block.candidates[0];
  const thumb = cand0?.thumbnailUrl ?? null;
  const spriteTile =
    !thumb && cand0?.spriteUrl && cand0.spriteFrames
      ? spriteTileBackground(cand0.spriteUrl, cand0.spriteFrames, 0)
      : null;
  const dotColor = block.approved
    ? "#00dc82"
    : block.skipped
      ? "rgba(255,255,255,0.3)"
      : "#ffc800";
  return (
    <button
      onClick={onClick}
      title={block.itemName}
      style={{
        position: "relative",
        width: 96,
        height: 54,
        flexShrink: 0,
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        padding: 0,
        background: "#000",
        border: active
          ? "2px solid var(--v2-accent)"
          : "1px solid rgba(255,255,255,0.1)",
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.85,
          }}
        />
      ) : spriteTile ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            opacity: 0.85,
            ...spriteTile,
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(205,195,215,0.3)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            movie
          </span>
        </div>
      )}
      <span
        style={{
          position: "absolute",
          top: 3,
          right: 3,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 5px ${dotColor}`,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "1px 4px",
          fontSize: 8,
          fontWeight: 700,
          color: "#e5e2e1",
          background: "rgba(0,0,0,0.65)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
        }}
      >
        {block.itemName}
      </span>
    </button>
  );
}

function AutoSpacer() {
  return (
    <div
      title="Auto-generated block"
      style={{
        width: 18,
        height: 54,
        flexShrink: 0,
        borderRadius: 4,
        background:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 4px, rgba(255,255,255,0.02) 4px, rgba(255,255,255,0.02) 8px)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}

/** Glanceable done/total progress meter for the header. */
function ProgressMeter({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const complete = total > 0 && done === total;
  return (
    <div
      title={`${done} of ${total} blocks reviewed`}
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <div
        style={{
          position: "relative",
          width: 88,
          height: 6,
          borderRadius: 4,
          background: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: 4,
            background: complete ? "#00dc82" : "var(--v2-accent)",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: complete ? "#00dc82" : SUBTLE,
          whiteSpace: "nowrap",
        }}
      >
        {done}/{total}
      </span>
    </div>
  );
}

/** Today's productivity tally for this VA station (videos submitted, blocks
 *  approved, B-roll minutes). A chip in the header with a motivational
 *  breakdown on hover — resets at midnight, persisted in localStorage. */
function VaCounter({
  stats,
}: {
  stats: { videos: number; blocks: number; brollMs: number };
}) {
  const [open, setOpen] = useState(false);
  const minutes = stats.brollMs / 60000;
  const rows: Array<[string, string, string]> = [
    ["movie", "Videos submitted", String(stats.videos)],
    ["content_cut", "Blocks approved", String(stats.blocks)],
    ["timer", "B-roll worked", `${minutes.toFixed(1)} min`],
  ];
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        title="Your work today"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          borderRadius: 20,
          fontSize: 10,
          fontWeight: 700,
          cursor: "default",
          border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
          background: "rgba(var(--v2-accent-rgb),0.1)",
          color: "var(--v2-accent)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          local_fire_department
        </span>
        {stats.videos} · {stats.blocks} · {minutes.toFixed(0)}m
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 200,
            minWidth: 220,
            padding: "12px 14px",
            borderRadius: 10,
            background: "#14141b",
            border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            boxShadow: "0 8px 26px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: TEXT,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Your work today
          </div>
          {rows.map(([icon, label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "3px 0",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15, color: "var(--v2-accent)" }}
              >
                {icon}
              </span>
              <span style={{ fontSize: 11, color: SUBTLE, flex: 1 }}>
                {label}
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: TEXT }}>
                {value}
              </span>
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              fontSize: 10,
              color: DIM,
              lineHeight: 1.4,
            }}
          >
            {stats.videos === 0 && stats.blocks === 0
              ? "First one today — let’s go 🚀"
              : "Keep the streak going — every block counts 🔥"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact keyboard-shortcut reference: a single chip that reveals the full
 *  legend on hover, so the header stays uncluttered but the shortcuts stay
 *  discoverable. */
function HotkeyLegend({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const keys: Array<[string, string]> = [
    ["J / K", "Prev / next block"],
    ["A", "Approve block"],
    ["S", "Skip block"],
    ["Space", "Play selection"],
    ["X", "Split (place cut)"],
    ["1–9", "Swap active source"],
    ["U", "Upload a clip"],
    ["Esc", "Cancel split"],
    ["?", "Full shortcut panel"],
  ];
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={onOpen}
    >
      <span
        title="Keyboard shortcuts (?)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 20,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.03em",
          cursor: "pointer",
          border: open
            ? "1px solid rgba(var(--v2-accent-rgb),0.4)"
            : "1px solid rgba(255,255,255,0.12)",
          background: open
            ? "rgba(var(--v2-accent-rgb),0.12)"
            : "rgba(255,255,255,0.04)",
          color: SUBTLE,
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          keyboard
        </span>
        Shortcuts
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 200,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 12px",
            minWidth: 200,
            padding: "12px 14px",
            borderRadius: 10,
            background: "#14141b",
            border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            boxShadow: "0 8px 26px rgba(0,0,0,0.55)",
          }}
        >
          {keys.map(([k, label]) => (
            <div key={k} style={{ display: "contents" }}>
              <kbd
                style={{
                  justifySelf: "start",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(var(--v2-accent-rgb),0.1)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                  color: "var(--v2-accent)",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {k}
              </kbd>
              <span
                style={{ fontSize: 11, color: SUBTLE, alignSelf: "center" }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudioButton({
  icon,
  label,
  kbd,
  onClick,
  disabled,
  active,
  busy,
}: {
  icon: string;
  label: string;
  kbd?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  busy?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        border: active
          ? "1px solid #ff5050"
          : hover && !disabled
            ? "1px solid rgba(var(--v2-accent-rgb),0.4)"
            : "1px solid rgba(255,255,255,0.1)",
        background: active
          ? "rgba(255,80,80,0.15)"
          : hover && !disabled
            ? "rgba(var(--v2-accent-rgb),0.12)"
            : "rgba(255,255,255,0.05)",
        color: active ? "#ff8080" : TEXT,
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 16,
          ...(busy ? { animation: "brollspin 0.8s linear infinite" } : {}),
        }}
      >
        {icon}
      </span>
      {label}
      {kbd && (
        <kbd
          style={{
            marginLeft: 2,
            padding: "1px 4px",
            borderRadius: 3,
            background: "rgba(255,255,255,0.08)",
            fontSize: 9,
            fontFamily: "monospace",
            color: DIM,
          }}
        >
          {kbd}
        </kbd>
      )}
    </button>
  );
}

function ActionBtn({
  label,
  icon,
  kbd,
  color,
  border,
  bg,
  onClick,
  disabled,
  fullWidth,
}: {
  label: string;
  icon: string;
  kbd?: string;
  color: string;
  border: string;
  bg: string;
  onClick: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: fullWidth ? "100%" : undefined,
        padding: "8px 14px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${border}`,
        background: bg,
        color,
        opacity: disabled ? 0.5 : 1,
        filter: hover && !disabled ? "brightness(1.18)" : "none",
        transition: "filter 120ms ease",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        {icon}
      </span>
      {label}
      {kbd && (
        <kbd
          style={{
            marginLeft: 2,
            padding: "1px 4px",
            borderRadius: 3,
            background: "rgba(0,0,0,0.2)",
            fontSize: 9,
            fontFamily: "monospace",
            opacity: 0.7,
          }}
        >
          {kbd}
        </kbd>
      )}
    </button>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: DIM,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "0 0 6px 0",
      }}
    >
      {text}
    </p>
  );
}

function CenterMessage({
  text,
  tone,
  children,
}: {
  text: string;
  tone?: "error";
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: tone === "error" ? "#ffb4ab" : "rgba(205,195,215,0.5)",
        fontSize: 13,
      }}
    >
      {text}
      {children}
    </div>
  );
}

// ── Static styles ─────────────────────────────────────────────────────────────

const backLinkStyle: React.CSSProperties = {
  color: "rgba(205,195,215,0.5)",
  textDecoration: "none",
  fontSize: 12,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 16px",
  borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.1)",
  flexShrink: 0,
};

const topTimelineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 16px",
  overflowX: "auto",
  borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.1)",
  flexShrink: 0,
};

const scriptPanelStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
};

const swatchBtnStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: SUBTLE,
  padding: "4px 8px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
};

const pillStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  background: "rgba(var(--v2-accent-rgb),0.12)",
  color: "var(--v2-accent)",
  border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
};

function toastStyle(type: "success" | "error"): React.CSSProperties {
  return {
    position: "fixed",
    bottom: 72,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background:
      type === "success" ? "rgba(0,220,130,0.15)" : "rgba(255,80,80,0.15)",
    color: type === "success" ? "#00dc82" : "#ff5050",
    border: `1px solid ${
      type === "success" ? "rgba(0,220,130,0.3)" : "rgba(255,80,80,0.3)"
    }`,
    backdropFilter: "blur(8px)",
    pointerEvents: "none",
  };
}
