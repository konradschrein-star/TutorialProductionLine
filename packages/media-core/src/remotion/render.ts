import {
  openBrowser,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import os from "os";

// ─── Warm browser singleton ───────────────────────────────────────────────────
// One Chromium instance per process, reused across all render jobs.
// Eliminates ~15-30s of Chromium startup overhead on every job after the first.
// Calling warmRemotionBrowser() at worker startup populates this reference.
// If a render fails with the browser in a bad state, renderComposition() resets
// it so the next job auto-recovers with a fresh Chromium instance.

type HeadlessBrowser = Awaited<ReturnType<typeof openBrowser>>;
let _warmBrowser: HeadlessBrowser | null = null;

/**
 * Open a Chromium instance that will be reused across render jobs in this process.
 * Call once at worker startup — subsequent calls are no-ops if already open.
 */
export async function warmRemotionBrowser(): Promise<void> {
  if (_warmBrowser) return;
  console.log("[remotion] Opening warm Chromium instance...");
  // Use Google Chrome (not bundled Chromium) for H264 video support on Linux.
  // Chromium OSS builds lack proprietary H264 codec; Chrome includes it.
  const chromeExecutable = "/usr/bin/google-chrome";
  _warmBrowser = await openBrowser("chrome", {
    chromiumOptions: { disableWebSecurity: true },
    browserExecutable: chromeExecutable,
  });
  console.log("[remotion] Warm Chromium instance ready");
}

/**
 * Close the warm browser and release all resources.
 * Call during graceful worker shutdown.
 */
export async function shutdownRemotionBrowser(): Promise<void> {
  if (!_warmBrowser) return;
  console.log("[remotion] Closing warm Chromium instance...");
  try {
    await _warmBrowser.close({ silent: false });
  } catch (err) {
    console.warn("[remotion] Error closing warm browser (ignoring):", err);
  }
  _warmBrowser = null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Render Remotion Composition
 *
 * Key requirements (from Remotion docs):
 * 1. inputProps MUST be passed to BOTH selectComposition() AND renderMedia()
 * 2. publicDir overrides the bundle's public/ at render time for staticFile()
 * 3. Use OffthreadVideo (not Video) for SSR video playback
 */
export interface RenderCompositionParams {
  compositionId: string;
  inputProps: unknown;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  serveUrl: string;
  publicDir?: string;
  /** Timeout per frame in ms. Default: 120000 (2 minutes). */
  timeoutInMilliseconds?: number;
  /**
   * Explicit concurrency override (parallel Chromium tabs).
   * When omitted, concurrency is derived from REMOTION_CONCURRENCY env var or
   * cpu_count/2, then scaled by complexityHint.
   */
  concurrency?: number;
  /**
   * Hint about per-frame rendering cost. Used to scale concurrency:
   *   "light"    — image-only compositions (no live video decoding). Concurrency × 1.5.
   *                Use for EXPLAINER and other image-only formats.
   *   "standard" — avatar video compositions (default). Concurrency × 1.0.
   */
  complexityHint?: "light" | "standard";
}

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderComposition(
  params: RenderCompositionParams,
): Promise<void> {
  const concurrency = _computeConcurrency(params);

  console.log(`[remotion] Starting render: ${params.compositionId}`);
  console.log(`[remotion] Output: ${params.outputPath}`);
  console.log(
    `[remotion] Resolution: ${params.width}x${params.height} @ ${params.fps}fps`,
  );
  console.log(
    `[remotion] Duration: ${params.durationInFrames} frames | Concurrency: ${concurrency}${params.complexityHint === "light" ? " (light)" : ""}`,
  );
  if (params.publicDir) {
    console.log(`[remotion] Public dir: ${params.publicDir}`);
  }
  if (_warmBrowser) {
    console.log("[remotion] Using warm Chromium instance");
  }

  // CRITICAL: inputProps must be passed to selectComposition() — this is how
  // the composition receives its props. Without this, all props are undefined.
  const composition = await selectComposition({
    serveUrl: params.serveUrl,
    id: params.compositionId,
    inputProps: params.inputProps as Record<string, unknown>,
  });

  console.log(
    `[remotion] Composition found: ${composition.id} (${composition.width}x${composition.height})`,
  );

  // Watchdog: if no progress is reported for NO_PROGRESS_TIMEOUT_MS (90s),
  // the browser has likely died. Reject the render promise so BullMQ can retry
  // with a fresh Chromium instance instead of hanging forever.
  const NO_PROGRESS_TIMEOUT_MS = 90_000;
  let lastProgressAt = Date.now();
  let hangTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let watchdogReject: ((err: Error) => void) | null = null;

  function armWatchdog() {
    if (hangTimeoutId) clearTimeout(hangTimeoutId);
    hangTimeoutId = setTimeout(() => {
      const staleMs = Date.now() - lastProgressAt;
      watchdogReject?.(
        new Error(
          `[remotion] Render hang detected: no progress for ${Math.round(staleMs / 1000)}s — browser likely died`,
        ),
      );
    }, NO_PROGRESS_TIMEOUT_MS);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      watchdogReject = reject;
      armWatchdog();

      renderMedia({
        composition: {
          ...composition,
          durationInFrames: params.durationInFrames,
          fps: params.fps,
          width: params.width,
          height: params.height,
        },
        serveUrl: params.serveUrl,
        codec: "h264",
        audioCodec: "aac",
        enforceAudioTrack: true,
        inputProps: params.inputProps as Record<string, unknown>,
        outputLocation: params.outputPath,
        ...(params.publicDir ? { publicDir: params.publicDir } : {}),
        timeoutInMilliseconds: params.timeoutInMilliseconds ?? 120_000,
        concurrency,
        puppeteerInstance: _warmBrowser ?? undefined,
        chromiumOptions: {
          disableWebSecurity: true,
        },
        onProgress: ({ progress }: { progress: number }) => {
          lastProgressAt = Date.now();
          armWatchdog();
          const percent = (progress * 100).toFixed(1);
          console.log(`[remotion] Rendering: ${percent}%`);
        },
      })
        .then(() => resolve())
        .catch(reject)
        .finally(() => {
          if (hangTimeoutId) clearTimeout(hangTimeoutId);
        });
    });

    console.log(`[remotion] Render complete: ${params.outputPath}`);
  } catch (err) {
    // If the render failed while using the warm browser, the browser may be in
    // a bad state. Reset it so the next job opens a fresh Chromium instance.
    if (_warmBrowser) {
      console.warn(
        "[remotion] Render failed — resetting warm browser for recovery",
      );
      _warmBrowser.close({ silent: true }).catch(() => {});
      _warmBrowser = null;
    }
    console.error("[remotion] Render failed:", err);
    throw new Error(`Remotion render failed: ${err}`);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _computeConcurrency(params: RenderCompositionParams): number {
  if (params.concurrency != null) return params.concurrency;

  const base = (() => {
    const envVal = process.env["REMOTION_CONCURRENCY"];
    if (envVal) return Math.max(1, parseInt(envVal, 10));
    // Default: half of available threads per render.
    // On a 16-thread machine → 8 Chromium tabs per job.
    // The autoscaler uses the same formula so maxRenderWorkers = floor(16/8) = 2.
    return Math.max(1, Math.floor(os.cpus().length / 2));
  })();

  if (params.complexityHint === "light") {
    // Image-only compositions render faster per frame — use more tabs.
    return Math.max(1, Math.ceil(base * 1.5));
  }

  return base;
}
