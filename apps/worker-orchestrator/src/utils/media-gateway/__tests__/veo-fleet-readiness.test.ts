import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Health gating must be READINESS, not liveness.
 *
 * MEASURED 2026-08-05, the incident this file exists for. `GET /status`:
 *
 *   workers: {total:1, online:1, busy:1}
 *   capacity: {concurrent_max:12, concurrent_now:1}
 *   queue: {pending:35, processing:6, done:460, error:45}
 *   metrics.throughput: {done_1m:0, done_5m:0, done_1h:0}
 *   metrics.queue.oldest_pending_age_s: 12676
 *
 * One worker, online, heartbeating, `busy` — holding a single job it would
 * never finish. Nothing had completed in over three hours. The old gate asked
 * only `workers.online > 0`, so it read GREEN, and the gateway kept shovelling
 * work into a queue draining at zero jobs/minute. 74 branded thumbnails died
 * that way, each after burning its full 480s pending budget first.
 *
 * "A worker is online" is a claim about the fleet's liveness. "The fleet will
 * produce output" is a claim about its throughput. Only the second one is
 * worth routing on.
 */

process.env["VEO_FLEET_API_KEY"] = "test-key";
process.env["VEO_FLEET_API_URL"] = "http://fleet.test";
// Every read re-probes, so a test can drive a transition in one await.
process.env["VEO_FLEET_HEALTH_TTL_MS"] = "0";

const {
  veoFleetReadiness,
  veoFleetStalled,
  veoFleetHealthyCached,
  veoFleetHealthSnapshot,
  refreshVeoFleetHealth,
} = await import("../veo-fleet-client.js");

/** The live payload from the incident, verbatim. */
const WEDGED = {
  ok: true,
  version: "0.1.0",
  workers: { total: 1, online: 1, busy: 1 },
  capacity: { concurrent_max: 12, concurrent_now: 1 },
  queue: { pending: 35, processing: 6, done: 460, error: 45 },
  metrics: {
    throughput: { done_1m: 0, done_5m: 0, done_1h: 0, jobs_per_min: 0.0 },
    queue: {
      pending: 35,
      processing: 6,
      done: 460,
      error: 45,
      depth: 41,
      oldest_pending_age_s: 12676.709,
    },
  },
};

const DRAINING = {
  ok: true,
  workers: { total: 1, online: 1, busy: 1 },
  capacity: { concurrent_max: 12, concurrent_now: 4 },
  queue: { pending: 8, processing: 4, done: 500, error: 45 },
  metrics: {
    throughput: { done_1m: 2, done_5m: 9, done_1h: 60, jobs_per_min: 1.8 },
    queue: { oldest_pending_age_s: 40 },
  },
};

describe("veoFleetReadiness — the throughput fallback", () => {
  it("REJECTS the wedged fleet that passed the old workers.online gate", () => {
    const r = veoFleetReadiness(WEDGED);
    expect(r.ready).toBe(false);
    expect(r.source).toBe("throughput");
    // The reason has to be actionable on its own: it lands in the rejection
    // that a human reads at 3am.
    expect(r.reason).toMatch(/35/);
    expect(r.reason).toMatch(/nothing completed|no completions/i);
  });

  it("accepts a fleet that is draining", () => {
    expect(veoFleetReadiness(DRAINING).ready).toBe(true);
  });

  it("accepts a legitimately idle fleet (empty queue, zero throughput)", () => {
    // Zero completions with nothing queued is not a stall, it is quiet.
    const idle = {
      ok: true,
      workers: { total: 1, online: 1, busy: 0 },
      queue: { pending: 0, processing: 0, done: 460, error: 45 },
      metrics: {
        throughput: { done_1m: 0, done_5m: 0, done_1h: 0 },
        queue: { oldest_pending_age_s: null },
      },
    };
    expect(veoFleetReadiness(idle).ready).toBe(true);
  });

  it("does not call a young queue stalled — one generation takes minutes", () => {
    const young = {
      ...WEDGED,
      metrics: {
        throughput: { done_1m: 0, done_5m: 0, done_1h: 0 },
        queue: { oldest_pending_age_s: 30 },
      },
    };
    expect(veoFleetReadiness(young).ready).toBe(true);
  });

  it("keeps the old rules: no workers online, and ok:false", () => {
    expect(
      veoFleetReadiness({ ok: true, workers: { total: 1, online: 0 } }).ready,
    ).toBe(false);
    expect(
      veoFleetReadiness({ ok: false, workers: { total: 1, online: 1 } }).ready,
    ).toBe(false);
  });

  it("will not declare a stall without evidence of one", () => {
    // oldest_pending_age_s absent = we cannot tell how long it has waited.
    // A false 'stalled' strands real work on a chain with no alternative,
    // so an unmeasurable queue keeps the benefit of the doubt.
    const unmeasurable = {
      ok: true,
      workers: { online: 1 },
      queue: { pending: 35 },
      metrics: { throughput: { done_1m: 0, done_5m: 0 } },
    };
    expect(veoFleetReadiness(unmeasurable).ready).toBe(true);
  });

  it("honours VEO_FLEET_STALL_S", () => {
    const eleven = {
      ...WEDGED,
      metrics: {
        throughput: { done_1m: 0, done_5m: 0, done_1h: 0 },
        queue: { oldest_pending_age_s: 660 },
      },
    };
    expect(veoFleetReadiness(eleven).ready).toBe(false); // default 600
    process.env["VEO_FLEET_STALL_S"] = "1200";
    try {
      expect(veoFleetReadiness(eleven).ready).toBe(true);
    } finally {
      delete process.env["VEO_FLEET_STALL_S"];
    }
  });
});

describe("veoFleetReadiness — an explicit readiness field wins", () => {
  it("believes ready:false even while throughput looks fine", () => {
    const r = veoFleetReadiness({
      ...DRAINING,
      ready: false,
      ready_reason: "all workers are quarantined pending re-auth",
    });
    expect(r.ready).toBe(false);
    expect(r.source).toBe("explicit");
    expect(r.reason).toContain("quarantined");
  });

  it("believes ready:true even while the queue looks wedged", () => {
    // The orchestrator knows things /status metrics cannot express — e.g. a
    // long single generation that is genuinely progressing.
    const r = veoFleetReadiness({ ...WEDGED, ready: true });
    expect(r.ready).toBe(true);
    expect(r.source).toBe("explicit");
  });

  it("reads the field under metrics too, and not_ready_reason", () => {
    const r = veoFleetReadiness({
      ...DRAINING,
      metrics: {
        ...DRAINING.metrics,
        ready: false,
        not_ready_reason: "bridge wedged",
      },
    });
    expect(r.ready).toBe(false);
    expect(r.reason).toContain("bridge wedged");
  });

  it("reads the orchestrator's real readiness block (live shape, 2026-08-05)", () => {
    // Captured verbatim from http://127.0.0.1:8091/status during the incident,
    // after the fleet grew an honest readiness verdict of its own.
    const live = {
      ...WEDGED,
      ready: false,
      readiness: {
        ready: false,
        reasons: ["queue_stalled"],
        checks: {
          workers_online: 1,
          pending: 41,
          processing: 0,
          done_5m: 0,
          oldest_pending_age_s: 13219.749,
          stall_age_s: 900,
        },
      },
    };
    const r = veoFleetReadiness(live);
    expect(r.ready).toBe(false);
    expect(r.source).toBe("explicit");
    // The orchestrator's own words, not a shrug.
    expect(r.reason).toContain("queue_stalled");
    // Its evidence too — the numbers are what make the alert actionable.
    expect(r.reason).toMatch(/41/);
    expect(r.reason).toMatch(/13220|13219/);
  });

  it("believes readiness.ready:true", () => {
    const r = veoFleetReadiness({
      ...WEDGED,
      readiness: { ready: true, reasons: [] },
    });
    expect(r.ready).toBe(true);
    expect(r.source).toBe("explicit");
  });

  it("falls back to throughput when the field is absent or not a boolean", () => {
    expect(veoFleetReadiness({ ...WEDGED, ready: undefined }).source).toBe(
      "throughput",
    );
    expect(
      veoFleetReadiness({ ...WEDGED, ready: "yes" as unknown as boolean })
        .source,
    ).toBe("throughput");
  });
});

describe("the cached gate the gateway actually routes on", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function serve(body: unknown, ok = true) {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/bridge/clients")) {
        return new Response(
          JSON.stringify({
            workers: [{ status: "online", assigned_apis: 3, capacity_max: 12 }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(body), { status: ok ? 200 : 503 });
    });
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes red on a wedged fleet and says why", async () => {
    serve(DRAINING);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(true);
    expect(veoFleetStalled()).toBe(false);

    serve(WEDGED);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(false);
    // Stalled is distinct from unreachable: it is a MEASURED verdict, and
    // routing is allowed to act on it more decisively than on a failed probe.
    expect(veoFleetStalled()).toBe(true);
    expect(veoFleetHealthSnapshot().lastError).toMatch(/nothing completed/i);
  });

  it("a definite stall verdict is NOT softened by the two-strike rule", async () => {
    serve(DRAINING);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(true);

    // Two strikes exists to absorb a transport blip — a probe we could not
    // complete. This probe completed and returned a definite negative. If the
    // strike counter softened it, the wedged fleet would stay green for
    // another full TTL and keep taking work.
    serve(WEDGED);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(false);
  });

  it("still forgives ONE failed probe (transport blip, not a verdict)", async () => {
    serve(DRAINING);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(true);

    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(true); // strike 1
    expect(veoFleetStalled()).toBe(false); // unreachable is not stalled
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(false); // strike 2
  });

  it("recovers when the fleet starts draining again", async () => {
    serve(WEDGED);
    await refreshVeoFleetHealth();
    expect(veoFleetStalled()).toBe(true);

    serve(DRAINING);
    await refreshVeoFleetHealth();
    expect(veoFleetHealthyCached()).toBe(true);
    expect(veoFleetStalled()).toBe(false);
  });
});
