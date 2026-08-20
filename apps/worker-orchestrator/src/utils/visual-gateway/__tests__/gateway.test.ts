/**
 * Gateway behaviour with fake adapters and an in-memory store.
 * No live API is contacted by any test in this file.
 */
import { describe, it, expect } from "vitest";
import { requestVisual, VisualSourcingError } from "../gateway.js";
import type { VisualProvider, VisualProviderAdapter } from "../types.js";
import {
  fakeAdapter,
  failingAdapter,
  makeCandidate,
  makeRequest,
  memoryStore,
  pngBytes,
  sha256,
} from "./fixtures.js";

function adapters(
  ...list: VisualProviderAdapter[]
): Partial<Record<VisualProvider, VisualProviderAdapter>> {
  const map: Partial<Record<VisualProvider, VisualProviderAdapter>> = {};
  for (const adapter of list) map[adapter.provider] = adapter;
  return map;
}

/** Every provider stubbed out, so nothing can reach the real network. */
function noNetwork(): Partial<Record<VisualProvider, VisualProviderAdapter>> {
  return adapters(
    fakeAdapter("generated", []),
    fakeAdapter("pexels", []),
    fakeAdapter("wikimedia", []),
    fakeAdapter("google", []),
    fakeAdapter("web", []),
  );
}

describe("requestVisual — happy path", () => {
  it("stores the winner and returns a complete VisualRef", async () => {
    const store = memoryStore();
    const bytes = pngBytes(1920, 1080);
    const result = await requestVisual(makeRequest(), {
      store,
      adapters: {
        ...noNetwork(),
        ...adapters(
          fakeAdapter("pexels", [
            makeCandidate({
              bytes,
              provenance: { sourceUrl: "https://www.pexels.com/photo/1/" },
            }),
          ]),
        ),
      },
    });

    expect(result.visual.provider).toBe("pexels");
    expect(result.visual.licence).toBe("Pexels License");
    expect(result.visual.sourceUrl).toBe("https://www.pexels.com/photo/1/");
    expect(result.visual.retrievedAt).toBe("2026-08-15T10:00:00.000Z");
    expect(result.visual.assetKey).toContain(sha256(bytes));
    expect(result.posture).toBe("publishable");
    expect(result.reviewReason).toBeNull();
    expect(result.deduplicated).toBe(false);
    expect(store.saves).toBe(1);
  });

  it("measures the real bytes rather than trusting the declared size", async () => {
    const store = memoryStore();
    const result = await requestVisual(makeRequest({ minWidth: 800 }), {
      store,
      adapters: {
        ...noNetwork(),
        ...adapters(
          fakeAdapter("pexels", [
            // Declares 6000px (the original upload) but serves a 1600px file.
            makeCandidate({
              bytes: pngBytes(1600, 900),
              provenance: { width: 6000, height: 4000 },
            }),
          ]),
        ),
      },
    });
    expect(result.provenance.width).toBe(1600);
    expect(result.provenance.height).toBe(900);
  });

  it("rejects a downloaded file that is narrower than minWidth", async () => {
    const store = memoryStore();
    // `format: "OTHER"` declares no essential providers, which isolates this
    // test to the width floor. Under the default BUSINESS_PLAN_HUB the stubbed
    // `generated` adapter returning [] trips the essential-provider gate first
    // — correct behaviour, asserted in essential-providers.test.ts, but it
    // would mask the assertion this test is actually making.
    await expect(
      requestVisual(makeRequest({ minWidth: 1920, format: "OTHER" }), {
        store,
        adapters: {
          ...noNetwork(),
          ...adapters(
            fakeAdapter("pexels", [
              makeCandidate({
                bytes: pngBytes(1000, 700),
                provenance: { width: 4000, height: 3000 },
              }),
            ]),
          ),
        },
      }),
    ).rejects.toThrow(VisualSourcingError);
    expect(store.saves).toBe(0);
  });
});

describe("requestVisual — provider order and failover", () => {
  it("falls through to the next provider when one throws", async () => {
    const store = memoryStore();
    const down = failingAdapter("pexels", "pexels 503");
    const backup = fakeAdapter("generated", [
      makeCandidate({
        provenance: {
          provider: "generated",
          sourceUrl: "mediagateway:fleet:xyz",
          licence: "generated:in-house",
        },
      }),
    ]);

    const result = await requestVisual(makeRequest({ intent: "broll" }), {
      store,
      adapters: { ...noNetwork(), ...adapters(down, backup) },
    });

    expect(down.calls).toBe(1);
    expect(result.visual.provider).toBe("generated");
    expect(result.rejected.some((a) => a.provider === "pexels")).toBe(true);
  });

  it("does not consult later providers once one succeeds", async () => {
    const store = memoryStore();
    const wikimedia = fakeAdapter("wikimedia", [
      makeCandidate({
        provenance: {
          provider: "wikimedia",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Form.png",
          licence: "Public domain",
        },
      }),
    ]);
    const search = fakeAdapter("google", [makeCandidate()]);

    await requestVisual(makeRequest({ intent: "document" }), {
      store,
      adapters: { ...noNetwork(), ...adapters(wikimedia, search) },
    });

    expect(wikimedia.calls).toBe(1);
    expect(search.calls).toBe(0);
  });
});

describe("requestVisual — provenance is fail-closed", () => {
  it("discards a candidate with no licence instead of patching one in", async () => {
    const store = memoryStore();
    let fetched = 0;
    await expect(
      requestVisual(makeRequest({ providerOrder: ["pexels"] }), {
        store,
        adapters: adapters(
          fakeAdapter("pexels", [
            makeCandidate({
              provenance: { licence: "" },
              onFetch: () => {
                fetched += 1;
              },
            }),
          ]),
        ),
      }),
    ).rejects.toThrow(VisualSourcingError);

    expect(fetched).toBe(0); // never even downloaded
    expect(store.saves).toBe(0);
  });

  it("names the query and every provider tried in the failure", async () => {
    const store = memoryStore();
    let error: unknown;
    try {
      await requestVisual(
        makeRequest({
          query: "SBA 7(a) authorisation page",
          providerOrder: ["wikimedia", "google", "web"],
        }),
        {
          store,
          adapters: adapters(
            fakeAdapter("wikimedia", []),
            failingAdapter("google", "search engine blocked us"),
            fakeAdapter("web", [
              makeCandidate({ provenance: { sourceUrl: "" } }),
            ]),
          ),
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VisualSourcingError);
    const message = (error as Error).message;
    expect(message).toContain("SBA 7(a) authorisation page");
    expect(message).toContain("wikimedia");
    expect(message).toContain("search engine blocked us");
    expect(message).toContain("web");
    expect(message).toContain("No placeholder is substituted");
  });

  it("never returns a result when nothing is usable", async () => {
    const store = memoryStore();
    const call = requestVisual(makeRequest({ providerOrder: ["pexels"] }), {
      store,
      adapters: adapters(fakeAdapter("pexels", [])),
    });
    await expect(call).rejects.toBeInstanceOf(VisualSourcingError);
  });

  it("rejects an invalid request without contacting any provider", async () => {
    const adapter = fakeAdapter("pexels", [makeCandidate()]);
    await expect(
      requestVisual(makeRequest({ query: "" }), {
        store: memoryStore(),
        adapters: adapters(adapter),
      }),
    ).rejects.toThrow(/invalid VisualRequest/);
    expect(adapter.calls).toBe(0);
  });
});

describe("requestVisual — licence posture", () => {
  it("flags an image-search result for QC instead of publishing it silently", async () => {
    const store = memoryStore();
    const result = await requestVisual(
      makeRequest({ intent: "long-tail", providerOrder: ["google"] }),
      {
        store,
        adapters: adapters(
          fakeAdapter("google", [
            makeCandidate({
              provenance: {
                provider: "google",
                sourceUrl: "https://example.com/form.png",
                licence: "unknown",
              },
            }),
          ]),
        ),
      },
    );

    expect(result.posture).toBe("needs-review");
    expect(result.reviewReason).toContain("authoritative");
    expect(result.visual.licence).toBe("unknown");
  });

  it("refuses a needs-review asset when the caller demands publishable only", async () => {
    const store = memoryStore();
    await expect(
      requestVisual(
        makeRequest({ providerOrder: ["web"], allowNeedsReview: false }),
        {
          store,
          adapters: adapters(
            fakeAdapter("web", [
              makeCandidate({
                provenance: {
                  provider: "web",
                  sourceUrl: "https://sba.gov/form.png",
                  licence: "unknown",
                },
              }),
            ]),
          ),
        },
      ),
    ).rejects.toThrow(VisualSourcingError);
  });

  it("prefers a publishable candidate over a wider needs-review one", async () => {
    const store = memoryStore();
    const result = await requestVisual(
      makeRequest({ minWidth: 100, providerOrder: ["pexels"] }),
      {
        store,
        adapters: adapters(
          fakeAdapter("pexels", [
            makeCandidate({
              bytes: pngBytes(4000, 3000),
              provenance: {
                provider: "pexels",
                licence: "CC BY-NC 4.0", // non-commercial → needs-review
                sourceUrl: "https://www.pexels.com/photo/nc/",
                width: 4000,
                height: 3000,
              },
            }),
            makeCandidate({
              bytes: pngBytes(1280, 720),
              provenance: {
                sourceUrl: "https://www.pexels.com/photo/ok/",
                width: 1280,
                height: 720,
              },
            }),
          ]),
        ),
      },
    );
    expect(result.visual.sourceUrl).toBe("https://www.pexels.com/photo/ok/");
    expect(result.posture).toBe("publishable");
  });
});

describe("requestVisual — deduplication", () => {
  it("serves a known sourceUrl from the library without downloading again", async () => {
    const store = memoryStore();
    let fetches = 0;
    const build = () =>
      fakeAdapter("pexels", [
        makeCandidate({
          provenance: { sourceUrl: "https://www.pexels.com/photo/shared/" },
          onFetch: () => {
            fetches += 1;
          },
        }),
      ]);

    const first = await requestVisual(makeRequest(), {
      store,
      adapters: adapters(build()),
    });
    const second = await requestVisual(makeRequest(), {
      store,
      adapters: adapters(build()),
    });

    expect(fetches).toBe(1);
    expect(store.saves).toBe(1);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.visual.assetKey).toBe(first.visual.assetKey);
  });

  it("deduplicates identical bytes arriving under a different URL", async () => {
    const store = memoryStore();
    const bytes = pngBytes(1920, 1080);

    const first = await requestVisual(makeRequest(), {
      store,
      adapters: adapters(
        fakeAdapter("pexels", [
          makeCandidate({
            bytes,
            provenance: { sourceUrl: "https://www.pexels.com/photo/a/" },
          }),
        ]),
      ),
    });

    const second = await requestVisual(makeRequest(), {
      store,
      adapters: adapters(
        fakeAdapter("pexels", [
          makeCandidate({
            bytes,
            provenance: { sourceUrl: "https://www.pexels.com/photo/b/" },
          }),
        ]),
      ),
    });

    expect(store.saves).toBe(1);
    expect(second.deduplicated).toBe(true);
    expect(second.contentHash).toBe(first.contentHash);
    // First provenance wins — the asset is not rewritten by the second sighting.
    expect(second.visual.sourceUrl).toBe("https://www.pexels.com/photo/a/");
  });
});
