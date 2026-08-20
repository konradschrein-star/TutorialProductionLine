import { exiftool } from "exiftool-vendored";
import { normalize } from "node:path";
import { existsSync } from "node:fs";

/**
 * Inject unique metadata into video file.
 * Anti-detection technique to create unique fingerprints per render.
 *
 * @param videoPath - Path to video file (modified in-place)
 * @param metadata - Metadata key-value pairs to inject
 */
export async function injectMetadata(
  videoPath: string,
  metadata: Record<string, string>
): Promise<void> {
  // Normalize path to platform-specific format (Windows: backslashes, Unix: forward slashes)
  const normalizedPath = normalize(videoPath);

  // Verify file exists before attempting metadata injection
  if (!existsSync(normalizedPath)) {
    throw new Error(`Metadata injection failed: File does not exist at ${normalizedPath}`);
  }

  try {
    await exiftool.write(normalizedPath, metadata);
    console.log(`[exiftool] Metadata injected: ${normalizedPath}`);
  } catch (err) {
    throw new Error(`Metadata injection failed: ${err}`);
  }
}
