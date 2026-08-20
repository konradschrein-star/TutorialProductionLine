import JSZip from 'jszip';
import { BatchMetaSchema, type BatchMeta } from '@/lib/schemas/batch-meta';

/**
 * Zip Parser for Mass Ingestion
 *
 * Parses a zip file containing job folders, each with a script.txt
 * and optional video.mp4. Returns structured job entries for dispatch.
 *
 * Expected zip structure:
 *   jobs/
 *     topic-name-one/
 *       script.txt       (required)
 *       video.mp4        (optional)
 *     topic-name-two/
 *       script.txt
 *   _batch_meta.json     (optional)
 */

const MAX_FOLDERS = 50;
const MAX_SCRIPT_CHARS = 50_000;
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB
const IGNORED_PATTERNS = [
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.git',
];
const VIDEO_EXTENSIONS = ['.mp4', '.mov'];
const SCRIPT_FILENAMES = ['script.txt', 'script.md'];

export interface ZipJobEntry {
  folder_name: string;
  initial_topic: string;
  script_text: string;
  video_buffer?: Buffer;
  video_filename?: string;
  video_content_type?: string;
}

export interface ZipParseResult {
  jobs: ZipJobEntry[];
  batch_meta?: BatchMeta;
  warnings: string[];
  errors: Array<{ folder: string; error: string }>;
}

function shouldIgnore(path: string): boolean {
  return IGNORED_PATTERNS.some(
    (p) => path.includes(p) || path.startsWith('.')
  );
}

function folderNameToTopic(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

/**
 * Parse an ingestion zip into structured job entries.
 *
 * Processes one folder at a time to keep peak memory at roughly
 * the size of the largest single video file.
 */
export async function parseIngestionZip(
  zipBuffer: Buffer
): Promise<ZipParseResult> {
  const result: ZipParseResult = {
    jobs: [],
    warnings: [],
    errors: [],
  };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    result.errors.push({ folder: '', error: 'Invalid or corrupt zip file' });
    return result;
  }

  // Collect all entry paths
  const entries = Object.keys(zip.files);

  // Check for _batch_meta.json at root
  const batchMetaEntry =
    zip.files['_batch_meta.json'] ?? zip.files['jobs/_batch_meta.json'];
  if (batchMetaEntry && !batchMetaEntry.dir) {
    try {
      const metaText = await batchMetaEntry.async('text');
      const parsed = JSON.parse(metaText);
      const validated = BatchMetaSchema.safeParse(parsed);
      if (validated.success) {
        result.batch_meta = validated.data;
      } else {
        result.warnings.push(
          `_batch_meta.json validation failed: ${validated.error.message}`
        );
      }
    } catch {
      result.warnings.push('_batch_meta.json could not be parsed as JSON');
    }
  }

  // Discover job folders — either under jobs/ prefix or at root level
  const folderMap = new Map<string, string[]>();

  for (const entryPath of entries) {
    if (shouldIgnore(entryPath)) continue;

    // Normalize: strip leading jobs/ prefix if present
    let normalized = entryPath;
    if (normalized.startsWith('jobs/')) {
      normalized = normalized.slice(5);
    }

    // Skip root-level files (like _batch_meta.json)
    if (!normalized.includes('/')) continue;

    const parts = normalized.split('/');
    const folderName = parts[0];
    if (!folderName) continue;

    // Skip if it's a nested subfolder beyond one level
    if (parts.length > 2) {
      continue;
    }

    const fileName = parts[1];
    if (!fileName) continue; // directory entry itself

    if (!folderMap.has(folderName)) {
      folderMap.set(folderName, []);
    }
    folderMap.get(folderName)!.push(entryPath);
  }

  if (folderMap.size === 0) {
    result.errors.push({
      folder: '',
      error:
        'No job folders found. Expected folders containing script.txt inside the zip.',
    });
    return result;
  }

  if (folderMap.size > MAX_FOLDERS) {
    result.errors.push({
      folder: '',
      error: `Too many folders (${folderMap.size}). Maximum is ${MAX_FOLDERS}.`,
    });
    return result;
  }

  // Process each folder
  for (const [folderName, filePaths] of folderMap) {
    let scriptText: string | null = null;
    let videoBuffer: Buffer | undefined;
    let videoFilename: string | undefined;
    let videoContentType: string | undefined;

    for (const filePath of filePaths) {
      const fileName = filePath.split('/').pop()!.toLowerCase();
      const originalFileName = filePath.split('/').pop()!;

      // Script file
      if (SCRIPT_FILENAMES.includes(fileName)) {
        try {
          const text = await zip.files[filePath].async('text');
          if (text.length > MAX_SCRIPT_CHARS) {
            result.errors.push({
              folder: folderName,
              error: `Script exceeds ${MAX_SCRIPT_CHARS} characters (${text.length})`,
            });
            scriptText = null;
            break;
          }
          if (text.trim().length === 0) {
            result.errors.push({
              folder: folderName,
              error: 'Script file is empty',
            });
            scriptText = null;
            break;
          }
          scriptText = text;
        } catch {
          result.errors.push({
            folder: folderName,
            error: 'Failed to read script file',
          });
          break;
        }
        continue;
      }

      // Video file
      const ext = getExtension(fileName);
      if (VIDEO_EXTENSIONS.includes(ext)) {
        const entry = zip.files[filePath];
        // Check uncompressed size before extracting (internal JSZip property)
        const entryData = (entry as any)._data;
        if (entryData && typeof entryData.uncompressedSize === 'number') {
          if (entryData.uncompressedSize > MAX_VIDEO_SIZE) {
            result.errors.push({
              folder: folderName,
              error: `Video exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit (${Math.round(entryData.uncompressedSize / 1024 / 1024)}MB)`,
            });
            break;
          }
        }

        try {
          const buf = await entry.async('nodebuffer');
          if (buf.length > MAX_VIDEO_SIZE) {
            result.errors.push({
              folder: folderName,
              error: `Video exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit (${Math.round(buf.length / 1024 / 1024)}MB)`,
            });
            break;
          }
          videoBuffer = buf;
          videoFilename = originalFileName;
          videoContentType =
            ext === '.mov' ? 'video/quicktime' : 'video/mp4';
        } catch {
          result.errors.push({
            folder: folderName,
            error: 'Failed to extract video file',
          });
          break;
        }
        continue;
      }

      // Unknown file — warn
      result.warnings.push(
        `${folderName}: ignoring unknown file "${originalFileName}"`
      );
    }

    // Check if this folder had errors that prevent inclusion
    const hasError = result.errors.some((e) => e.folder === folderName);
    if (hasError) continue;

    if (!scriptText) {
      result.errors.push({
        folder: folderName,
        error: 'Missing script.txt',
      });
      continue;
    }

    result.jobs.push({
      folder_name: folderName,
      initial_topic: folderNameToTopic(folderName),
      script_text: scriptText,
      video_buffer: videoBuffer,
      video_filename: videoFilename,
      video_content_type: videoContentType,
    });
  }

  return result;
}
