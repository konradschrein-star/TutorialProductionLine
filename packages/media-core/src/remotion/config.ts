/**
 * Remotion Configuration Helpers
 *
 * Types and utilities for Remotion render configuration.
 */

export interface RemotionRenderConfig {
  fps: number;
  width: number;
  height: number;
  composition_id: string;
  captions_enabled?: boolean;
}

export interface RenderSettings {
  engine: "REMOTION" | "FFMPEG";
  captions_enabled: boolean;
  settings: RemotionRenderConfig;
}

/**
 * Extract Remotion config from template render_config JSONB.
 */
export function parseRenderConfig(renderConfig: unknown): RenderSettings {
  // Safe parsing - in production use Zod schema validation
  // Guard against null / undefined inputs (tests pass these to verify graceful defaults)
  const config = (renderConfig ?? {}) as RenderSettings;

  return {
    engine: config.engine || "REMOTION",
    captions_enabled: config.captions_enabled ?? true,
    settings: {
      fps: config.settings?.fps || 30,
      width: config.settings?.width || 1920,
      height: config.settings?.height || 1080,
      composition_id: config.settings?.composition_id || "DefaultComposition",
      captions_enabled: config.settings?.captions_enabled ?? true,
    },
  };
}
