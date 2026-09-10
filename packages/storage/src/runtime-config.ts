import { eq } from "drizzle-orm";
import { getSecret, systemSettings, type DrizzleClient } from "@repo/db";
import {
  loadStorageConfig,
  type StorageConfigResult,
  type StorageEnv,
} from "./config.js";

type StoredDriveSettings = {
  driveEnabled?: unknown;
  driveRootFolderName?: unknown;
  driveTutorialsFolderName?: unknown;
  driveRequestsPerSecond?: unknown;
  driveBatchSize?: unknown;
  driveScanIntervalMinutes?: unknown;
  driveLookbackDays?: unknown;
  driveMaxAttempts?: unknown;
  driveDailyBudgetGb?: unknown;
};

function setText(env: StorageEnv, name: string, value: unknown): void {
  if (typeof value === "string" && value.trim()) env[name] = value.trim();
}

function setNumber(
  env: StorageEnv,
  name: string,
  value: unknown,
  multiplier = 1,
): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    env[name] = String(Math.floor(value * multiplier));
  }
}

/**
 * Resolve Drive from the operator-facing database settings and encrypted secret
 * store, with .env retained only as a bootstrap fallback. Nothing is copied into
 * process.env, and secret values never leave this server-side boundary.
 */
export async function loadStorageConfigFromDatabase(
  db: DrizzleClient | Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0],
): Promise<StorageConfigResult> {
  const env: StorageEnv = { ...process.env };
  let row: { storage: unknown } | undefined;
  try {
    [row] = await db
      .select({ storage: systemSettings.storage })
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"))
      .limit(1);
  } catch {
    // Older deployments and lightweight test doubles may not have this column.
    // Environment configuration remains a supported bootstrap fallback.
  }
  const stored = (
    row?.storage && typeof row.storage === "object" ? row.storage : {}
  ) as StoredDriveSettings;

  if (typeof stored.driveEnabled === "boolean")
    env["STORAGE_DRIVE_ENABLED"] = String(stored.driveEnabled);
  setText(env, "GOOGLE_DRIVE_ROOT_FOLDER_NAME", stored.driveRootFolderName);
  setText(
    env,
    "GOOGLE_DRIVE_TUTORIALS_FOLDER_NAME",
    stored.driveTutorialsFolderName,
  );
  setNumber(env, "STORAGE_DRIVE_RPS", stored.driveRequestsPerSecond);
  setNumber(env, "STORAGE_SCAN_BATCH", stored.driveBatchSize);
  setNumber(
    env,
    "STORAGE_SCAN_INTERVAL_MS",
    stored.driveScanIntervalMinutes,
    60_000,
  );
  setNumber(env, "STORAGE_SCAN_LOOKBACK_DAYS", stored.driveLookbackDays);
  setNumber(env, "STORAGE_DRIVE_MAX_ATTEMPTS", stored.driveMaxAttempts);
  setNumber(
    env,
    "STORAGE_DRIVE_DAILY_BYTE_BUDGET",
    stored.driveDailyBudgetGb,
    1024 ** 3,
  );

  for (const name of [
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ] as const) {
    try {
      // getSecret only selects rows; the transaction exposes that same surface.
      // Keep these reads pinned instead of falling back to a global pool.
      env[name] = await getSecret(db as DrizzleClient, name);
    } catch {
      // loadStorageConfig provides one complete, non-secret diagnostic listing
      // missing fields. Absence here is therefore expected and not swallowed.
    }
  }
  return loadStorageConfig(env);
}
