import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the gateway must DO once it knows the primary is wedged.
 *
 * On 2026-08-05 veo_fleet had completed nothing for hours while reporting one
 * online worker. Every one of the 74 thumbnails it killed shows
 * `fallback_used = false` in the database: failover never engaged even once,
 * because the health gate never went red, so the primary was still the
 * happiest hop in the chain.
 *
 * Two behaviours are load-bearing here:
 *
 *  1. VIDEO must fall to veoforge. There is a real alternative, and it was
 *     sitting there with 7 healthy accounts the whole time.
 *  2. A branded 2-reference IMAGE has NO alternative — vup carries 1 ref,
 *     forge carries 0, veoforge images are off. So the honest outcome is an
 *     immediate, legible rejection, NOT a submit that burns 480s in a queue
 *     that is not moving. Failing fast is the fix; inventing a backend is not.
 */

process.env["VEO_FLEET_API_KEY"] = "fleet-key";
process.env["VEOFORGE_API_KEY"] = "veoforge-key";
process.env["VUP_API_KEY"] = "vup-key";
process.env["FORGE_API_KEY"] = "forge-key";
process.env["AI33_API_KEY"] = "";

const fleet = {
  healthy: false,
  stalled: true,
  submitImage: vi.fn(async () => ["job_x"]),
  submitVideo: vi.fn(async () => ["job_x"]),
  upload: vi.fn(async () => "file_x"),
};

vi.mock("../veo-fleet-client.js", () => ({
  veoFleetConfigured: () => true,
  veoFleetHealthyCached: () => fleet.healthy,
  veoFleetStalled: () => fleet.stalled,
  veoFleetHealthSnapshot: () => ({
    healthy: fleet.healthy,
    checkedAt: Date.now(),
    workersOnline: 1,
    concurrentMax: 12,
    effectiveConcurrency: 3,
    concurrentNow: 1,
    queuePending: 35,
    ready: fleet.healthy,
    readyReason: fleet.stalled
      ? "35 job(s) queued and nothing completed in the last 5 min (oldest has waited 12676s)"
      : "draining",
    lastError: fleet.stalled
      ? "35 job(s) queued and nothing completed in the last 5 min (oldest has waited 12676s)"
      : null,
  }),
  veoFleetEffectiveConcurrency: () => 3,
  submitVeoFleetImage: fleet.submitImage,
  submitVeoFleetVideo: fleet.submitVideo,
  uploadVeoFleetImage: fleet.upload,
  waitForVeoFleetJob: vi.fn(async () => ["file_x"]),
  downloadVeoFleetFile: vi.fn(),
  downloadVeoFleetFileBuffer: vi.fn(),
}));

const veoforge = {
  submitVideo: vi.fn(async () => "vf_job"),
  submitImage: vi.fn(async () => "vf_job"),
};

vi.mock("../veoforge-client.js", () => ({
  veoforgeConfigured: () => true,
  veoforgeHealthyCached: () => true,
  veoforgeImagesEnabled: () => false, // as in production today
  veoforgeHealthSnapshot: () => ({ healthy: true, checkedAt: Date.now() }),
  submitVeoForgeImage: veoforge.submitImage,
  submitVeoForgeVideo: veoforge.submitVideo,
  waitForVeoForgeJob: vi.fn(async () => ["https://veoforge.test/out.mp4"]),
  downloadVeoForgeFile: vi.fn(),
  downloadVeoForgeFileBuffer: vi.fn(),
}));

const vup = { submitImage: vi.fn(async () => "vup_job") };

vi.mock("../vup-client.js", () => ({
  vupConfigured: () => true,
  vupHealthyCached: () => true,
  submitVupImage: vup.submitImage,
  submitVupVideo: vi.fn(),
  submitVupImageToVideo: vi.fn(),
  waitForVupJob: vi.fn(async () => ["https://vup.test/out.png"]),
  downloadVupFile: vi.fn(),
  downloadVupFileBuffer: vi.fn(),
}));

vi.mock("../forge-client.js", () => ({
  forgeConfigured: () => true,
  forgeHealthyCached: () => true,
  submitForgeImage: vi.fn(async () => "forge_job"),
  submitForgeVideo: vi.fn(),
  submitForgeImageToVideo: vi.fn(),
  uploadForgeInput: vi.fn(),
  waitForForgeJob: vi.fn(async () => ["forge_file"]),
  downloadForgeMedia: vi.fn(),
  downloadForgeMediaBuffer: vi.fn(),
}));

vi.mock("../../spend-reporter.js", () => ({
  reportSpend: vi.fn(),
  estimateImageCostEur: () => 0,
  estimateVideoCostEur: () => 0,
}));

vi.mock("../registry-bridge.js", () => ({
  isBackendBlocked: () => false,
  blockReason: () => null,
  reportProviderUse: vi.fn(),
}));

const { requestVideoFromText, requestImage } = await import("../index.js");

beforeEach(() => {
  fleet.healthy = false;
  fleet.stalled = true;
  vi.clearAllMocks();
});

describe("a stalled veo_fleet must not swallow the work", () => {
  it("VIDEO falls over to veoforge instead of queueing behind a wedge", async () => {
    const ref = await requestVideoFromText("a cat", {
      format: "TUTORIAL_STUDIO",
      context: "test:video",
    });
    expect(ref).toContain("veoforge");
    expect(veoforge.submitVideo).toHaveBeenCalledTimes(1);
    expect(fleet.submitVideo).not.toHaveBeenCalled();
  });

  it("a 2-reference branded IMAGE rejects instead of submitting into the wedge", async () => {
    // This is the exact shape of the thumbnails that died: channel template +
    // host character. Nothing else in the chain can carry two references.
    await expect(
      requestImage("branded thumbnail", {
        format: "TUTORIAL_STUDIO",
        context: "test:thumb",
        referenceImages: [
          "data:image/png;base64,AA==",
          "data:image/png;base64,BB==",
        ],
      }),
    ).rejects.toThrow(/no backend can serve/i);

    // The point of the whole exercise: not one more job into a queue that is
    // not draining. 480s per job, 74 jobs, all of it avoidable.
    expect(fleet.submitImage).not.toHaveBeenCalled();
    expect(fleet.upload).not.toHaveBeenCalled();
  });

  it("the rejection names every backend and why each was ruled out", async () => {
    const err = await requestImage("branded thumbnail", {
      format: "TUTORIAL_STUDIO",
      context: "test:thumb",
      referenceImages: [
        "data:image/png;base64,AA==",
        "data:image/png;base64,BB==",
      ],
    }).catch((e: Error) => e);

    const msg = (err as Error).message;
    expect(msg).toContain("veo_fleet");
    // Not "health probe not green" — that tells an operator nothing. The
    // measured reason has to survive all the way into the rejection.
    expect(msg).toMatch(/nothing completed|queued/i);
    expect(msg).toContain("Refusing to substitute placeholder media");
  });

  it("a 1-reference image still falls through to vup — the chain is intact", async () => {
    const ref = await requestImage("one ref", {
      format: "TUTORIAL_STUDIO",
      context: "test:img1",
      referenceImages: ["data:image/png;base64,AA=="],
    });
    expect(ref).toContain("vup");
    expect(vup.submitImage).toHaveBeenCalledTimes(1);
    expect(fleet.submitImage).not.toHaveBeenCalled();
  });

  it("once the fleet drains again it goes straight back to primary", async () => {
    fleet.healthy = true;
    fleet.stalled = false;
    const ref = await requestImage("branded thumbnail", {
      format: "TUTORIAL_STUDIO",
      context: "test:thumb",
      referenceImages: [
        "data:image/png;base64,AA==",
        "data:image/png;base64,BB==",
      ],
    });
    expect(ref).toContain("fleet:");
    expect(fleet.submitImage).toHaveBeenCalledTimes(1);
  });

  it("an unreachable fleet still gets the last-resort attempt (unproven ≠ measured)", async () => {
    // Pass 3 exists so a stale-unhealthy probe cannot strand a live backend.
    // That must survive: only a MEASURED stall is decisive enough to skip.
    fleet.healthy = false;
    fleet.stalled = false;
    const ref = await requestImage("branded thumbnail", {
      format: "TUTORIAL_STUDIO",
      context: "test:thumb",
      referenceImages: [
        "data:image/png;base64,AA==",
        "data:image/png;base64,BB==",
      ],
    });
    expect(ref).toContain("fleet:");
  });
});
