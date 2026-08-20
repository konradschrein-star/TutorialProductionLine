/**
 * The essential-provider gate: the thing that refuses a render rather than
 * silently shipping a stock-photo video under a generated-imagery format.
 *
 * No live API is contacted by any test in this file — `probeImageChain` is the
 * only seam onto the media-gateway and it is mocked, so these assert routing
 * POLICY, not provider liveness.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const probeImageChain = vi.fn();
vi.mock("../media-gateway-port.js", () => ({
  probeImageChain: (...args: unknown[]) => probeImageChain(...args),
  generateImage: vi.fn(),
  downloadGeneratedBytes: vi.fn(),
}));

const {
  ESSENTIAL_VISUAL_PROVIDERS,
  EssentialVisualProviderError,
  essentialProvidersFor,
  isEssentialProvider,
  preflightEssentialVisualProviders,
  probeGeneratedBackends,
} = await import("../essential-providers.js");
const { requestVisual } = await import("../gateway.js");
const { fakeAdapter, failingAdapter, makeCandidate, makeRequest, memoryStore } =
  await import("./fixtures.js");
const { pngBytes } = await import("./fixtures.js");

const ALL_BACKENDS = ["veo_fleet", "veoforge", "vup", "forge", "fastgen", "ai33"];

/** Nothing routable at all — the exact shape of the 2026-08-16 outage. */
function nothingConfigured(): void {
  probeImageChain.mockResolvedValue({
    all: ALL_BACKENDS,
    chain: ["veo_fleet", "vup"],
    configured: [],
  });
}

/** AI33 enabled and keyed; every self-hosted backend dead. */
function onlyAi33(): void {
  probeImageChain.mockResolvedValue({
    all: ALL_BACKENDS,
    chain: ["veo_fleet", "vup", "ai33"],
    configured: ["ai33"],
  });
}

beforeEach(() => {
  probeImageChain.mockReset();
});

describe("the declaration", () => {
  it("declares generated essential for BUSINESS_PLAN_HUB", () => {
    expect(essentialProvidersFor("BUSINESS_PLAN_HUB")).toEqual(["generated"]);
    expect(isEssentialProvider("BUSINESS_PLAN_HUB", "generated")).toBe(true);
    expect(isEssentialProvider("BUSINESS_PLAN_HUB", "pexels")).toBe(false);
  });

  it("leaves formats that declare nothing completely unaffected", () => {
    expect(essentialProvidersFor("OTHER")).toEqual([]);
    expect(essentialProvidersFor("CASUALLY_EXPLAINED")).toEqual([]);
    expect(isEssentialProvider("OTHER", "generated")).toBe(false);
  });

  it("carries a rationale, so the diagnostic can explain itself", () => {
    const policy = ESSENTIAL_VISUAL_PROVIDERS["BUSINESS_PLAN_HUB"];
    expect(policy?.rationale).toContain("identity");
  });
});

describe("preflightEssentialVisualProviders", () => {
  it("REFUSES when no generation backend is configured", async () => {
    nothingConfigured();
    await expect(
      preflightEssentialVisualProviders({
        format: "BUSINESS_PLAN_HUB",
        refCount: 1,
      }),
    ).rejects.toThrow(EssentialVisualProviderError);
  });

  it("names every backend probed and why each one failed", async () => {
    nothingConfigured();
    const error = await preflightEssentialVisualProviders({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
    }).catch((e: unknown) => e as InstanceType<typeof EssentialVisualProviderError>);

    expect(error).toBeInstanceOf(EssentialVisualProviderError);
    for (const backend of ALL_BACKENDS) {
      expect(error.message).toContain(backend);
    }
    // A backend in the chain but keyless must be distinguishable from one that
    // was never offered — those are different fixes for the operator.
    expect(error.verdicts.find((v) => v.backend === "veo_fleet")?.reason).toContain(
      "NO CREDENTIALS",
    );
    expect(error.verdicts.find((v) => v.backend === "forge")?.reason).toContain(
      "not offered",
    );
    expect(error.verdicts.every((v) => !v.usable)).toBe(true);
  });

  it("says plainly that the render was refused for not looking like the format", async () => {
    nothingConfigured();
    const error = await preflightEssentialVisualProviders({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
    }).catch((e: unknown) => e as Error);

    expect(error.message).toContain("REFUSING TO RENDER");
    expect(error.message).toContain("NOT LOOK LIKE THE FORMAT");
    expect(error.message).toContain("DIFFERENT PRODUCT");
    // and it must tell the operator how to fix it
    expect(error.message).toContain("MEDIA_ALLOW_AI33_IMAGE=1");
  });

  it("PASSES when ai33 alone is routable and configured", async () => {
    onlyAi33();
    const report = await preflightEssentialVisualProviders({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
    });
    expect(report.usableBackends).toEqual(["ai33"]);
    expect(report.checked).toEqual(["generated"]);
  });

  it("passes trivially, and probes nothing, for a format with no declaration", async () => {
    nothingConfigured();
    const report = await preflightEssentialVisualProviders({
      format: "OTHER",
      refCount: 1,
    });
    expect(report.checked).toEqual([]);
    expect(probeImageChain).not.toHaveBeenCalled();
  });

  it("forwards refCount and aspect to the gateway rather than assuming them", async () => {
    onlyAi33();
    await preflightEssentialVisualProviders({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
      aspectRatio: "9:16",
    });
    expect(probeImageChain).toHaveBeenCalledWith({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
      aspectRatio: "9:16",
    });
  });
});

describe("probeGeneratedBackends", () => {
  it("reports a configured backend as usable", async () => {
    onlyAi33();
    const { verdicts, usable } = await probeGeneratedBackends({
      format: "BUSINESS_PLAN_HUB",
      refCount: 1,
    });
    expect(usable).toEqual(["ai33"]);
    expect(verdicts.find((v) => v.backend === "ai33")?.usable).toBe(true);
    expect(verdicts).toHaveLength(ALL_BACKENDS.length);
  });
});

describe("mid-run refusal (the second enforcement point)", () => {
  function adapterMap(list: ReturnType<typeof fakeAdapter>[]) {
    const map: Record<string, unknown> = {};
    for (const a of list) map[a.provider] = a;
    return map as never;
  }

  it("does NOT fall through from generated to stock when generation fails", async () => {
    nothingConfigured();
    const pexels = fakeAdapter("pexels", [
      makeCandidate({ bytes: pngBytes(1920, 1080) }),
    ]);
    const store = memoryStore();

    await expect(
      requestVisual(
        // prop-plate order is [generated, pexels]: generation leads, and stock
        // is the thing we must refuse to silently become.
        makeRequest({ intent: "prop-plate" }),
        {
          store,
          adapters: adapterMap([
            failingAdapter("generated", "every image backend is down"),
            pexels,
          ]),
        },
      ),
    ).rejects.toThrow(EssentialVisualProviderError);

    // The proof that this is not merely a renamed error: the stock provider was
    // never asked, and nothing was written to the library.
    expect(pexels.calls).toBe(0);
    expect(store.saves).toBe(0);
  });

  it("explains which providers the fallthrough would have used", async () => {
    nothingConfigured();
    const error = await requestVisual(makeRequest({ intent: "prop-plate" }), {
      store: memoryStore(),
      adapters: adapterMap([
        failingAdapter("generated", "every image backend is down"),
        fakeAdapter("pexels", [makeCandidate({ bytes: pngBytes(1920, 1080) })]),
      ]),
    }).catch((e: unknown) => e as Error);

    expect(error.message).toContain("pexels");
    expect(error.message).toContain("REFUSED");
    expect(error.message).toContain("every image backend is down");
  });

  it("still falls through normally for a format with no essential providers", async () => {
    const pexels = fakeAdapter("pexels", [
      makeCandidate({ bytes: pngBytes(1920, 1080) }),
    ]);
    const result = await requestVisual(
      makeRequest({ intent: "prop-plate", format: "OTHER" }),
      {
        store: memoryStore(),
        adapters: adapterMap([
          failingAdapter("generated", "backend down"),
          pexels,
        ]),
      },
    );
    expect(result.provenance.provider).toBe("pexels");
    expect(pexels.calls).toBe(1);
  });

  it("defaults an unspecified format to BUSINESS_PLAN_HUB, so the gate cannot be bypassed by omission", async () => {
    nothingConfigured();
    const req = makeRequest({ intent: "prop-plate" });
    expect(req.format).toBeUndefined();
    await expect(
      requestVisual(req, {
        store: memoryStore(),
        adapters: adapterMap([
          failingAdapter("generated", "backend down"),
          fakeAdapter("pexels", [
            makeCandidate({ bytes: pngBytes(1920, 1080) }),
          ]),
        ]),
      }),
    ).rejects.toThrow(EssentialVisualProviderError);
  });
});
