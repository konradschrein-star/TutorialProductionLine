# @repo/media-core

Media transformation primitives for FFmpeg and Remotion rendering. **Status: Not yet implemented (stub package).**

## Purpose

Provide:
- FFmpeg wrappers for lightweight rendering (concatenation, overlays, burns)
- Remotion composition helpers for React-based rendering
- Media file probing (duration, resolution, codec)
- Composition validation
- Render utilities (progress tracking, temp file management)

## Planned Public API

### FFmpeg Wrappers

```typescript
import { renderFFmpeg, probeMedia, concatenateVideos } from "@repo/media-core";

// Lightweight rendering (concatenation + audio overlay)
await renderFFmpeg({
  inputs: [
    { type: "video", path: "/path/to/video1.mp4" },
    { type: "video", path: "/path/to/video2.mp4" }
  ],
  audio: "/path/to/audio.mp3",
  output: "/path/to/final.mp4",
  options: {
    resolution: "1920x1080",
    fps: 30,
    codec: "h264",
    bitrate: "5000k"
  }
});

// Probe media file
const info = await probeMedia("/path/to/video.mp4");
console.log(info.duration, info.resolution, info.codec);
```

### Remotion Composition

```typescript
import { renderRemotion, validateComposition } from "@repo/media-core";

// Heavyweight React-based rendering
await renderRemotion({
  compositionId: "ExplainerComposition",
  props: {
    script: "...",
    assets: {
      audio: "/path/to/audio.mp3",
      images: ["/path/to/img1.png", "/path/to/img2.png"]
    },
    config: {
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 900 // 30 seconds at 30fps
    }
  },
  output: "/path/to/final.mp4"
});

// Validate composition before rendering
const validation = validateComposition(composition);
if (!validation.valid) {
  console.error("Invalid composition:", validation.errors);
}
```

## Planned Directory Structure

```
src/
  ffmpeg/
    render.ts              # FFmpeg rendering pipeline
    probe.ts               # Media file probing
    concatenate.ts         # Video concatenation
    overlay.ts             # Audio/subtitle overlays
    burn.ts                # Burn subtitles into video

  remotion/
    render.ts              # Remotion rendering pipeline
    validate.ts            # Composition validation
    compositions/          # Reusable composition templates
      ExplainerComposition.tsx
      DocumentaryComposition.tsx

  utils/
    temp-files.ts          # Temporary file management
    progress.ts            # Render progress tracking

  index.ts                 # Public API surface
```

## Planned Dependencies

- **fluent-ffmpeg:** FFmpeg Node.js wrapper
- **@remotion/renderer:** Remotion server-side renderer
- **@remotion/lambda:** (Future) Remotion Lambda rendering

## Design Philosophy

### Render Path Decision

The system supports two render paths:

**Lightweight (FFmpeg):**
- Simple concatenation of static images + audio
- Subtitle burns
- Audio overlays
- Fast (CPU-bound but no React overhead)
- Good for simple templates (most Explainers, some Documentaries)

**Heavyweight (Remotion):**
- Complex React-based animations
- Dynamic text rendering
- Animated transitions
- Slower (React rendering + video encoding)
- Good for complex templates (Video Essays, some Documentaries)

### Render Routing

Decision made at `ROUTING_RENDER` status based on `template.render_config.engine`:

```typescript
if (template.render_config.engine === "FFMPEG") {
  // Transition to RENDERING_FFMPEG
  await renderFFmpeg(...);
} else {
  // Transition to RENDERING_REMOTION
  await renderRemotion(...);
}
```

## Current Status

**Not yet implemented.** This is a stub package created during monorepo initialization. Implementation planned for Phase 8 (Render Workers).

**Workaround for now:**
- Rendering logic stubbed in `apps/worker-render` (not yet created)
- QMS validation passes without actual rendering
- Jobs transition through render states but no actual video is generated

## Future Work

**Phase 8 implementation tasks:**

1. **FFmpeg integration:**
   - Install and configure fluent-ffmpeg
   - Implement concatenation pipeline
   - Implement audio overlay
   - Implement subtitle burning
   - Add progress tracking
   - Add error handling

2. **Remotion integration:**
   - Install @remotion/renderer
   - Create composition templates (Explainer, Documentary, Video Essay)
   - Implement server-side rendering
   - Add composition validation
   - Add progress tracking

3. **Testing:**
   - Unit tests for FFmpeg wrappers
   - Integration tests for Remotion compositions
   - End-to-end rendering tests

4. **Optimization:**
   - Parallel rendering (multiple Remotion compositions)
   - Lambda rendering (Remotion Lambda for scale)
   - Caching (intermediate render results)

## Design Decisions

**Why separate FFmpeg and Remotion paths?**
- Different performance profiles (FFmpeg is much faster)
- Different complexity levels (FFmpeg for simple, Remotion for complex)
- Cost optimization (don't use heavyweight React rendering when unnecessary)
- Scale independently (more FFmpeg workers, fewer Remotion workers)

**Why server-side Remotion rendering?**
- No browser required (runs in Node.js)
- Better resource control (CPU, memory)
- Easier deployment (no headless Chrome)
- Faster rendering (native FFmpeg integration)

**Why not use Lambda immediately?**
- Start with VPS rendering (simpler deployment)
- Scale to Lambda later if needed (Remotion Lambda is drop-in replacement)
- Cost optimization (VPS is cheaper for consistent workload)
