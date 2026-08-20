/** Shared shapes for the global music library UI. */

export interface MusicTrack {
  id: string;
  name: string;
  file_path: string;
  duration_seconds: number;
  genre: string | null;
  format: string | null;
  creator: string | null;
  source: string;
  license: string | null;
  source_url: string | null;
  attribution_required: boolean;
  attribution_text: string | null;
  mood: string[];
  tags: string[];
  bpm: number | null;
  original_filename: string | null;
  file_bytes: number | null;
  generation_prompt: string | null;
  generation_provider: string | null;
  generation_task_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MusicFacets {
  genres: string[];
  creators: string[];
  sources: string[];
  formats: string[];
  moods: string[];
  tags: string[];
}

export interface MusicCollectionSummary {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  track_count: number;
  total_seconds: number;
}

export interface MusicAssignmentRow {
  id: string;
  collection_id: string;
  collection_name: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  selection_mode: string;
  volume_db: number;
}

export interface MusicGenerationRow {
  id: string;
  provider: string;
  provider_task_id: string | null;
  prompt: string;
  title: string | null;
  instrumental: boolean;
  genre: string | null;
  format: string | null;
  status: "queued" | "running" | "done" | "error";
  error_code: string | null;
  error_message: string | null;
  track_ids: string[];
  credit_cost: number | null;
  created_at: string;
  completed_at: string | null;
}

/** Human label for a `source` value. */
export const SOURCE_LABELS: Record<string, string> = {
  suno_ai33: "Suno (AI33)",
  minimax_ai33: "Minimax (AI33)",
  upload: "Uploaded",
  seed: "Seed data",
  unknown: "Unknown",
};

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
