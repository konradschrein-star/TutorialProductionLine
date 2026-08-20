# Timeline Editor

## Overview

The Timeline Editor is an advanced video composition tool for editing Remotion-based video jobs in the Content Forge system. It provides frame-accurate control over scene timing, layout, audio, and effects before final video render.

**Current Status:** Fully integrated for Remotion workflows (V2 composition)

**Remotion-Only Constraint:** This feature works EXCLUSIVELY with Remotion-rendered jobs (production_version = "V3" in database). FFmpeg jobs (V1/V2) do not expose timeline editing because:

- FFmpeg renders are single-pass pipelines optimized for speed
- Ken Burns effects are baked into FFmpeg filter chains, not composable
- Remotion provides React-based scene abstraction that maps directly to timeline edits
- Timeline edits require bidirectional data flow: UI ↔ Database ↔ Render Worker

---

## Architecture

### Data Flow

```
UI (timeline-editor.tsx)
    ↓
Redux/Zustand store (use-timeline-store.ts)
    ↓
API endpoints (/api/timeline/[jobId])
    ↓
Database (video_timelines table)
    ↓
Render Worker (v2-composition.ts)
    ↓
Remotion Composition (v2-composition via timeline-to-composition.ts)
    ↓
Final Video Output (MP4)
```

### Component Structure

```
timeline-editor.tsx (Main UI Container)
├── timeline-editor-wrapper.tsx (Route integration)
├── use-timeline-store.ts (State management)
├── timeline-ruler.tsx (Time ruler + grid)
├── scene-block.tsx (Draggable scene elements)
├── scene-inspector.tsx (Right panel scene editor)
├── playhead.tsx (Playback position indicator)
├── zone-strip.tsx (Intro/outro zone visualization)
├── canvas-compositor.tsx (Scene preview)
└── References:
    ├── dnd-timeline library (Drag-and-drop infrastructure)
    └── @tanstack/react-query (Server synchronization)
```

### Database Schema

**Table:** `video_timelines`

```sql
CREATE TABLE video_timelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE,
  timeline_data JSONB NOT NULL,  -- Full VideoTimeline object
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (job_id) REFERENCES content_jobs(id) ON DELETE CASCADE,
  INDEX video_timelines_job_id_idx (job_id)
)
```

**`timeline_data` Structure (VideoTimeline):**

```typescript
{
  job_id: string;
  total_duration_ms: number;
  scenes: VideoTimelineScene[];
  global_audio: {
    music_duck_db: number;         // -30 to 0 dB (0 = no ducking)
    voiceover_gain_db: number;     // -12 to +6 dB
  };
}

interface VideoTimelineScene {
  scene_id: string;               // UUID
  scene_index: number;            // Original position (0-indexed)
  paragraph: string;              // Narration text
  start_ms: number;               // Absolute start time
  duration_ms: number;            // Scene length
  layout_type: "AVATAR_PIP" | "AVATAR_FULLSCREEN" | ... | "IMAGE_FULLSCREEN";
  transition_in?: "CUT" | "CROSSFADE" | "DIP_TO_BLACK";
  is_hook: boolean;               // Opening hook marker
  preview_r2_key?: string;        // Asset reference
  text_overlays: Array<{
    text: string;
    position: string;             // "lower-third", "top-center", etc.
  }>;
  voiceover: {
    offset_ms: number;            // Timing adjustment (-500 to +500 ms)
  };
  avatar_pip?: {
    position: "bottom-right" | "bottom-left" | "hidden";
    scale: number;                // 0.5 to 1.5
  };
}
```

---

## Features

### 1. Multi-Track Timeline

Four synchronized tracks:

- **Video Track** - Draggable scene blocks. Click to inspect. Reorder via drag-and-drop.
- **PiP Track** - Avatar picture-in-picture positioning and visibility indicators.
- **Text Track** - Text overlay presence and preview.
- **Audio Track** - Waveform visualization with voiceover offset indicators.

**Waveform Visualization:**

- Real waveform peaks loaded from `/api/timeline/[jobId]/waveform`
- Shows normalized amplitude [-1, +1] as bar chart
- Updates with scene-aware slicing for zoom context
- Fallback static bars while waveform loads

### 2. Scene Inspector

Right panel (appears on scene selection):

- **Layout editor** - Swap between layout types (Avatar PiP, Avatar Fullscreen, Quote Card, etc.)
- **Text overlays** - Add/edit/remove text with positioning
- **PiP controls** - Position (bottom-right, bottom-left, hidden) and scale (0.5-1.5)
- **Transition editor** - Select transition effect (Cut, Crossfade, Dip to Black)
- **Voiceover timing** - Adjust audio offset relative to video (-500 to +500 ms)
- **Hook marker** - Toggle opening hook status
- **Scene preview** - Canvas compositor shows layout preview (16:9 aspect ratio)

### 3. Playback & Scrubbing

- **Play/Pause** - Spacebar or button
- **Playhead** - Vertical indicator showing current position
- **Scrubbing** - Click ruler or drag playhead to seek
- **Real Audio Playback** - Audio element synced to playhead
- **Fallback Simulation** - When audio unavailable (TTS not ready), simulates playback via 100ms ticks
- **Time Display** - `m:ss.d` format (minutes:seconds.deciseconds)

### 4. Scene Reordering

- Drag scene blocks horizontally to reorder
- Reordering updates `scene_index` values
- Auto-recomputes timing (start_ms) to maintain continuity

### 5. Batch Operations

When 2+ scenes selected (Cmd+Click):

- **Apply Layout** - Set same layout type for all selected scenes
- **Regenerate** - Dispatch regeneration jobs to recreate assets
- **Delete** - Remove scenes with undo capability
- **Clear Selection** - Deselect all

### 6. Global Audio Control

Collapsible panel at bottom:

- **Music Duck** - Reduce music bed volume during voiceover (-30 to 0 dB)
- **Voiceover Gain** - Boost or cut voiceover amplitude (-12 to +6 dB)

Settings persisted to `timeline.global_audio` and applied during Remotion render.

### 7. History & Undo/Redo

- Full undo/redo stack (past/future arrays in Zustand store)
- Keyboard: `Ctrl+Z` undo, `Ctrl+Shift+Z` or `Ctrl+Y` redo
- Each edit (reorder, mutate, delete) creates undo checkpoint
- Can undo batch operations in a single action

### 8. Zoom & Pan

- **Zoom In/Out** - Center-preserving zoom (halves/doubles visible range)
- **Fit** - Auto-fit all scenes in viewport
- **Pan** - Mouse wheel or arrow keys to scroll timeline horizontally

### 9. Keyboard Shortcuts

| Action       | Key                    | Notes                               |
| ------------ | ---------------------- | ----------------------------------- |
| Play/Pause   | Space                  | Works outside text inputs           |
| Seek Left    | ←                      | 100ms by default, 1000ms with Shift |
| Seek Right   | →                      | 100ms by default, 1000ms with Shift |
| Undo         | Ctrl+Z (Cmd+Z on Mac)  | -                                   |
| Redo         | Ctrl+Shift+Z or Ctrl+Y | -                                   |
| Save         | Ctrl+S                 | Force save before next action       |
| Multi-select | Ctrl+Click             | -                                   |
| Escape       | Deselect               | Clear scene selection               |

---

## Usage Workflow

### 1. Access Timeline Editor

Timeline editor button appears **only** for Remotion jobs:

```typescript
// In job actions UI:
if (isRemotion(job.production_version)) {
  // Show "Edit Timeline" button
  // Routes to: /jobs/[jobId]/timeline
}
```

Accessible states:

- `AWAITING_QC` (post-render review)
- `AWAITING_UPLOADER` (final approval before upload)
- Any state after render completes

### 2. Load & Edit

1. Click "Edit Timeline" button
2. Wait for timeline to load from database
3. Make edits:
   - Reorder scenes
   - Adjust timing
   - Change layouts
   - Add text overlays
   - Edit voiceover timing
4. UI shows "Unsaved" indicator when dirty

### 3. Save Changes

- **Auto-save on Queue Render:** If you click "Queue Render" with unsaved changes, UI auto-saves first
- **Manual Save:** Ctrl+S or "Save" button (green, enabled when dirty)
- **Save API:** `PATCH /api/timeline/[jobId]` with full VideoTimeline object

### 4. Queue Render

1. Click "Queue Render" button
2. If unsaved: forces save first (shows "Saving…")
3. Dispatches POST `/api/timeline/[jobId]/render`
4. Button shows "Queued!" on success
5. SSE event `render_complete` updates UI when done
6. Can re-queue if render failed

### 5. Verify Output

After render completes:

- Download rendered video from job detail
- Compare against reference/previous versions
- If acceptable: move to QC approval or upload stage
- If issues: make edits and re-render

---

## API Endpoints

All endpoints require authentication (session-based RBAC).

### GET `/api/timeline/[jobId]`

Fetch timeline for job.

**Response:**

```json
{
  "timeline": {
    "job_id": "uuid",
    "total_duration_ms": 180000,
    "scenes": [...],
    "global_audio": { ... }
  }
}
```

**Status Codes:**

- `200 OK` - Timeline loaded
- `404 Not Found` - No timeline exists for this job (job may not have reached rendering yet)
- `401 Unauthorized` - Not authenticated

### PATCH `/api/timeline/[jobId]`

Save edited timeline.

**Request Body:**

```json
{
  "job_id": "uuid",
  "total_duration_ms": 180000,
  "scenes": [...],
  "global_audio": { ... }
}
```

**Response:**

```json
{
  "timeline": { ... }  // Returns saved timeline (echoes input)
}
```

**Status Codes:**

- `200 OK` - Timeline saved
- `400 Bad Request` - Invalid timeline structure
- `404 Not Found` - Job not found
- `401 Unauthorized` - Not authenticated

### POST `/api/timeline/[jobId]/render`

Dispatch timeline for rendering.

**Request Body:** Empty

**Response:**

```json
{
  "queued": true,
  "message": "Timeline dispatched to render queue"
}
```

**Status Codes:**

- `202 Accepted` - Queued for render
- `400 Bad Request` - Timeline has validation errors
- `404 Not Found` - Job not found
- `401 Unauthorized` - Not authenticated

**Side Effects:**

- Creates render job in BullMQ `queue:render-heavy`
- Updates job status to `RENDERING`
- Emits SSE events: `render_queued`, `render_complete`, `render_failed`

### GET `/api/timeline/[jobId]/waveform`

Fetch audio waveform peaks for visualization.

**Response:**

```json
{
  "peaks": [0.0, 0.1, 0.2, ..., 0.05],  // Normalized -1 to 1
  "duration_ms": 180000
}
```

**Status Codes:**

- `200 OK` - Waveform available
- `404 Not Found` - No audio or job not found
- `503 Service Unavailable` - Waveform generation in progress

### GET `/api/timeline/[jobId]/audio`

Stream combined voiceover audio (all scenes concatenated).

**Response:** MP3 audio stream (multipart/audio)

Used by `<audio>` element for playback in timeline UI.

### POST `/api/timeline/[jobId]/regenerate`

Regenerate a specific scene asset.

**Request Body:**

```json
{
  "scene_index": 0,
  "action": "full_regen" | "image_only" | "audio_only"
}
```

**Response:**

```json
{
  "job_id": "uuid",
  "scene_index": 0,
  "status": "queued"
}
```

Used by batch operations to refresh individual scene assets.

---

## Integration with Render Worker

### Render Time Flow

```typescript
// apps/worker-render/src/workflows/v2-composition.ts

// 1. Check for saved timeline
const savedTimelineRows = await db
  .select()
  .from(videoTimelines)
  .where(eq(videoTimelines.job_id, job.id));

if (savedTimelineRows.length > 0) {
  // 2. Map timeline to composition format
  const timeline = savedTimelineRows[0].timeline_data;
  const compositionScenes = mapTimelineToCompositionScenes(timeline, {
    totalDurationMs: timeline.total_duration_ms,
    fps: 30,
  });

  // 3. Extract global audio settings
  const audioSettings = extractGlobalAudioSettings(timeline);

  // 4. Use compositionScenes and audioSettings in Remotion render
  // Timeline overrides assembly_manifest completely
} else {
  // 5. Fallback: use assembly_manifest if no timeline
  // (for jobs created before timeline feature)
}
```

### Timeline → Composition Mapping

**File:** `apps/worker-render/src/workflows/timeline-to-composition.ts`

```typescript
export interface CompositionScene {
  sceneIndex: number;
  startMs: number;
  durationMs: number;
  paragraph: string;
  visualAssetKey: string | null;
  visualType: "AVATAR_PIP" | "AVATAR_FULLSCREEN" | ... | "IMAGE_FULLSCREEN";
  transitionIn?: "CUT" | "CROSSFADE" | "DIP_TO_BLACK";
  isHook: boolean;
  textOverlays: Array<{ text: string; position: string }>;
  voiceoverOffsetMs: number;
  pipPosition?: "bottom-right" | "bottom-left" | "hidden";
  pipScale?: number;
}

// Mapping function preserves:
// - Scene reordering (scene_index order)
// - Timing changes (start_ms, duration_ms)
// - Layout swaps (layout_type → visualType)
// - Transitions (transition_in)
// - Text overlays
// - PiP settings (position, scale)
// - Voiceover offset adjustments
```

### Why Remotion-Only?

1. **Composability** - Remotion renders React components frame-by-frame, so layout changes are trivial
2. **Scene Abstraction** - Each scene is a separate component, easily reorderable/remappable
3. **FFmpeg Incompatibility** - FFmpeg single-pass rendering can't apply timeline edits without full re-render
4. **Complexity** - Supporting FFmpeg timeline edits would require:
   - Duplicate Ken Burns computation logic
   - Re-parsing/modifying filter chains
   - Handling audio sync for offset edits
   - Increased render time (defeats FFmpeg speed advantage)
5. **User Intent** - Remotion jobs are for complex, format-specific layouts worth editing; FFmpeg jobs are fast baseline renders

---

## State Management

### Zustand Store (use-timeline-store.ts)

```typescript
export const useTimelineStore = create<TimelineStore>((set, get) => ({
  // Data
  timeline: null,
  selectedSceneId: null,
  selectedSceneIds: new Set(),

  // UI
  visibleRange: { start: 0, end: 180000 },
  playheadMs: 0,
  isPlaying: false,
  isDirty: false,
  isSaving: false,

  // History
  past: [],
  future: [],

  // Actions
  setTimeline,
  selectScene,
  reorderScenes,
  batchMutateScenes,
  batchDeleteScenes,
  undo,
  redo,
  setVisibleRange,
  setPlayhead,
  setPlaying,
  setGlobalAudio,
  // ... more actions
}));
```

**Key Patterns:**

- **Immutable Updates** - Each action creates new object, enabling undo/redo
- **Computed Dirty** - `isDirty` computed from timeline comparison
- **SSE Integration** - `useSSE('render_complete')` hook updates UI on render completion
- **Query Sync** - `useQuery` fetches timeline on mount, syncs with store

---

## Extension Points

### Adding New Layout Types

1. Update `VideoTimelineScene.layout_type` enum in `@repo/contracts`
2. Add case in `scene-inspector.tsx` layout picker
3. Implement layout component in `v2-composition.tsx` (Remotion side)
4. Add to batch layout options dropdown

### Adding New Transition Effects

1. Add to `transition_in` type in `@repo/contracts`
2. Update scene inspector transition picker
3. Implement transition in Remotion composition
4. Test on sample job

### Custom Audio Effects

Global audio panel can be extended:

1. Add slider to `GlobalAudioPanel`
2. Update `timeline.global_audio` object
3. Extract in `extractGlobalAudioSettings()`
4. Apply in Remotion audio mixing

### Exporting Timeline as Data

```typescript
// Could add endpoint for external editing:
// GET /api/timeline/[jobId]/export?format=json|csv
// Returns timeline data for external tools (Premiere, After Effects XML, etc.)
```

---

## Testing

### Unit Tests

**File:** `apps/worker-render/src/workflows/__tests__/timeline-to-composition.test.ts`

Tests mapping from VideoTimeline to CompositionScene format:

```typescript
describe("mapTimelineToCompositionScenes", () => {
  it("should map scene reordering correctly", () => { ... });
  it("should extract global audio settings", () => { ... });
  it("should handle PiP positioning and scale", () => { ... });
  it("should preserve text overlays and transitions", () => { ... });
});
```

### Integration Tests (Manual)

1. Create a job with Remotion renderer
2. After TTS + image gen complete, enter timeline editor
3. Verify:
   - Timeline loads correctly
   - Waveform appears
   - Play/pause works
   - Scrubbing syncs audio
   - Scene selection highlights
   - Save button is enabled
   - Queue render dispatches job
4. Check render worker logs for timeline mapping
5. Compare output video with reference

---

## Known Limitations & Future Work

### Current Limitations

1. **Audio-Only Edits** - Cannot change TTS text or regenerate voiceover. Only offset adjustments.
2. **Layout Constraints** - Cannot create custom layouts; limited to predefined types.
3. **No Batch Text Overlays** - Text overlays edited per-scene only.
4. **Preview Accuracy** - Canvas compositor is simplified 2D preview, not pixel-perfect Remotion output.
5. **Single Audio Track** - Global music bed ducking only; cannot mix multiple music layers.

### Future Enhancements

1. **Text Overlay Templates** - Predefined text styles (lower-third, centered, etc.)
2. **Keyframe Animation** - Timeline-based animations for PiP or text effects
3. **Multi-Clip Support** - Import external video clips into scene layout
4. **Real-time Preview** - Remotion embedded preview (currently canvas-based)
5. **Collaborative Editing** - Multi-user timeline editing with conflict resolution
6. **Timeline Snapshots** - Save/load editing checkpoints before risky changes
7. **Batch Timeline Operations** - Apply edits to multiple jobs at once
8. **Export/Import** - Timeline interchange format (JSON, XML for other tools)

---

## Troubleshooting

### Timeline Won't Load

**Symptom:** "Timeline unavailable" error

**Causes:**

1. Job never reached rendering stage (check job status)
2. Job is FFmpeg-based (V1 or V2 render)
3. Database connectivity issue

**Solution:**

- Verify job status is past `ROUTING_RENDER` → at `RENDERING` or later
- Check if `production_version` is "V3" (Remotion)
- Check database health at `/api/health`

### Playback Not Syncing with Scrubbing

**Symptom:** Audio element position doesn't match playhead

**Causes:**

1. Audio file not ready (still generating)
2. Sync flag stuck from interrupted interaction

**Solution:**

- Pause and resume playback
- Refresh browser (clears audio element)
- Check that TTS generation completed

### Save Fails Silently

**Symptom:** Click save, no visible response

**Causes:**

1. Network timeout
2. Invalid timeline structure

**Solution:**

- Check browser console for errors
- Verify all scenes have required fields
- Try exporting timeline JSON to validate
- Check server logs at `/api/health`

### Render Queue Stuck

**Symptom:** "Queue Render" button shows "Queued!" forever

**Causes:**

1. Render worker crashed
2. Job validation failed
3. Asset missing (image, audio)

**Solution:**

- Check worker logs: `pm2 logs worker-render`
- Verify timeline structure: `GET /api/timeline/[jobId]`
- Check asset manifest: `GET /api/jobs/[jobId]` (view r2_asset_manifest)
- Try re-queuing render

---

## See Also

- **SYSTEM.md** - Complete system architecture
- **v2-composition.ts** - Remotion render implementation
- **timeline-to-composition.ts** - Timeline mapping logic
- **@repo/contracts** - VideoTimeline type definitions
- **use-timeline-store.ts** - State management implementation
