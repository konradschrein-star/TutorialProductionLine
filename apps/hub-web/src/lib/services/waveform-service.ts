/**
 * Waveform Generation Service
 *
 * Lazy on-demand waveform generation for audio assets.
 * Generates 200-sample amplitude array for canvas rendering.
 * Data stored in database as JSONB for fast retrieval.
 *
 * Performance target: < 500ms per audio file
 */

import { execa } from 'execa';

const WAVEFORM_SAMPLES = 200;

/**
 * Generate waveform amplitude data for an audio file.
 * Returns an array of 200 normalized amplitude values (0-1).
 *
 * Uses FFmpeg's showwavespic filter to extract amplitude data.
 *
 * @param filePath Absolute path to the audio file
 * @returns Array of 200 normalized amplitude values (0-1)
 * @throws Error if FFmpeg fails or times out (500ms)
 */
export async function generateWaveform(filePath: string): Promise<number[]> {
  try {
    // Extract waveform data using FFmpeg
    // showwavespic generates a grayscale image where pixel brightness = amplitude
    const result = await execa(
      'ffmpeg',
      [
        '-i', filePath,
        '-filter_complex', `showwavespic=s=${WAVEFORM_SAMPLES}x1:colors=white`,
        '-frames:v', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'gray',
        'pipe:1'
      ],
      {
        timeout: 500,           // 500ms timeout
        encoding: 'buffer',     // Return stdout as Buffer
        stderr: 'pipe'          // Capture stderr for error messages
      }
    );

    // Parse raw bytes into amplitude values
    // Each byte represents one sample's amplitude (0-255)
    const amplitudes = Array.from(result.stdout).map(byte => byte / 255);

    // Ensure we have exactly the expected number of samples
    if (amplitudes.length !== WAVEFORM_SAMPLES) {
      console.warn(
        `[Waveform] Expected ${WAVEFORM_SAMPLES} samples, got ${amplitudes.length}. Padding/truncating.`
      );

      // Pad with zeros if too few samples
      while (amplitudes.length < WAVEFORM_SAMPLES) {
        amplitudes.push(0);
      }

      // Truncate if too many samples
      amplitudes.length = WAVEFORM_SAMPLES;
    }

    return amplitudes;

  } catch (error) {
    throw new Error(
      `Waveform generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract audio duration in seconds using FFprobe.
 *
 * @param filePath Absolute path to the audio/video file
 * @returns Duration in seconds (floating point)
 * @throws Error if FFprobe fails or times out (1 second)
 */
export async function extractAudioDuration(filePath: string): Promise<number> {
  try {
    const result = await execa(
      'ffprobe',
      [
        '-v', 'error',                           // Only show errors
        '-show_entries', 'format=duration',      // Show duration only
        '-of', 'default=noprint_wrappers=1:nokey=1', // Plain output
        filePath
      ],
      {
        timeout: 1000,          // 1 second timeout
        encoding: 'utf8'
      }
    );

    const duration = parseFloat(result.stdout.trim());

    if (isNaN(duration)) {
      throw new Error(`Invalid duration: ${result.stdout}`);
    }

    return duration;

  } catch (error) {
    throw new Error(
      `Duration extraction failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Normalize an array of amplitude values to the range [0, 1].
 * Useful if you need to re-normalize waveform data.
 *
 * @param rawData Array of raw amplitude values
 * @returns Array of normalized values (0-1)
 */
export function normalizeAmplitudes(rawData: number[]): number[] {
  const max = Math.max(...rawData, 1); // Prevent division by zero
  return rawData.map(value => value / max);
}
