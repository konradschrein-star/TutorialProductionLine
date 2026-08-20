'use client';

import { useRef } from 'react';
import { useItem, useTimelineContext } from 'dnd-timeline';
import type { ResizeEndEvent, GetSpanFromResizeEvent } from 'dnd-timeline';
import { useTimelineStore } from './use-timeline-store';
import type { TimelineScene } from '@repo/contracts';

const LAYOUT_COLORS: Record<string, string> = {
  AVATAR_PIP:       'bg-lime-500/80   border-lime-400/40',
  AVATAR_FULLSCREEN:'bg-[rgba(35,222,203,0.7)]   border-[rgba(35,222,203,0.4)]',
  AVATAR_SPLIT:     'bg-purple-500/80 border-purple-400/40',
  QUOTE_CARD:       'bg-amber-500/80  border-amber-400/40',
  IMAGE_FULLSCREEN: 'bg-[rgba(239,68,68,0.7)]   border-[rgba(239,68,68,0.4)]',
};

const LAYOUT_SHORT: Record<string, string> = {
  AVATAR_PIP:       'PIP',
  AVATAR_FULLSCREEN:'FULL',
  AVATAR_SPLIT:     'SPLIT',
  QUOTE_CARD:       'QUOT',
  IMAGE_FULLSCREEN: 'IMG',
};

/** Resolve the best available preview URL for a scene. */
function getSceneImageUrl(scene: TimelineScene): string | null {
  if (scene.preview_r2_key) {
    return `/api/timeline/image-by-key?key=${encodeURIComponent(scene.preview_r2_key)}`;
  }
  const firstId = scene.video_frames[0]?.asset_id;
  if (firstId) return `/api/timeline/image/${firstId}`;
  return null;
}

interface SceneBlockProps {
  scene: TimelineScene;
  /** getSpanFromResizeEvent from the enclosing TimelineContext */
  getSpanFromResizeEvent: GetSpanFromResizeEvent;
  /** Current rendered pixel width of this block — used to decide which content to show */
  pxWidth: number;
}

/**
 * SceneBlock
 *
 * Draggable + resizable timeline block for one scene on the Video track.
 * Receives getSpanFromResizeEvent from its SceneBlockWithContext wrapper
 * so it doesn't need to call useTimelineContext itself — that keeps the
 * hook call order stable even when the scene list changes.
 */
export function SceneBlock({ scene, getSpanFromResizeEvent, pxWidth }: SceneBlockProps) {
  const { resizeScene, selectScene, selectedSceneId, selectedSceneIds, toggleSceneSelection } =
    useTimelineStore();
  const isSelected = selectedSceneId === scene.scene_id;
  const isMultiSelected = selectedSceneIds.has(scene.scene_id);
  const hasOtherSelected = selectedSceneId !== null && !isSelected;

  // Stable ref so handleResizeEnd always sees the latest resizer without
  // recreating the useItem callback on every render
  const resizeSceneRef = useRef(resizeScene);
  resizeSceneRef.current = resizeScene;
  const getSpanRef = useRef(getSpanFromResizeEvent);
  getSpanRef.current = getSpanFromResizeEvent;

  function handleResizeEnd(event: ResizeEndEvent) {
    const newSpan = getSpanRef.current(event);
    if (!newSpan) return;
    resizeSceneRef.current(scene.scene_id, newSpan.end - newSpan.start);
  }

  const { setNodeRef, itemStyle, itemContentStyle, listeners, attributes } = useItem({
    id: scene.scene_id,
    span: { start: scene.start_ms, end: scene.start_ms + scene.duration_ms },
    resizeHandleWidth: 8,
    onResizeEnd: handleResizeEnd,
  });

  const colorClass = LAYOUT_COLORS[scene.layout_type] ?? LAYOUT_COLORS['AVATAR_PIP']!;
  const shortLabel = LAYOUT_SHORT[scene.layout_type] ?? '?';
  const durationS = (scene.duration_ms / 1000).toFixed(1);
  const imageUrl = getSceneImageUrl(scene);

  // Image status: pending regen > has image > missing
  const hasPendingRegen = scene.regeneration_requests.some(
    (r) => r.status === 'pending' || r.status === 'dispatched'
  );
  const hasImage =
    scene.preview_r2_key != null ||
    scene.video_frames.some((f) => f.asset_id != null);
  const imageStatus = hasPendingRegen ? 'pending' : hasImage ? 'ready' : 'missing';

  // Progressive disclosure based on how wide the block is
  const showThumb = pxWidth >= 80 && imageUrl !== null;
  const showParagraph = pxWidth >= 150;

  return (
    <div ref={setNodeRef} style={itemStyle}>
      <div
        style={itemContentStyle}
        className={[
          'h-full rounded border cursor-pointer overflow-hidden select-none',
          'flex flex-row',
          colorClass,
          isSelected
            ? 'ring-2 ring-[#aaff00]/80 ring-offset-1 ring-offset-black/80'
            : isMultiSelected
            ? 'ring-2 ring-lime-400/60 ring-offset-1 ring-offset-black/80'
            : 'hover:brightness-110',
          hasOtherSelected && !isMultiSelected ? 'opacity-35' : 'opacity-100',
          'transition-[opacity,filter] duration-100',
        ].join(' ')}
        onClick={(e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: toggle multi-select
            toggleSceneSelection(scene.scene_id);
          } else {
            // Regular click: single-select inspector
            selectScene(isSelected ? null : scene.scene_id);
          }
        }}
        {...listeners}
        {...attributes}
      >
        {/* Thumbnail image — flush left, full block height */}
        {showThumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl!}
            alt=""
            draggable={false}
            loading="lazy"
            className="h-full w-10 object-cover shrink-0 opacity-80 pointer-events-none"
            style={{ maxWidth: Math.min(40, pxWidth * 0.4) }}
          />
        )}

        {/* Text content */}
        <div className="flex flex-col justify-between flex-1 min-w-0 px-1.5 py-1 overflow-hidden">
          {/* Top row: index + layout badge + image status dot */}
          <div className="flex items-start justify-between gap-0.5">
            <span className="text-[11px] font-bold text-[rgba(236,234,230,0.9)] leading-none tabular-nums">
              {scene.scene_index + 1}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <span
                className={[
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  imageStatus === 'ready'   ? 'bg-green-400/70'               :
                  imageStatus === 'pending' ? 'bg-yellow-400/80 animate-pulse' :
                                              'bg-[rgba(75,68,85,0.5)]',
                ].join(' ')}
                title={
                  imageStatus === 'ready'   ? 'Image ready'       :
                  imageStatus === 'pending' ? 'Regen in progress' :
                                              'No image yet'
                }
              />
              <span className="text-[7px] text-[rgba(205,195,215,0.6)] font-mono leading-none pt-0.5">
                {shortLabel}
              </span>
            </div>
          </div>

          {/* Paragraph snippet */}
          {showParagraph && (
            <p className="text-[8px] text-[rgba(205,195,215,0.7)] leading-tight line-clamp-2 break-words overflow-hidden">
              {scene.paragraph}
            </p>
          )}

          {/* Hook badge */}
          {scene.is_hook && (
            <span className="text-[7px] text-amber-200 font-bold leading-none tracking-wider">
              HOOK
            </span>
          )}

          {/* Bottom: duration */}
          <span className="text-[8px] text-[rgba(205,195,215,0.5)] font-mono leading-none tabular-nums">
            {durationS}s
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * SceneBlockWithContext
 *
 * Pulls getSpanFromResizeEvent out of the TimelineContext and passes it
 * as a prop to SceneBlock — cleanly separates context access from block logic.
 */
export function SceneBlockWithContext({ scene }: { scene: TimelineScene }) {
  const { getSpanFromResizeEvent, valueToPixels, range } = useTimelineContext();
  const left  = valueToPixels(scene.start_ms, range);
  const right = valueToPixels(scene.start_ms + scene.duration_ms, range);
  return (
    <SceneBlock
      scene={scene}
      getSpanFromResizeEvent={getSpanFromResizeEvent}
      pxWidth={Math.max(0, right - left)}
    />
  );
}
