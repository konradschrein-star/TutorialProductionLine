import type { DrizzleClient } from "@repo/db";
import {
  startFinishedJobScanner,
  scannerOptionsFromEnv,
  type ScannerHandle,
} from "./finished-job-scanner.js";

export {
  startFinishedJobScanner,
  runScanOnce,
  pushJobArtifacts,
  scannerOptionsFromEnv,
  DEFAULT_SCANNER_OPTIONS,
  type ScannerOptions,
  type ScannerHandle,
} from "./finished-job-scanner.js";

/**
 * Single entry point for the storage subsystem.
 *
 * Safe to call unconditionally: when `STORAGE_DRIVE_ENABLED` is not `true`,
 * or credentials are missing, this logs the reason and returns an inert
 * handle. It never throws and never blocks startup.
 *
 * Wire it into the orchestrator with one line in `startWorker()`:
 *
 *   const storage = startStorageSubsystem(db);
 *
 * and one line in the shutdown path:
 *
 *   storage.stop();
 */
export function startStorageSubsystem(db: DrizzleClient): ScannerHandle {
  return startFinishedJobScanner(db, scannerOptionsFromEnv());
}
