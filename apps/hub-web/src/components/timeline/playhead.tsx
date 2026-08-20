'use client';

import { useCallback, useRef } from 'react';
import { useTimelineContext } from 'dnd-timeline';
import { useTimelineStore } from './use-timeline-store';

/**
 * Playhead
 *
 * A vertical line spanning all tracks, positioned at the current playhead time.
 * Draggable left/right via pointer events (no dnd-kit — just raw pointermove).
 *
 * The playhead line and its diamond-shaped head are rendered as an absolutely
 * positioned element inside the track scroll area. The parent must be
 * position:relative and the scroll area must be position:relative.
 */
export function Playhead({ tracksTotalHeight }: { tracksTotalHeight: number }) {
  const { playheadMs, setPlayhead, setPlaying } = useTimelineStore();
  const { range, getValueFromScreenX } = useTimelineContext();
  const isDragging = useRef(false);

  const leftPx = ((playheadMs - range.start) / (range.end - range.start)) * 100;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setPlaying(false);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [setPlaying]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const ms = getValueFromScreenX(e.clientX);
      const clamped = Math.max(range.start, Math.min(range.end, ms));
      setPlayhead(clamped);
    },
    [getValueFromScreenX, range, setPlayhead]
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div
      className="absolute top-0 z-30 flex flex-col items-center pointer-events-none"
      style={{
        left: `${leftPx}%`,
        height: tracksTotalHeight + 32, // ruler + tracks
        transform: 'translateX(-50%)',
      }}
    >
      {/* Diamond head — interactive */}
      <div
        className="w-3 h-3 bg-[#aaff00] rotate-45 cursor-col-resize pointer-events-auto shrink-0 shadow-lg shadow-black/50"
        style={{ marginTop: 20 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* Vertical line */}
      <div className="w-px bg-[#aaff00] flex-1 shadow-sm shadow-black/30" />
    </div>
  );
}
