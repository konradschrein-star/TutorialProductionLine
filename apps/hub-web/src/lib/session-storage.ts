/**
 * Session Storage Utilities
 *
 * Persists job creation form state across browser sessions.
 * Saves selections to localStorage and restores them on next visit.
 */

const STORAGE_KEY = "job-creation-session";

export interface JobCreationSession {
  selectedFormat?: string;
  channel_id?: string;
  template_id?: string;
  production_version?: string;
  subtitles?: boolean;
  auto_start?: boolean;
  skip_image_qc?: boolean;
  skip_final_qc?: boolean;
  language?: string;
  narrator_id?: string | null;
  character_id?: string | null;
  style_library_id?: string | null;
  format_style_library_id?: string | null; // New format style library system
  environment_id?: string | null;
  image_model?:
    | "bytedance-seedream-4.5"
    | "bytedance-seedream-4.5-1k"
    | "gemini-3.1-flash-image-preview";
  // Style selection for illustration formats (CASUALLY_EXPLAINED, etc.)
  style_selection?: {
    styleGuideId: string | null;
    selectedPersonaIds: string[];
    selectedBackgroundIds: string[];
    styleAssetContext: string | null;
  } | null;
  // Reactor format settings
  reactor_tts_provider?: "elevenlabs" | "minimax";
  reactor_tts_voice_id?: string;
  reactor_avatar_intensity?: number;
  reactor_max_scale_delta?: number;
  reactor_saturation_boost?: number;
}

/**
 * Save job creation session to localStorage
 */
export function saveJobCreationSession(session: JobCreationSession): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn("[session-storage] Failed to save session:", err);
  }
}

/**
 * Load job creation session from localStorage
 */
export function loadJobCreationSession(): JobCreationSession | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    return JSON.parse(stored) as JobCreationSession;
  } catch (err) {
    console.warn("[session-storage] Failed to load session:", err);
    return null;
  }
}

/**
 * Clear job creation session from localStorage
 */
export function clearJobCreationSession(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("[session-storage] Failed to clear session:", err);
  }
}
