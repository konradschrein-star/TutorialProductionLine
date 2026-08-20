/**
 * Generic database update function signature.
 * Allows progress tracker to work without depending on @repo/db.
 */
export type ProgressUpdateFn = (
  jobId: string,
  progress: number,
) => Promise<void>;

export interface ProgressTrackerConfig {
  updateProgress: ProgressUpdateFn;
  jobId: string;
  totalDurationSeconds: number;
  onProgress?: (percent: number, currentTime: number) => void;
}

/**
 * FFmpeg Progress Tracker
 *
 * Parses FFmpeg stderr output to extract render progress and updates
 * the database progress field every 10% of completion.
 *
 * Usage:
 * ```typescript
 * const tracker = new FFmpegProgressTracker({
 *   db,
 *   jobId,
 *   totalDurationSeconds: 120.5,
 * });
 *
 * proc.stderr.on('data', (data) => {
 *   tracker.parseAndUpdate(data.toString()).catch(console.error);
 * });
 * ```
 */
export class FFmpegProgressTracker {
  private lastReportedProgress = 0;
  private config: ProgressTrackerConfig;

  constructor(config: ProgressTrackerConfig) {
    this.config = config;
  }

  /**
   * Parse FFmpeg stderr line and update progress if threshold crossed.
   * Call this for every stderr data chunk.
   *
   * FFmpeg outputs progress info like:
   * frame=  123 fps= 30 q=28.0 size=    512kB time=00:00:04.10 bitrate=1024.0kbits/s speed=1.00x
   *
   * We extract the `time` field and convert to seconds.
   */
  async parseAndUpdate(stderrLine: string): Promise<void> {
    // Extract time from FFmpeg progress line: time=00:12:34.56
    const match = stderrLine.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (!match) return;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3]);
    const currentTimeSeconds = hours * 3600 + minutes * 60 + seconds;

    const percentComplete =
      (currentTimeSeconds / this.config.totalDurationSeconds) * 100;
    const roundedPercent = Math.min(Math.floor(percentComplete / 10) * 10, 100);

    // Only update if we've crossed a 10% threshold
    if (roundedPercent >= this.lastReportedProgress + 10) {
      try {
        await this.config.updateProgress(this.config.jobId, roundedPercent);

        console.log(
          JSON.stringify({
            level: "info",
            message: "FFmpeg render progress update",
            job_id: this.config.jobId,
            progress_percent: roundedPercent,
            current_time_seconds: currentTimeSeconds.toFixed(1),
            total_duration_seconds: this.config.totalDurationSeconds,
          }),
        );

        this.lastReportedProgress = roundedPercent;

        // Call optional callback
        if (this.config.onProgress) {
          this.config.onProgress(roundedPercent, currentTimeSeconds);
        }
      } catch (err) {
        // DO NOT fail render if progress update fails
        console.error(
          JSON.stringify({
            level: "error",
            message: "Failed to update render progress (non-fatal)",
            job_id: this.config.jobId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }
}
