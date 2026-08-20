'use client';

import { useMemo } from 'react';
import { useTimelineContext } from 'dnd-timeline';

interface TimelineRulerProps {
  /** How many px equals 1 second at current zoom */
  pxPerMs: number;
}

/**
 * TimelineRuler
 *
 * Renders a horizontal time ruler above the track rows.
 * Tick marks at 1s intervals (0.5s when zoomed in).
 * Labels at 5s intervals.
 *
 * Uses the visible range from the dnd-timeline context so tick density
 * adjusts automatically when the range changes.
 */
export function TimelineRuler({ pxPerMs }: TimelineRulerProps) {
  const { range } = useTimelineContext();

  const ticks = useMemo(() => {
    const totalMs = range.end - range.start;
    const totalPx = totalMs * pxPerMs;

    // Choose tick interval based on zoom level
    // At 60px/s (0.06px/ms): tick every 1000ms
    // At 120px/s (0.12px/ms): tick every 500ms
    const minTickPx = 40; // minimum pixels between ticks
    const candidates = [100, 250, 500, 1000, 2000, 5000, 10000]; // ms intervals
    const intervalMs = candidates.find((c) => c * pxPerMs >= minTickPx) ?? 1000;

    const labelEvery = intervalMs <= 500 ? 10 : 5; // label every Nth tick

    const result: Array<{ ms: number; major: boolean }> = [];
    const startTick = Math.ceil(range.start / intervalMs) * intervalMs;

    for (
      let ms = startTick;
      ms <= range.end;
      ms += intervalMs
    ) {
      const count = Math.round((ms - startTick) / intervalMs);
      result.push({ ms, major: count % labelEvery === 0 });
    }

    return { ticks: result, intervalMs, totalPx };
  }, [range, pxPerMs]);

  return (
    <div
      className="relative h-8 border-b border-white/10 select-none"
      style={{ width: (range.end - range.start) * pxPerMs }}
    >
      {ticks.ticks.map(({ ms, major }) => {
        const left = (ms - range.start) * pxPerMs;
        return (
          <div
            key={ms}
            className="absolute top-0 flex flex-col items-center"
            style={{ left, transform: 'translateX(-50%)' }}
          >
            <div
              className={`w-px ${major ? 'h-4 bg-white/40' : 'h-2 bg-white/20'}`}
            />
            {major && (
              <span className="text-[9px] text-white/40 font-mono mt-0.5 whitespace-nowrap">
                {formatMs(ms)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const tenths = Math.round((totalSeconds % 1) * 10);

  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  if (tenths > 0) return `${s}.${tenths}s`;
  return `${s}s`;
}
