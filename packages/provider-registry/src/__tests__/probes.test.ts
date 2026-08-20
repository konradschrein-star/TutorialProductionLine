import { afterEach, describe, expect, it, vi } from "vitest";
import { baseUrlFor, keyPresent, runProbe } from "../probes.js";
import { BUILT_IN_PROVIDERS, PROVIDERS_BY_KEY } from "../catalog.js";
import type { ProviderDefinition } from "../types.js";

function def(over: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    key: "test",
    displayName: "Test",
    vendor: "test",
    description: "",
    capabilities: ["image"],
    keyEnvVar: "TEST_API_KEY",
    defaultBaseUrl: "https://example.test",
    costTier: "cheap",
    planState: "active",
    defaultMaxConcurrent: 1,
    probe: { kind: "http", path: "/ping", method: "GET", auth: "bearer" },
    usedBy: [],
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keyPresent", () => {
  it("is false for an unset or blank credential", () => {
    expect(keyPresent(def(), {})).toBe(false);
    expect(keyPresent(def(), { TEST_API_KEY: "   " })).toBe(false);
  });

  it("is true for a set credential", () => {
    expect(keyPresent(def(), { TEST_API_KEY: "abc" })).toBe(true);
  });

  it("is true when the provider needs no credential at all", () => {
    expect(keyPresent(def({ keyEnvVar: null }), {})).toBe(true);
  });
});

describe("baseUrlFor", () => {
  it("prefers the env override and strips trailing slashes", () => {
    const d = def({ urlEnvVar: "TEST_URL" });
    expect(baseUrlFor(d, { TEST_URL: "https://other.test///" })).toBe(
      "https://other.test",
    );
  });

  it("falls back to the catalog default", () => {
    expect(baseUrlFor(def({ urlEnvVar: "TEST_URL" }), {})).toBe(
      "https://example.test",
    );
  });
});

describe("runProbe", () => {
  const env = { TEST_API_KEY: "secret" };

  it("never calls an expired provider — an expired 200 is not health", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runProbe(
      def({ planState: "expired", planNote: "licence over" }),
      env,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("expired");
    expect(result.error).toBe("licence over");
  });

  it("treats a past planExpiresAt as expired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runProbe(
      def({ planExpiresAt: "2026-07-21" }),
      env,
      new Date("2026-07-28T00:00:00Z"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("expired");
  });

  it("reports no_key without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runProbe(def(), {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("no_key");
    expect(result.error).toContain("TEST_API_KEY");
  });

  it("reports unknown with a reason when no probe is defined", async () => {
    const result = await runProbe(
      def({ probe: null, probeUnavailableReason: "it is a CLI binary" }),
      env,
    );
    expect(result.status).toBe("unknown");
    expect(result.error).toBe("it is a CLI binary");
    expect(result.latencyMs).toBeNull();
  });

  it("returns up and measures latency on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const result = await runProbe(def(), env);
    expect(result.status).toBe("up");
    expect(result.httpStatus).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns down on a non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const result = await runProbe(def(), env);
    expect(result.status).toBe("down");
    expect(result.error).toBe("HTTP 500");
  });

  it("honours okStatuses so a 401 can still prove reachability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    const d = def({
      probe: { kind: "http", path: "/ping", okStatuses: [401] },
    });
    expect((await runProbe(d, env)).status).toBe("up");
  });

  it("returns down, not a thrown error, on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await runProbe(def(), env);
    expect(result.status).toBe("down");
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("extracts a detail payload and survives a broken extractor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ credits: 42 }))),
    );
    const good = await runProbe(
      def({
        probe: {
          kind: "http",
          path: "/c",
          extractDetail: (b) => ({
            credits: (b as { credits: number }).credits,
          }),
        },
      }),
      env,
    );
    expect(good.detail).toEqual({ credits: 42 });

    const bad = await runProbe(
      def({
        probe: {
          kind: "http",
          path: "/c",
          extractDetail: () => {
            throw new Error("boom");
          },
        },
      }),
      env,
    );
    expect(bad.detail).toBeNull();
    expect(bad.status).toBe("up");
  });

  it("sends the credential in the shape the provider expects", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await runProbe(
      def({ probe: { kind: "http", path: "/x", auth: "raw" } }),
      env,
    );
    const rawHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<
      string,
      string
    >;
    expect(rawHeaders["Authorization"]).toBe("secret");

    await runProbe(
      def({ probe: { kind: "http", path: "/x", auth: "header:x-api-key" } }),
      env,
    );
    const custom = fetchMock.mock.calls[1]![1]!.headers as Record<
      string,
      string
    >;
    expect(custom["x-api-key"]).toBe("secret");
  });

  it("reports unknown when no base URL can be resolved", async () => {
    const result = await runProbe(
      def({ defaultBaseUrl: null, urlEnvVar: "MISSING_URL" }),
      env,
    );
    expect(result.status).toBe("unknown");
    expect(result.error).toContain("No base URL");
  });
});

describe("catalog integrity", () => {
  it("has unique provider keys", () => {
    const keys = BUILT_IN_PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("explains every un-probeable provider instead of leaving it mysterious", () => {
    const unexplained = BUILT_IN_PROVIDERS.filter(
      (p) => p.probe === null && !p.probeUnavailableReason,
    );
    expect(unexplained.map((p) => p.key)).toEqual([]);
  });

  it("keeps fastgen marked expired — regression guard for the Seedream incident", () => {
    const fastgen = PROVIDERS_BY_KEY.get("fastgen");
    expect(fastgen?.planState).toBe("expired");
    expect(fastgen?.planExpiresAt).toBe("2026-07-21");
  });

  it("never records a credential value, only an env var name", () => {
    for (const p of BUILT_IN_PROVIDERS) {
      if (p.keyEnvVar === null) continue;
      // Env var names are SCREAMING_SNAKE; a real secret would not be.
      expect(p.keyEnvVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
