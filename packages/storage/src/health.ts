import { desc, eq, sql } from "drizzle-orm";
import { storageArtifacts, type DrizzleClient } from "@repo/db";
import { ArtifactStore } from "./artifact-store.js";
import { loadStorageConfigFromDatabase } from "./runtime-config.js";
import { getUsageBytes } from "./daily-budget.js";

/**
 * Drive connection health — the clean seam the System Health page consumes.
 *
 * THIS workstream owns `getDriveHealth()` and the `/api/storage/drive/health`
 * endpoint. The System Health agent owns the catalogue entry and the card and
 * must not reach into storage internals — it reads this struct only.
 *
 * `consentPublishingStatus === "testing"` MUST render as a warning, not green:
 * a Testing-mode consent screen revokes the refresh token after 7 days (the
 * silent time-bomb, TRAP 2). We cannot detect the publishing status via the
 * API, so it is reported from an env hint the operator sets after flipping the
 * console switch.
 *
 * See `DriveStatus` below for the field a card should actually switch on.
 */

/**
 * A single field the System Health card can switch on. The distinction that
 * matters is `off` vs `misconfigured`: both used to collapse into
 * `enabled: false` with a reason string, so a Drive that was switched ON and
 * silently doing nothing looked exactly like a Drive that was deliberately
 * switched off. That collapse is why nobody noticed that zero bytes had ever
 * reached Drive (same shape of bug as feedback-health-unknown-vs-healthy).
 *
 *   off           STORAGE_DRIVE_ENABLED is not "true". Expected. Render grey.
 *   misconfigured Switched ON but credentials are missing/unreadable. NOTHING
 *                 is being uploaded and someone believes it is. Render RED.
 *   idle          Configured, but not one artefact has ever been uploaded.
 *                 Render AMBER — it is the state this subsystem sat in,
 *                 undetected, from the day it was built.
 *   ok            Configured and at least one artefact has landed.
 */
export type DriveStatus = "off" | "misconfigured" | "idle" | "ok";

export interface DriveHealth {
  configured: boolean;
  enabled: boolean;
  /**
   * Operator INTENT: `STORAGE_DRIVE_ENABLED === "true"`. Read this against
   * `configured` — `switchedOn && !configured` is the loud failure case.
   */
  switchedOn: boolean;
  status: DriveStatus;
  /** True when the ledger has never recorded a single successful upload. */
  neverUploaded: boolean;
  /** Why not, when not enabled/configured. */
  reason: string | null;
  /** null = not checked (e.g. probe not run). */
  tokenValid: boolean | null;
  consentPublishingStatus: "production" | "testing" | "unknown";
  quotaBytesTotal: number | null;
  quotaBytesUsed: number | null;
  dailyBudgetBytes: number;
  dailyBudgetUsedBytes: number;
  artifactsByState: Record<string, number>;
  lastSuccessfulUploadAt: string | null;
  lastError: { kind: string; message: string; at: string } | null;
  checkedAt: string;
}

function consentStatusFromEnv(): DriveHealth["consentPublishingStatus"] {
  const v = (process.env["GOOGLE_OAUTH_CONSENT_STATUS"] ?? "")
    .trim()
    .toLowerCase();
  if (v === "production" || v === "in_production" || v === "in production") {
    return "production";
  }
  if (v === "testing") return "testing";
  return "unknown";
}

async function artifactsByState(
  db: DrizzleClient,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      state: storageArtifacts.state,
      count: sql<number>`count(*)::int`,
    })
    .from(storageArtifacts)
    .groupBy(storageArtifacts.state);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = r.count;
  return out;
}

async function lastSuccessfulUpload(db: DrizzleClient): Promise<string | null> {
  const [row] = await db
    .select({ uploaded_at: storageArtifacts.uploaded_at })
    .from(storageArtifacts)
    .where(eq(storageArtifacts.state, "uploaded"))
    .orderBy(desc(storageArtifacts.uploaded_at))
    .limit(1);
  return row?.uploaded_at?.toISOString() ?? null;
}

async function lastError(db: DrizzleClient): Promise<DriveHealth["lastError"]> {
  const [row] = await db
    .select({
      error_kind: storageArtifacts.error_kind,
      error_message: storageArtifacts.error_message,
      last_attempt_at: storageArtifacts.last_attempt_at,
    })
    .from(storageArtifacts)
    .where(eq(storageArtifacts.state, "failed"))
    .orderBy(desc(storageArtifacts.last_attempt_at))
    .limit(1);
  if (row === undefined || row.error_kind === null) return null;
  return {
    kind: row.error_kind,
    message: row.error_message ?? "",
    at: row.last_attempt_at?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Health WITHOUT touching Drive — cheap, DB-only. Safe to call on every page
 * load. Reports config/enabled state and the artefact ledger.
 */
export async function getDriveHealth(db: DrizzleClient): Promise<DriveHealth> {
  const config = await loadStorageConfigFromDatabase(db);
  const now = new Date().toISOString();

  const [byState, lastUpload, err, usedBytes] = await Promise.all([
    artifactsByState(db).catch(() => ({})),
    lastSuccessfulUpload(db).catch(() => null),
    lastError(db).catch(() => null),
    getUsageBytes(db).catch(() => 0),
  ]);

  const dailyBudgetBytes = config.enabled
    ? config.drive.dailyByteBudget
    : 500 * 1024 * 1024 * 1024;

  const switchedOn = config.enabled || !config.reason.includes("not 'true'");
  const neverUploaded = lastUpload === null;
  const status: DriveStatus = !switchedOn
    ? "off"
    : !config.enabled
      ? "misconfigured"
      : neverUploaded
        ? "idle"
        : "ok";

  return {
    configured: config.enabled,
    enabled: config.enabled,
    switchedOn,
    status,
    neverUploaded,
    reason: config.enabled ? null : config.reason,
    tokenValid: null,
    consentPublishingStatus: consentStatusFromEnv(),
    quotaBytesTotal: null,
    quotaBytesUsed: null,
    dailyBudgetBytes,
    dailyBudgetUsedBytes: usedBytes,
    artifactsByState: byState,
    lastSuccessfulUploadAt: lastUpload,
    lastError: err,
    checkedAt: now,
  };
}

/**
 * Health WITH a live Drive probe: mints a token and reads the storage quota.
 * More expensive and can fail; use for an explicit "test connection" action,
 * not every render of the card.
 */
export async function probeDriveHealth(
  db: DrizzleClient,
): Promise<DriveHealth> {
  const base = await getDriveHealth(db);
  if (!base.enabled) return base;

  const created = await ArtifactStore.createFromDatabase(db);
  if (!created.ok) {
    return {
      ...base,
      tokenValid: false,
      status: "misconfigured",
      reason: created.reason,
    };
  }

  const about = await created.store.drive.getAbout();
  if (!about.ok) {
    // A rejected token is a MISCONFIGURATION, not an "idle" subsystem — this
    // is what a Testing-mode consent screen looks like on day 8.
    const authFailed = about.error.kind === "auth";
    return {
      ...base,
      tokenValid: authFailed ? false : base.tokenValid,
      ...(authFailed ? { status: "misconfigured" as const } : {}),
      lastError: {
        kind: about.error.kind,
        message: about.error.message,
        at: new Date().toISOString(),
      },
    };
  }

  return {
    ...base,
    tokenValid: true,
    quotaBytesTotal: about.value.limitBytes,
    quotaBytesUsed: about.value.usageBytes,
  };
}
