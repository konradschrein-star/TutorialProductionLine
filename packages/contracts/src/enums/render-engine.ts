import { z } from "zod";

/**
 * Render Engine Enum
 *
 * Defines which rendering backend will be used for final video composition.
 * Routing logic lives in packages/domain (render routing node).
 *
 * - FFMPEG: Lightweight path for simple concatenation, static image-to-video,
 *           audio overlays, subtitle burns
 * - REMOTION: Heavyweight path for React-driven dynamic UI rendering,
 *             complex animated compositions
 */
export const RenderEngine = z.enum([
  "FFMPEG",
  "REMOTION",
]);

export type RenderEngine = z.infer<typeof RenderEngine>;
