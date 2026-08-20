import { useState, useEffect, useCallback } from "react";

/**
 * Job preset structure
 * These are the default settings that auto-apply when creating jobs for a template
 */
export interface JobPreset {
  template_id: string;
  channel_id: string;
  production_version: "V1" | "V2" | "V3";
  subtitles: boolean;
  auto_start: boolean;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
  language: string;
  environment_id?: string | null;
  music_enabled?: boolean;
  music_track_id?: string | null;
}

const STORAGE_KEY = "job-presets";

export function useJobPresets(templateId: string) {
  const [preset, setPreset] = useState<JobPreset | null>(null);
  const [loading, setLoading] = useState(true);

  // Load preset from localStorage (will be database in future)
  useEffect(() => {
    if (!templateId) {
      setLoading(false);
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const allPresets = JSON.parse(stored) as Record<string, JobPreset>;
        setPreset(allPresets[templateId] ?? null);
      }
    } catch (err) {
      console.warn("Failed to load preset:", err);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  const savePreset = useCallback(
    (presetData: Omit<JobPreset, "template_id">) => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const allPresets = stored
          ? (JSON.parse(stored) as Record<string, JobPreset>)
          : {};

        const newPreset: JobPreset = {
          ...presetData,
          template_id: templateId,
        };

        allPresets[templateId] = newPreset;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allPresets));
        setPreset(newPreset);

        return { success: true };
      } catch (err) {
        console.error("Failed to save preset:", err);
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [templateId],
  );

  const clearPreset = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const allPresets = JSON.parse(stored) as Record<string, JobPreset>;
        delete allPresets[templateId];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allPresets));
      }
      setPreset(null);
      return { success: true };
    } catch (err) {
      console.error("Failed to clear preset:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }, [templateId]);

  return {
    preset,
    loading,
    savePreset,
    clearPreset,
    hasPreset: preset !== null,
  };
}
