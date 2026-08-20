import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { db, contentJobs } from '@/lib/db';
import { downloadAsset } from '@/lib/services/r2-service';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const PEAK_COUNT = 200; // Number of waveform bars to return

/**
 * GET /api/timeline/[jobId]/waveform
 *
 * Computes and returns audio waveform peak data for the timeline editor.
 * Returns PEAK_COUNT (200) normalised RMS amplitude values in [0, 1],
 * plus the audio duration in milliseconds.
 *
 * Strategy:
 * 1. Locate audio: r2_asset_manifest "audio/tts" entry OR narration_source_path
 * 2. If R2: download buffer into memory
 * 3. Pipe buffer through ffmpeg → mono 16-bit PCM at 1 kHz
 * 4. Divide PCM samples into PEAK_COUNT windows and compute RMS per window
 * 5. Normalise peaks to [0, 1] and return with duration_ms
 *
 * Caches the response for 10 minutes via Cache-Control (audio never changes
 * for a given job once TTS is complete).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:job-detail')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;

  const rows = await db
    .select({
      narration_source_path: contentJobs.narration_source_path,
      r2_asset_manifest: contentJobs.r2_asset_manifest,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, jobId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const job = rows[0]!;
  const manifest = (job.r2_asset_manifest ?? []) as Array<{
    key: string;
    type: string;
    size_bytes: number;
  }>;

  // ── Acquire audio buffer ──────────────────────────────────────────────────

  let audioBuffer: Buffer | null = null;

  const audioEntry = manifest.find((a) => a.type === 'audio/tts');
  if (audioEntry?.key) {
    try {
      const { buffer } = await downloadAsset(audioEntry.key);
      audioBuffer = buffer;
    } catch (err) {
      console.error('[waveform] R2 download failed:', err);
    }
  }

  if (!audioBuffer && job.narration_source_path) {
    try {
      audioBuffer = await readFile(job.narration_source_path);
    } catch (err) {
      console.error('[waveform] Disk read failed:', err);
    }
  }

  if (!audioBuffer) {
    return NextResponse.json({ error: 'No audio available for this job' }, { status: 404 });
  }

  // ── Extract PCM via ffmpeg ────────────────────────────────────────────────
  // Pipe audio buffer through ffmpeg to get mono 16-bit PCM at 1 kHz.
  // 1 kHz is low enough to be fast but high enough to resolve all peaks.

  const ffmpegBin = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
  let pcmBuffer: Buffer;

  try {
    const child = await new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(ffmpegBin, [
        '-v', 'quiet',
        '-i', 'pipe:0',     // read from stdin
        '-ac', '1',          // mono
        '-ar', '1000',       // 1 kHz sample rate
        '-f', 's16le',       // signed 16-bit little-endian PCM
        'pipe:1',            // output to stdout
      ]);

      const chunks: Buffer[] = [];
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stdout.on('end', () => resolve(Buffer.concat(chunks)));
      proc.stderr.on('data', () => {}); // suppress ffmpeg logs
      proc.on('error', reject);

      proc.stdin.write(audioBuffer!);
      proc.stdin.end();
    });
    pcmBuffer = child;
  } catch (err) {
    console.error('[waveform] ffmpeg PCM extraction failed:', err);
    return NextResponse.json({ error: 'ffmpeg PCM extraction failed' }, { status: 500 });
  }

  if (pcmBuffer.length === 0) {
    return NextResponse.json({ error: 'ffmpeg produced empty PCM output' }, { status: 422 });
  }

  // ── Compute RMS peaks ─────────────────────────────────────────────────────

  // PCM is s16le: 2 bytes per sample. Total samples = pcmBuffer.length / 2.
  const totalSamples = Math.floor(pcmBuffer.length / 2);
  const samplesPerPeak = Math.max(1, Math.floor(totalSamples / PEAK_COUNT));
  const peaks: number[] = [];

  for (let i = 0; i < PEAK_COUNT; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, totalSamples);
    let sumSquares = 0;
    for (let j = start; j < end; j++) {
      // Read signed 16-bit little-endian sample
      const sample = pcmBuffer.readInt16LE(j * 2);
      sumSquares += (sample / 32768) * (sample / 32768);
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    peaks.push(rms);
  }

  // Normalise to [0, 1]
  const maxPeak = Math.max(...peaks, 0.001); // prevent div-by-zero
  const normalisedPeaks = peaks.map((p) => p / maxPeak);

  // Duration in ms: totalSamples at 1 kHz = totalSamples ms
  const duration_ms = totalSamples;

  return NextResponse.json(
    { peaks: normalisedPeaks, duration_ms },
    {
      headers: {
        // Cache for 10 minutes — audio is stable once TTS is complete
        'Cache-Control': 'private, max-age=600',
      },
    }
  );
}
