import { createHash } from "node:crypto";

/** Server-side revision fence for jobs reusing a recorded source. Timestamps
 * distinguish replacement uploads even where older storage reuses a path. */
export function tutorialSourceRevision(source: { recording_path: string | null; final_path: string | null; script_text: string | null; recorded_at: Date | null }): string {
  return createHash("sha256").update(JSON.stringify([
    source.recording_path, source.final_path, source.script_text, source.recorded_at?.toISOString() ?? null,
  ])).digest("hex");
}
