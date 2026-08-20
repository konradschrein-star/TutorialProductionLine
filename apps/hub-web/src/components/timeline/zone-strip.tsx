'use client';

import { useMemo } from 'react';
import { useTimelineContext } from 'dnd-timeline';
import type { VideoTimeline } from '@repo/contracts';

interface ZoneStripProps {
  timeline: VideoTimeline;
  pxPerMs: number;
}

/**
 * ZoneStrip
 *
 * A thin colored band above the video track showing the structural zones:
 * - HOOK: amber — fast cuts, hook-optimized image prompts
 * - BODY: slate — main content, biome-based layout
 * - OUTRO: indigo — closing section
 *
 * Also marks biome boundaries as subtle vertical lines and shows a warning
 * badge when 3+ consecutive scenes share the same layout type.
 */
export function ZoneStrip({ timeline, pxPerMs }: ZoneStripProps) {
  const { range } = useTimelineContext();
  const plan = (timeline as any).scenes; // access scenes for zone computation

  const { hookMs, outroMs } = useMemo(() => {
    // Find zone boundaries from scenes flagged with is_hook and composition plan
    const scenes = timeline.scenes;
    if (scenes.length === 0) return { hookMs: 0, outroMs: timeline.total_duration_ms };

    // Hook ends at the last scene flagged as is_hook
    const lastHookScene = [...scenes].reverse().find((s) => s.is_hook);
    const hookMs = lastHookScene
      ? lastHookScene.start_ms + lastHookScene.duration_ms
      : 0;

    // Outro: last 15% of duration (approximation when plan data isn't in timeline)
    const outroMs = Math.round(timeline.total_duration_ms * 0.85);

    return { hookMs, outroMs };
  }, [timeline]);

  const totalMs = range.end - range.start;

  // Diversity warnings: find runs of 3+ same layout
  const warnings = useMemo(() => {
    const result: Array<{ ms: number; label: string }> = [];
    const scenes = timeline.scenes;
    let run = 1;
    for (let i = 1; i < scenes.length; i++) {
      if (scenes[i]!.layout_type === scenes[i - 1]!.layout_type) {
        run++;
        if (run === 3) {
          // Warn at the middle scene of the run
          const midScene = scenes[i - 1]!;
          result.push({
            ms: midScene.start_ms + midScene.duration_ms / 2,
            label: `${scenes[i]!.layout_type} ×${run}`,
          });
        }
      } else {
        run = 1;
      }
    }
    return result;
  }, [timeline]);

  return (
    <div
      className="relative h-4 flex select-none"
      style={{ width: (range.end - range.start) * pxPerMs }}
    >
      {/* Hook zone — amber */}
      <div
        className="h-full bg-amber-500/30 border-r border-amber-400/40 flex items-center justify-center"
        style={{ width: Math.max(0, hookMs - range.start) * pxPerMs }}
        title={`Hook: 0 – ${(hookMs / 1000).toFixed(1)}s`}
      >
        <span className="text-[8px] text-amber-400/80 font-bold tracking-widest">HOOK</span>
      </div>

      {/* Body zone — slate */}
      <div
        className="h-full bg-slate-500/20 border-r border-slate-400/30 flex items-center justify-center"
        style={{ width: Math.max(0, outroMs - hookMs) * pxPerMs }}
        title={`Body: ${(hookMs / 1000).toFixed(1)}s – ${(outroMs / 1000).toFixed(1)}s`}
      >
        <span className="text-[8px] text-slate-400/60 font-bold tracking-widest">BODY</span>
      </div>

      {/* Outro zone — indigo */}
      <div
        className="h-full bg-indigo-500/20 flex items-center justify-center"
        style={{ width: Math.max(0, range.end - outroMs) * pxPerMs }}
        title={`Outro: ${(outroMs / 1000).toFixed(1)}s – end`}
      >
        <span className="text-[8px] text-indigo-400/60 font-bold tracking-widest">OUTRO</span>
      </div>

      {/* Diversity warnings */}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center z-10"
          style={{ left: (w.ms - range.start) * pxPerMs, transform: 'translateX(-50%)' }}
          title={`Layout repeats: ${w.label}`}
        >
          <div className="bg-yellow-400 text-black text-[7px] font-bold px-1 rounded-sm leading-tight">
            ⚠
          </div>
        </div>
      ))}
    </div>
  );
}
