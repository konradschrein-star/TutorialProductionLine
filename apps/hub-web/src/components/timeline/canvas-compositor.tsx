'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTimelineStore } from './use-timeline-store';
import type { VideoTimeline, TimelineScene, TimelineFrame } from '@repo/contracts';

/**
 * CanvasCompositor
 *
 * HTML5 Canvas preview of the current playhead position.
 * Does NOT require the final rendered video — composites directly
 * from raw assets (frame images + text overlays).
 *
 * Uses native Canvas API (not react-konva) for maximum performance
 * with simple image compositing. react-konva would be overkill for
 * static image display — Konva's strength is interactive object manipulation.
 *
 * Rendering layers (back to front):
 * 1. Background image (frame or still)
 * 2. Avatar PiP overlay (bottom-right/bottom-left corner)
 * 3. Text overlays (lower-third, ticker, center)
 * 4. Playhead time stamp (debug)
 *
 * Image caching: images are cached in a Map<url, HTMLImageElement>
 * so that frame-by-frame scrubbing doesn't re-fetch on every tick.
 * Pre-fetches the next scene's first frame when idle.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveFrame {
  imageUrl: string | null;
  pipUrl: string | null; // mutable: set to null when image fails to load
  scene: TimelineScene;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Given a playhead position within a scene, determine which frame is active.
 * Accumulates hold_duration_ms to find the frame covering offsetMs.
 */
function getActiveFrame(
  scene: TimelineScene,
  offsetMs: number
): TimelineFrame | null {
  if (scene.video_frames.length === 0) return null;

  let cursor = 0;
  for (const frame of scene.video_frames) {
    cursor += frame.hold_duration_ms;
    if (offsetMs < cursor) return frame;
  }
  // Past all frames: return the last one
  return scene.video_frames[scene.video_frames.length - 1] ?? null;
}

/**
 * Build the image URL for a frame asset or scene still.
 * Returns null if no image is available yet.
 */
function buildImageUrl(
  frame: TimelineFrame | null,
  scene: TimelineScene
): string | null {
  // Frame sequence asset (priority — frame-accurate)
  if (frame?.asset_id) {
    return `/api/timeline/image/${encodeURIComponent(frame.asset_id)}`;
  }
  // Scene-level R2 key (single still)
  if (scene.preview_r2_key) {
    return `/api/timeline/image-by-key?key=${encodeURIComponent(scene.preview_r2_key)}`;
  }
  return null;
}

/**
 * Build the PiP asset URL for an avatar clip.
 * Reuses the existing /api/timeline/image/[assetId] route which handles
 * both SSD and R2 assets transparently.
 * Returns null when no asset is available yet.
 */
function buildPipUrl(scene: TimelineScene): string | null {
  const assetId = scene.avatar_pip?.asset_id;
  if (!assetId) return null;
  return `/api/timeline/image/${encodeURIComponent(assetId)}`;
}

/**
 * Resolve the active frame data for the current playhead position.
 */
function resolveActiveFrame(
  timeline: VideoTimeline,
  playheadMs: number
): ActiveFrame | null {
  const scene = timeline.scenes.find(
    (s) => s.start_ms <= playheadMs && playheadMs < s.start_ms + s.duration_ms
  ) ?? timeline.scenes[timeline.scenes.length - 1];

  if (!scene) return null;

  const offsetMs = playheadMs - scene.start_ms;
  const frame = getActiveFrame(scene, offsetMs);
  const imageUrl = buildImageUrl(frame, scene);
  const pipUrl = buildPipUrl(scene);

  return { imageUrl, pipUrl, scene };
}

// ─── Image Cache ─────────────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

// ─── Canvas Compositor ────────────────────────────────────────────────────────

interface CanvasCompositorProps {
  timeline: VideoTimeline;
  /** Aspect ratio string, e.g. "16:9" or "9:16" */
  aspectRatio?: string;
  className?: string;
}

export function CanvasCompositor({
  timeline,
  aspectRatio = '16:9',
  className = '',
}: CanvasCompositorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastFrameRef = useRef<string | null>(null);
  const { playheadMs } = useTimelineStore();

  // Compute canvas dimensions from aspect ratio
  const [ar_w, ar_h] = aspectRatio.split(':').map(Number);
  const canvasW = 640;
  const canvasH = Math.round(canvasW * (ar_h ?? 9) / (ar_w ?? 16));

  /**
   * Render a single frame to canvas.
   */
  const render = useCallback(
    async (active: ActiveFrame) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Layer 1: Background image
      if (active.imageUrl) {
        try {
          const img = await loadImage(active.imageUrl);
          // Cover fit: maintain aspect ratio, fill canvas
          const scale = Math.max(canvasW / img.width, canvasH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const dx = (canvasW - drawW) / 2;
          const dy = (canvasH - drawH) / 2;
          ctx.drawImage(img, dx, dy, drawW, drawH);
        } catch {
          // Image not yet generated — show placeholder
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.fillStyle = '#333';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Image not generated yet', canvasW / 2, canvasH / 2);
        }
      } else {
        // No image — show scene info placeholder
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = '#2a2a2a';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Scene ${active.scene.scene_index + 1}`, canvasW / 2, canvasH / 2 - 10);
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '10px monospace';
        ctx.fillText(active.scene.layout_type, canvasW / 2, canvasH / 2 + 10);
      }

      // Layer 2: Avatar PiP overlay
      const pip = active.scene.avatar_pip;
      if (pip && pip.position !== 'hidden') {
        const pipScale = pip.scale ?? 0.3;
        const pipW = Math.round(canvasW * pipScale);
        const pipH = Math.round(pipW * (9 / 16)); // assume 16:9 pip clip
        const margin = 12;
        const pipX = pip.position === 'bottom-left' ? margin : canvasW - pipW - margin;
        const pipY = canvasH - pipH - margin;

        if (active.pipUrl) {
          try {
            const pipImg = await loadImage(active.pipUrl);
            // Clip to rounded rect
            ctx.save();
            ctx.beginPath();
            const r = 6;
            ctx.moveTo(pipX + r, pipY);
            ctx.lineTo(pipX + pipW - r, pipY);
            ctx.quadraticCurveTo(pipX + pipW, pipY, pipX + pipW, pipY + r);
            ctx.lineTo(pipX + pipW, pipY + pipH - r);
            ctx.quadraticCurveTo(pipX + pipW, pipY + pipH, pipX + pipW - r, pipY + pipH);
            ctx.lineTo(pipX + r, pipY + pipH);
            ctx.quadraticCurveTo(pipX, pipY + pipH, pipX, pipY + pipH - r);
            ctx.lineTo(pipX, pipY + r);
            ctx.quadraticCurveTo(pipX, pipY, pipX + r, pipY);
            ctx.closePath();
            ctx.clip();
            // Cover-fit the pip image
            const scale = Math.max(pipW / pipImg.width, pipH / pipImg.height);
            const dw = pipImg.width * scale;
            const dh = pipImg.height * scale;
            const dx = pipX + (pipW - dw) / 2;
            const dy = pipY + (pipH - dh) / 2;
            ctx.drawImage(pipImg, dx, dy, dw, dh);
            ctx.restore();
            // Border ring
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(pipX, pipY, pipW, pipH, r);
            ctx.stroke();
          } catch {
            // Asset not loaded yet — draw placeholder below
            active.pipUrl = null; // suppress to fall into placeholder path
          }
        }

        if (!active.pipUrl) {
          // Placeholder: semi-transparent rect with label
          ctx.fillStyle = 'rgba(30,30,40,0.75)';
          ctx.fillRect(pipX, pipY, pipW, pipH);
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(pipX, pipY, pipW, pipH);
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Avatar PiP', pipX + pipW / 2, pipY + pipH / 2 + 4);
          ctx.fillText('(pending VA upload)', pipX + pipW / 2, pipY + pipH / 2 + 16);
        }
      }

      // Layer 3: Text overlays
      if (active.scene.text_overlays.length > 0) {
        const overlay = active.scene.text_overlays[0]!;
        const overlayY = overlay.position === 'center'
          ? canvasH / 2
          : canvasH - 48;

        // Semi-transparent bar
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, overlayY - 28, canvasW, 40);

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(overlay.text, 16, overlayY - 6);
      }

      // Layer 4: Scene zone badge (top-left)
      if (active.scene.is_hook) {
        ctx.fillStyle = 'rgba(245,158,11,0.85)';
        ctx.fillRect(8, 8, 48, 18);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('HOOK', 14, 20);
      }

      // Layer 5: Timestamp (bottom-right debug)
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(canvasW - 80, canvasH - 22, 76, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatMs(playheadMs), canvasW - 8, canvasH - 8);
    },
    [canvasW, canvasH, playheadMs]
  );

  // Re-render when playhead changes
  useEffect(() => {
    const active = resolveActiveFrame(timeline, playheadMs);
    if (!active) return;

    const frameKey = `${active.imageUrl}:${playheadMs}`;
    if (frameKey === lastFrameRef.current) return; // nothing changed
    lastFrameRef.current = frameKey;

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(() => {
      render(active);
    });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [playheadMs, timeline, render]);

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        className="rounded border border-white/10 shadow-lg shadow-black/50"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
      <div className="text-xs text-white/30 font-mono">
        {formatMs(playheadMs)}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = Math.floor(totalS % 60);
  const tenths = Math.floor((totalS % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}
