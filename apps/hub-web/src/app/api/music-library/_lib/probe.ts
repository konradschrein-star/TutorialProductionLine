import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import type { RawProbe } from "./audio-file";

/** Where uploaded and generated library tracks live on disk. */
export function libraryDir(): string {
  const mediaRoot = process.env.LOCAL_MEDIA_ROOT || "/opt/content-forge/media";
  return join(mediaRoot, "music-library");
}

/**
 * ffprobe a file on disk.
 *
 * Returns null when ffprobe itself fails, so the caller produces an explicit
 * error rather than a fabricated duration. `music_library.duration_seconds`
 * drives music-bed layout — a guessed value breaks renders silently.
 */
export async function probeAudioFile(path: string): Promise<RawProbe | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(path, (err, metadata) => {
      if (err) {
        console.error("[music-library] ffprobe failed:", path, err);
        resolve(null);
      } else {
        resolve(metadata as unknown as RawProbe);
      }
    });
  });
}
