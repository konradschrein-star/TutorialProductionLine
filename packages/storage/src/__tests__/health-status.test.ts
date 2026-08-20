import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDriveHealth } from "../health.js";

/**
 * The distinction these tests defend: "switched off" and "switched on but
 * broken" MUST NOT look the same.
 *
 * Both used to collapse into `enabled: false` + a reason string, so a Drive
 * that someone had deliberately enabled and which was silently uploading
 * nothing rendered identically to one that was intentionally off. That is how
 * this subsystem reached production having never moved a single byte.
 */

/** Minimal stand-in for the drizzle client; health only reads aggregates. */
function fakeDb(rows: {
  byState?: Array<{ state: string; count: number }>;
  lastUploadedAt?: Date | null;
}) {
  const chain = (result: unknown[]) => {
    const self: Record<string, unknown> = {};
    for (const m of ["from", "where", "groupBy", "orderBy", "limit"]) {
      self[m] = () => self;
    }
    // Awaiting the builder resolves to the rows.
    self["then"] = (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return self;
  };

  let call = 0;
  return {
    select: (fields?: Record<string, unknown>) => {
      call += 1;
      // 1: artifactsByState, 2: lastSuccessfulUpload, 3: lastError,
      // 4: daily usage. Order follows the Promise.all in getDriveHealth.
      if (fields !== undefined && "state" in fields && "count" in fields) {
        return chain(rows.byState ?? []);
      }
      if (fields !== undefined && "uploaded_at" in fields) {
        return chain(
          rows.lastUploadedAt != null
            ? [{ uploaded_at: rows.lastUploadedAt }]
            : [],
        );
      }
      return chain([]);
    },
    __calls: () => call,
  } as never;
}

const ENV_KEYS = [
  "STORAGE_DRIVE_ENABLED",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_CLIENT_SECRET_FILE",
  "GOOGLE_DRIVE_REFRESH_TOKEN_FILE",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fullCredentials(): void {
  process.env["STORAGE_DRIVE_ENABLED"] = "true";
  process.env["GOOGLE_DRIVE_CLIENT_ID"] = "cid";
  process.env["GOOGLE_DRIVE_CLIENT_SECRET"] = "csecret";
  process.env["GOOGLE_DRIVE_REFRESH_TOKEN"] = "rtoken";
}

describe("getDriveHealth — status", () => {
  it("reports 'off' when the subsystem is deliberately switched off", async () => {
    const h = await getDriveHealth(fakeDb({}));
    expect(h.status).toBe("off");
    expect(h.switchedOn).toBe(false);
    expect(h.configured).toBe(false);
  });

  it("reports 'misconfigured' when switched ON with no credentials", async () => {
    // THE case that hid for weeks: enabled, unusable, silent.
    process.env["STORAGE_DRIVE_ENABLED"] = "true";
    const h = await getDriveHealth(fakeDb({}));
    expect(h.status).toBe("misconfigured");
    expect(h.switchedOn).toBe(true);
    expect(h.configured).toBe(false);
    expect(h.reason).toContain("refresh token");
  });

  it("distinguishes 'off' from 'misconfigured' — they must never collapse", async () => {
    const off = await getDriveHealth(fakeDb({}));
    process.env["STORAGE_DRIVE_ENABLED"] = "true";
    const broken = await getDriveHealth(fakeDb({}));

    expect(off.enabled).toBe(broken.enabled); // both false — the old signal
    expect(off.status).not.toBe(broken.status); // the new one discriminates
  });

  it("reports 'idle' when configured but nothing has ever been uploaded", async () => {
    fullCredentials();
    const h = await getDriveHealth(fakeDb({ lastUploadedAt: null }));
    expect(h.status).toBe("idle");
    expect(h.neverUploaded).toBe(true);
    expect(h.configured).toBe(true);
  });

  it("reports 'ok' once at least one artefact has landed", async () => {
    fullCredentials();
    const h = await getDriveHealth(
      fakeDb({ lastUploadedAt: new Date("2026-08-01T00:00:00Z") }),
    );
    expect(h.status).toBe("ok");
    expect(h.neverUploaded).toBe(false);
    expect(h.lastSuccessfulUploadAt).toBe("2026-08-01T00:00:00.000Z");
  });
});
