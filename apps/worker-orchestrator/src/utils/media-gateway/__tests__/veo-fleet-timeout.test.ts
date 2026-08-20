import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The generation budget must measure GENERATION, not queueing.
 *
 * The owner's rule, verbatim: "If they are just queued, the time doesn't count,
 * only if they're actively being generated."
 *
 * This matters because the fleet coalesces jobs by reference image, and every
 * branded thumbnail carries a unique archetype + character pair — so they
 * cannot batch and run strictly one at a time. Under the old wall-clock
 * budget, a batch of 30 failed almost entirely: each job's timer started at
 * submission, so by the time job #20 was picked up it had already spent its
 * budget waiting, and died mid-render with "did not complete within 600s
 * (last status: processing)". It was failed for being twentieth.
 *
 * These tests drive the real poll loop against a scripted fleet.
 */

const POLL_MS = 20;

// Must be set before the module is imported — the intervals are read at load.
process.env["VEO_FLEET_POLL_INTERVAL_MS"] = String(POLL_MS);
process.env["VEO_FLEET_PENDING_STALL_MS"] = String(POLL_MS * 5);
process.env["VEO_FLEET_URL"] = "http://fleet.test";
process.env["VEO_FLEET_API_KEY"] = "test-key";

const { waitForVeoFleetJob } = await import("../veo-fleet-client.js");

/** Scripted status sequence; the last entry repeats once exhausted. */
function fleetReturning(statuses: string[], queuePending = 5) {
  let i = 0;
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/status")) {
      return new Response(
        JSON.stringify({
          workers: { online: 1, total: 1 },
          // Saturated on purpose: no spare capacity, so "is the queue
          // draining?" is the only progress signal left.
          capacity: { concurrent_max: 1, concurrent_now: 1 },
          queue: { pending: queuePending },
        }),
        { status: 200 },
      );
    }
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response(
      JSON.stringify({
        id: "job_test",
        type: "image",
        status,
        outputs: status === "done" ? [{ file_id: "f1", name: "out.png" }] : [],
        attempts: 1,
      }),
      { status: 200 },
    );
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("waitForVeoFleetJob — queue time is not generation time", () => {
  it("does not spend the budget while merely queued", async () => {
    // The real scenario: a long queue that IS draining (job #20 of 30 waiting
    // its turn behind genuine work), then a short burst of generation. Under
    // wall-clock accounting the queue wait alone exhausted the budget and this
    // threw "did not complete within Ns (last status: processing)".
    const statuses = [...Array<string>(40).fill("pending"), "processing", "done"];
    let i = 0;
    let doneCount = 100; // the fleet is completing other people's jobs
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/status")) {
          doneCount += 1; // unambiguous progress
          return new Response(
            JSON.stringify({
              workers: { online: 1, total: 1 },
              capacity: { concurrent_max: 1, concurrent_now: 1 },
              queue: { pending: 5, done: doneCount },
            }),
            { status: 200 },
          );
        }
        const status = statuses[Math.min(i, statuses.length - 1)];
        i += 1;
        return new Response(
          JSON.stringify({
            id: "job_test",
            status,
            outputs:
              status === "done" ? [{ file_id: "f1", name: "out.png" }] : [],
          }),
          { status: 200 },
        );
      }),
    );

    const ids = await waitForVeoFleetJob("job_test", {
      timeoutMs: POLL_MS * 4, // tiny budget — only generation may consume it
    });
    expect(ids).toEqual(["f1"]);
  });

  it("fails on generation that genuinely overruns, and says queue time is excluded", async () => {
    vi.stubGlobal("fetch", fleetReturning(["processing"], 5));

    await expect(
      waitForVeoFleetJob("job_test", { timeoutMs: POLL_MS * 3 }),
    ).rejects.toThrow(/actively generating.*Queue time is excluded/s);
  });

  it("waits indefinitely while the queue ahead of it is draining", async () => {
    // Always pending, but `pending` falls on every probe: the fleet is working
    // through the queue and we are simply next in line.
    let pendingDepth = 500;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/status")) {
        pendingDepth -= 1; // draining
        return new Response(
          JSON.stringify({
            workers: { online: 1, total: 1 },
            capacity: { concurrent_max: 1, concurrent_now: 1 },
            queue: { pending: pendingDepth },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ id: "job_test", status: "pending", outputs: [] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Long enough to blow the stall budget many times over if draining were
    // (incorrectly) counted as stalled.
    const race = await Promise.race([
      waitForVeoFleetJob("job_test", { timeoutMs: POLL_MS * 2 }).then(
        () => "returned",
        (e: Error) => `threw: ${e.message}`,
      ),
      new Promise<string>((r) =>
        setTimeout(() => r("still waiting"), POLL_MS * 25),
      ),
    ]);
    expect(race).toBe("still waiting");
  });

  it("fails fast when the queue is frozen rather than long", async () => {
    // Pending forever AND the queue never moves AND capacity is saturated.
    vi.stubGlobal("fetch", fleetReturning(["pending"], 5));

    await expect(
      waitForVeoFleetJob("job_test", { timeoutMs: 60_000 }),
    ).rejects.toThrow(/frozen, not merely long/);
  });
});
