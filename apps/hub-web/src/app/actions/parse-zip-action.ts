'use server';

import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { parseIngestionZip } from '@/lib/services/zip-parser';

/**
 * Parse Zip Server Action
 *
 * Receives a zip file via FormData, parses it into structured job entries.
 * Does NOT upload to R2 or dispatch to queue — that happens at dispatch time.
 * Returns text content and video metadata (no buffers sent to client).
 */

export interface ParsedZipJob {
  folder_name: string;
  topic: string;
  script_text: string;
  has_video: boolean;
  video_filename: string | null;
  video_size_bytes: number | null;
}

export interface ParseZipResult {
  success: boolean;
  jobs: ParsedZipJob[];
  batch_meta?: {
    template_id?: string;
    channel_id?: string;
    format?: string;
  };
  warnings: string[];
  errors: Array<{ folder: string; error: string }>;
}

export async function parseZipAction(
  formData: FormData
): Promise<ParseZipResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, 'create:job')) {
    return {
      success: false,
      jobs: [],
      warnings: [],
      errors: [{ folder: '', error: 'Permission denied' }],
    };
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return {
      success: false,
      jobs: [],
      warnings: [],
      errors: [{ folder: '', error: 'No zip file provided' }],
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const zipBuffer = Buffer.from(arrayBuffer);

  const result = await parseIngestionZip(zipBuffer);

  // Convert to client-safe format (strip video buffers, keep metadata)
  const jobs: ParsedZipJob[] = result.jobs.map((entry) => ({
    folder_name: entry.folder_name,
    topic: entry.initial_topic,
    script_text: entry.script_text,
    has_video: !!entry.video_buffer,
    video_filename: entry.video_filename ?? null,
    video_size_bytes: entry.video_buffer?.length ?? null,
  }));

  return {
    success: result.errors.length === 0 || jobs.length > 0,
    jobs,
    batch_meta: result.batch_meta,
    warnings: result.warnings,
    errors: result.errors,
  };
}
