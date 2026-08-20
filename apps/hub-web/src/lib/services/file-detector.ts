/**
 * Smart File Detector
 *
 * Groups dropped files by filename stem, pairs scripts with videos,
 * and returns structured staged job entries for the staging table.
 */

export interface DetectedJob {
  id: string;
  topic: string;
  script_text: string | null;
  script_filename: string | null;
  video_file: File | null;
  video_filename: string | null;
}

export interface DetectionResult {
  jobs: DetectedJob[];
  warnings: string[];
}

const SCRIPT_EXTENSIONS = ['.txt', '.md', '.srt'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov'];
const ACCEPTED_EXTENSIONS = [...SCRIPT_EXTENSIONS, ...VIDEO_EXTENSIONS, '.zip'];

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function getStem(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const name = dot >= 0 ? filename.slice(0, dot) : filename;
  // Normalize: lowercase, hyphens, underscores, and spaces treated as equivalent
  return name.toLowerCase().replace(/[\s_-]+/g, '-');
}

function stemToTopic(stem: string): string {
  // Convert filename stem to human-readable topic
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function generateId(): string {
  // crypto.randomUUID() requires secure context (HTTPS) — fallback for HTTP
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Read a text file's contents via FileReader (client-side).
 * For .srt files, strips SRT timing markers and sequence numbers,
 * returning only the subtitle text as a clean script.
 */
async function readTextFile(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });

  const ext = getExtension(file.name);
  if (ext === '.srt') {
    return parseSrtToText(raw);
  }
  return raw;
}

/**
 * Strip SRT formatting — remove sequence numbers, timestamps,
 * and blank lines. Returns clean text content only.
 */
function parseSrtToText(srt: string): string {
  return srt
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      // Skip empty lines
      if (!trimmed) return false;
      // Skip sequence numbers (lines that are just a number)
      if (/^\d+$/.test(trimmed)) return false;
      // Skip timestamp lines (00:00:00,000 --> 00:00:03,000)
      if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(trimmed)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect file types and group by filename stem.
 *
 * Multi-file matching:
 * 1. Group files by filename stem (normalized)
 * 2. Within each group: assign script and video
 * 3. Duplicates within a group keep first, warn about rest
 * 4. Unmatched files get their own row
 */
export async function detectAndGroupFiles(
  files: File[]
): Promise<DetectionResult> {
  const warnings: string[] = [];
  const groups = new Map<
    string,
    { scripts: File[]; videos: File[] }
  >();

  // Separate zip files (handled elsewhere) and unsupported files
  const processable: File[] = [];
  for (const file of files) {
    const ext = getExtension(file.name);
    if (ext === '.zip') {
      // Zips are handled by the caller via server action
      continue;
    }
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      warnings.push(`Unsupported file type: ${file.name}`);
      continue;
    }
    processable.push(file);
  }

  // Group by stem
  for (const file of processable) {
    const stem = getStem(file.name);
    const ext = getExtension(file.name);

    if (!groups.has(stem)) {
      groups.set(stem, { scripts: [], videos: [] });
    }
    const group = groups.get(stem)!;

    if (SCRIPT_EXTENSIONS.includes(ext)) {
      group.scripts.push(file);
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      group.videos.push(file);
    }
  }

  // Build jobs from groups
  const jobs: DetectedJob[] = [];

  for (const [stem, group] of groups) {
    // Warn about duplicates
    if (group.scripts.length > 1) {
      warnings.push(
        `Multiple scripts for "${stem}": using ${group.scripts[0].name}, ignoring ${group.scripts.slice(1).map((f) => f.name).join(', ')}`
      );
    }
    if (group.videos.length > 1) {
      warnings.push(
        `Multiple videos for "${stem}": using ${group.videos[0].name}, ignoring ${group.videos.slice(1).map((f) => f.name).join(', ')}`
      );
    }

    const scriptFile = group.scripts[0] ?? null;
    const videoFile = group.videos[0] ?? null;

    let scriptText: string | null = null;
    let scriptFilename: string | null = null;

    if (scriptFile) {
      try {
        scriptText = await readTextFile(scriptFile);
        scriptFilename = scriptFile.name;
      } catch {
        warnings.push(`Could not read ${scriptFile.name}`);
      }
    }

    jobs.push({
      id: generateId(),
      topic: stemToTopic(stem),
      script_text: scriptText,
      script_filename: scriptFilename,
      video_file: videoFile,
      video_filename: videoFile?.name ?? null,
    });
  }

  return { jobs, warnings };
}
