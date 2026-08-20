import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * VeoForge health must be READINESS from `GET /ready`, not a heuristic over
 * `/accounts`.
 *
 * MEASURED 2026-08-05, the reason this file exists. `GET /ready` → HTTP 503:
 *
 *   ok: true                    ← the process answered. That is all `ok` means.
 *   ready: false
 *   ready_reason: "no account can generate: 25 total, 0 healthy, 5 with an
 *                  EXPIRED session jar ... a human must re-export a
 *                  labs.google session"
 *   accounts_total: 25, accounts_healthy: 0, accounts_capacity: 0
 *
 * The old gate derived health from per-account `healthy`, which means only "no
 * active penalty window" — NOT "can generate". Observed drifting 0..7 across
 * the same outage while `accounts_capacity` stayed pinned at 0 and the service
 * could not produce a single frame. `accounts_capacity` (healthy AND holding an
 * unexpired session jar) is the field that answers the routing question.
 *
 * Two shapes this suite pins down, both live-observed:
 *
 *  1. `/ready` answers **503** when not ready. That is an ANSWER, not a
 *     transport failure — it must set health red immediately, not be softened
 *     by the two-strike blip rule.
 *  2. `accounts_sessions_expired` under-reports (5, not 23) because pre-fix
 *     optimistic values are still persisted. Nothing may be gated on it.
 */

process.env["VEOFORGE_API_KEY"] = "test-key";
process.env["VEOFORGE_API_URL"] = "http://veoforge.test";
// Every read re-probes, so a test can drive a transition in one await.
process.env["VEOFORGE_HEALTH_TTL_MS"] = "0";

const {
  veoforgeReadiness,
  veoforgeHealthyCached,
  veoforgeHealthSnapshot,
  refreshVeoForgeHealth,
} = await import("../veoforge-client.js");

/** The live payload from the outage, verbatim (served with HTTP 503). */
const DRY = {
  ok: true,
  ready: false,
  ready_reason:
    "no account can generate: 25 total, 0 healthy, 5 with an EXPIRED session jar, " +
    "0 never captured -- a human must re-export a labs.google session and run add_account.py",
  service: "veoforge",
  workers_configured: 16,
  active_sessions: 0,
  accounts_total: 25,
  accounts_healthy: 0,
  accounts_assignable: 0,
  accounts_capacity: 0,
  accounts_sessions_expired: 5,
  accounts_sessions_unknown: 0,
  queue_depth: 0,
  stalled: false,
  stall_threshold_s: 300,
  last_progress_age_s: 381,
  completed_last_hour: 0,
};

/** The same service with a freshly harvested pool (served with HTTP 200). */
const READY = {
  ok: true,
  ready: true,
  ready_reason: null,
  service: "veoforge",
  accounts_total: 25,
  accounts_healthy: 7,
  accounts_assignable: 7,
  accounts_capacity: 7,
  accounts_sessions_expired: 0,
  accounts_sessions_unknown: 0,
  queue_depth: 2,
  stalled: false,
  stall_threshold_s: 300,
  last_progress_age_s: 12,
  completed_last_hour: 9,
};

describe("veoforgeReadiness — the rule", () => {
  it("REJECTS the dry pool that the accounts_healthy heuristic passed", () => {
    const r = veoforgeReadiness(DRY);
    expect(r.ready).toBe(false);
    expect(r.source).toBe("explicit");
    // The reason has to be actionable on its own — it is what a human reads.
    expect(r.reason).toMatch(/re-export/);
    expect(r.reason).toMatch(/capacity=0/);
  });

  it("accepts a service with real capacity", () => {
    expect(veoforgeReadiness(READY).ready).toBe(true);
  });

  it("never gates on `ok` — liveness is not readiness", () => {
    // /health answers ok:true forever, including through the whole outage.
    expect(veoforgeReadiness({ ok: true, ready: false }).ready).toBe(false);
  });

  it("never gates on accounts_healthy — it means 'no penalty', not 'can generate'", () => {
    // Live: accounts_healthy drifted 0..7 while capacity stayed 0 and the
    // service could not produce anything at all.
    const misleading = {
      ok: true,
      accounts_total: 25,
      accounts_healthy: 7,
      accounts_assignable: 7,
      accounts_capacity: 0,
      accounts_sessions_expired: 5,
    };
    expect(veoforgeReadiness(misleading).ready).toBe(false);
  });

  it("falls back to accounts_capacity when `ready` is absent (older build)", () => {
    const older = { ok: true, accounts_total: 25, accounts_capacity: 3 };
    const r = veoforgeReadiness(older);
    expect(r.ready).toBe(true);
    expect(r.source).toBe("capacity");
  });

  it("falls back to throughput-free capacity even when `ready` is not a boolean", () => {
    const r = veoforgeReadiness({
      ...DRY,
      ready: "no" as unknown as boolean,
      accounts_capacity: 4,
    });
    expect(r.source).toBe("capacity");
    expect(r.ready).toBe(true);
  });

  it("is NOT ready when neither field is present — unknown is never green", () => {
    const r = veoforgeReadiness({ ok: true });
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/accounts_capacity/);
  });

  it("does not trust accounts_sessions_expired — it under-reports", () => {
    // Live: 5 reported against 23 actually expired, because pre-fix optimistic
    // values are still persisted. A gate reading it would have called this
    // service ready.
    const underReporting = {
      ok: true,
      accounts_total: 25,
      accounts_healthy: 20,
      accounts_capacity: 0,
      accounts_sessions_expired: 5,
    };
    expect(veoforgeReadiness(underReporting).ready).toBe(false);
  });
});

describe("the cached gate the gateway actually routes on", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function serve(body: unknown, status: number) {
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probes /ready, not /accounts and not /health", async () => {
    serve(READY, 200);
    await refreshVeoForgeHealth();
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/ready"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/accounts"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/health"))).toBe(false);
  });

  it("reads HTTP 503 as a verdict, not a transport error", async () => {
    serve(READY, 200);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true);

    serve(DRY, 503);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(false);
    expect(veoforgeHealthSnapshot().lastError).toMatch(/re-export/);
    expect(veoforgeHealthSnapshot().usableAccounts).toBe(0);
    expect(veoforgeHealthSnapshot().totalAccounts).toBe(25);
  });

  it("a definite not-ready verdict is NOT softened by the two-strike rule", async () => {
    serve(READY, 200);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true);

    // Two strikes exists to absorb a transport blip — a probe we could not
    // complete. This probe completed and returned a definite negative.
    serve(DRY, 503);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(false);
  });

  it("still forgives ONE failed probe (transport blip, not a verdict)", async () => {
    serve(READY, 200);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true);

    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true); // strike 1
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(false); // strike 2
  });

  it("treats an unexpected status (500, HTML error page) as a failed probe", async () => {
    serve(READY, 200);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true);

    fetchSpy.mockImplementation(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true); // strike 1 — a blip, not a verdict
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(false); // strike 2
  });

  it("recovers when a fresh session lands", async () => {
    serve(DRY, 503);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(false);

    serve(READY, 200);
    await refreshVeoForgeHealth();
    expect(veoforgeHealthyCached()).toBe(true);
    expect(veoforgeHealthSnapshot().usableAccounts).toBe(7);
  });
});
