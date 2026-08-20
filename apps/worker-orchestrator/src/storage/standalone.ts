/**
 * Standalone entry point for the storage subsystem — the Drive uploader.
 *
 * This is the SUPPORTED way to run the scanner. It is registered in
 * `ecosystem.config.js` as the `storage-drive-uploader` pm2 app:
 *
 *   pm2 start ecosystem.config.js --only storage-drive-uploader
 *
 * Or as a one-shot for testing / manual retries:
 *
 *   node apps/worker-orchestrator/dist/storage/standalone.js --once
 *
 * WHY ITS OWN PROCESS, not a line in the orchestrator's startWorker().
 * The scanner's isolation from the render pipeline is structural, not a
 * promise (see the header of ./finished-job-scanner.ts). Inside the
 * orchestrator that isolation is only as good as the code: this thing hashes
 * multi-GB videos twice (sha256 + md5) and streams them out over hours, so an
 * unhandled rejection, a memory spike into `max_memory_restart`, or a wedged
 * socket would take the orchestrator's queue consumers down with it. A
 * separate OS process makes "a Drive outage can never stall a render" a
 * property of the deployment rather than of this file staying careful.
 *
 * TWO BUGS THIS FILE EXISTS TO AVOID, both of which made the pm2 route fail
 * silently before:
 *
 *   1. `startFinishedJobScanner` calls `timer.unref()`. That is correct when it
 *      is embedded in the orchestrator (whose queue sockets hold the loop open)
 *      and fatal here: an unref'd interval is the ONLY handle in a standalone
 *      process, so node drains the loop and exits 0 seconds after boot. pm2
 *      would then "restart" a perfectly healthy app forever. This file runs its
 *      own REF'D loop instead.
 *
 *   2. When Drive is not configured, `startFinishedJobScanner` logs a line and
 *      returns an inert handle. In a standalone process that is also an
 *      immediate exit — the operator sees a restart counter climbing and no
 *      explanation. Here, an unconfigured Drive is a WAITING state: the process
 *      stays up, repeats the reason at a decreasing rate, and re-resolves the
 *      config on every pass. Dropping the refresh-token file into place is
 *      therefore enough to start uploading — no restart, no deploy.
 */
import "dotenv/config";
import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import { ArtifactStore } from "@repo/storage";
import { logger } from "@repo/logger";
import {
  runScanOnce,
  scannerOptionsFromEnv,
  type ScannerOptions,
} from "./finished-job-scanner.js";

/** How often to repeat a "still not configured" line. Quiet, but not silent. */
const UNCONFIGURED_LOG_EVERY_N_PASSES = 12;

interface LoopState {
  running: boolean;
  stopped: boolean;
  unconfiguredPasses: number;
}

/**
 * One pass, guarded. Resolves the ArtifactStore FRESH each time on purpose:
 * `loadStorageConfig()` re-reads the refresh-token file, so a Drive that was
 * unconfigured at boot starts working the moment the token lands.
 */
async function tick(
  db: DrizzleClient,
  opts: ScannerOptions,
  state: LoopState,
): Promise<void> {
  if (state.running || state.stopped) return;
  state.running = true;
  try {
    const created = ArtifactStore.create(db);
    if (!created.ok) {
      if (state.unconfiguredPasses % UNCONFIGURED_LOG_EVERY_N_PASSES === 0) {
        logger.warn(
          { reason: created.reason },
          "storage-standalone: Drive upload is NOT configured — nothing is " +
            "being uploaded. Fix the reason above; this process re-checks " +
            "every pass and needs no restart.",
        );
      }
      state.unconfiguredPasses += 1;
      return;
    }
    if (state.unconfiguredPasses > 0) {
      logger.info(
        { after_passes: state.unconfiguredPasses },
        "storage-standalone: Drive credentials became available; uploading",
      );
      state.unconfiguredPasses = 0;
    }
    await runScanOnce(db, created.store, opts);
  } catch (err) {
    // Contractually unreachable (runScanOnce swallows per-job failures) but a
    // standalone uploader must never die on an unexpected throw.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "storage-standalone: pass failed",
    );
  } finally {
    state.running = false;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    logger.error("storage-standalone: DATABASE_URL is not set");
    process.exit(1);
  }

  const db = createDrizzleClient(databaseUrl);
  const opts = scannerOptionsFromEnv();
  const once = process.argv.includes("--once");

  if (once) {
    const created = ArtifactStore.create(db);
    if (!created.ok) {
      // Exit non-zero: a one-shot run that uploaded nothing because it was
      // switched off should not look like success.
      logger.error(
        { reason: created.reason },
        "storage-standalone: Drive upload is not configured",
      );
      process.exit(2);
    }
    const totals = await runScanOnce(db, created.store, opts);
    logger.info(totals, "storage-standalone: one-shot scan complete");
    process.exit(totals.failed > 0 ? 1 : 0);
  }

  // LOUD BOOT DIAGNOSTIC. `STORAGE_DRIVE_ENABLED=true` with broken or absent
  // credentials is the exact shape of the bug that let this subsystem sit for
  // weeks having uploaded nothing while everyone believed it worked: it was
  // "enabled", it logged one info line, and it no-opped. Someone switching it
  // ON and getting nothing must see an ERROR at boot, not a debug line.
  const switchedOn = process.env["STORAGE_DRIVE_ENABLED"] === "true";
  const preflight = ArtifactStore.create(db);
  if (switchedOn && !preflight.ok) {
    logger.error(
      {
        reason: preflight.reason,
        runbook: "docs/runbooks/drive-authorize.md",
        check: "node scripts/drive-authorize.mjs --check",
      },
      "storage-standalone: STORAGE_DRIVE_ENABLED=true but Drive is NOT " +
        "usable. NOTHING WILL BE UPLOADED. This process stays up and " +
        "re-checks every pass — fix the reason and it recovers without a " +
        "restart.",
    );
  } else if (!switchedOn) {
    logger.warn(
      "storage-standalone: STORAGE_DRIVE_ENABLED is not 'true'. Drive upload " +
        "is off; this process will idle. Nothing will be uploaded.",
    );
  }

  const state: LoopState = {
    running: false,
    stopped: false,
    unconfiguredPasses: 0,
  };

  // REF'D deliberately — see the header. This interval is what keeps the
  // process alive; do not add .unref() to it.
  const timer = setInterval(() => void tick(db, opts, state), opts.intervalMs);

  logger.info(
    {
      interval_ms: opts.intervalMs,
      lookback_days: opts.lookbackDays,
      batch_size: opts.batchSize,
      media_root: opts.mediaRoot,
    },
    "storage-standalone: Drive uploader started",
  );

  void tick(db, opts, state);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "storage-standalone: shutting down");
    state.stopped = true;
    clearInterval(timer);
    // Give an in-flight pass a moment to unwind. A resumable upload survives a
    // hard kill anyway — the session URI is on the artefact row.
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    "storage-standalone: fatal",
  );
  process.exit(1);
});
