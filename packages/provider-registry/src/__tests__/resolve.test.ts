import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  describeFallback,
  effectivePriority,
  effectiveStatus,
  eligibleProviders,
  isUsable,
  primaryProvider,
  resolveChain,
  resolveConcurrency,
  DEFAULT_CONSUMER_PRIORITIES,
} from "../resolve.js";
import type {
  ChainLink,
  ConsumerPriority,
  HealthResult,
  ProviderDefinition,
  ProviderState,
} from "../types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function provider(
  key: string,
  over: Partial<ProviderDefinition> = {},
): ProviderDefinition {
  return {
    key,
    displayName: key,
    vendor: "test",
    description: "",
    capabilities: ["image"],
    keyEnvVar: `${key.toUpperCase()}_API_KEY`,
    costTier: "cheap",
    planState: "active",
    defaultMaxConcurrent: 4,
    probe: null,
    usedBy: [],
    ...over,
  };
}

function health(
  providerKey: string,
  status: HealthResult["status"],
): HealthResult {
  return {
    providerKey,
    status,
    latencyMs: 100,
    httpStatus: 200,
    detail: null,
    error: null,
    checkedAt: new Date().toISOString(),
  };
}

function link(
  providerKey: string,
  position: number,
  enabled = true,
  consumer: string | null = null,
): ChainLink {
  return { capability: "image", providerKey, position, enabled, consumer };
}

const ALL_KEYS_PRESENT = () => true;

// ── effectiveStatus ─────────────────────────────────────────────────────────

describe("effectiveStatus", () => {
  it("reports expired when the plan state says expired, even if the probe is green", () => {
    const status = effectiveStatus({
      definition: provider("fastgen", { planState: "expired" }),
      health: health("fastgen", "up"),
      keyPresent: true,
    });
    // This is the fastgen case: the endpoint may still answer 200 long after
    // the licence lapsed. Expiry must win, or we silently keep using it.
    expect(status).toBe("expired");
  });

  it("reports expired once planExpiresAt is in the past", () => {
    const status = effectiveStatus({
      definition: provider("fastgen", {
        planState: "active",
        planExpiresAt: "2026-07-21",
      }),
      health: health("fastgen", "up"),
      keyPresent: true,
      now: new Date("2026-07-28T00:00:00Z"),
    });
    expect(status).toBe("expired");
  });

  it("does not report expired before the expiry date", () => {
    const status = effectiveStatus({
      definition: provider("trial", {
        planState: "trial",
        planExpiresAt: "2026-08-30",
      }),
      health: health("trial", "up"),
      keyPresent: true,
      now: new Date("2026-07-28T00:00:00Z"),
    });
    expect(status).toBe("up");
  });

  it("expiry outranks an operator disable", () => {
    const state: ProviderState = {
      key: "fastgen",
      enabled: false,
      maxConcurrent: null,
      planState: "expired",
      planExpiresAt: null,
      costTier: "cheap",
      notes: null,
    };
    expect(
      effectiveStatus({
        definition: provider("fastgen"),
        state,
        keyPresent: true,
      }),
    ).toBe("expired");
  });

  it("reports disabled when the operator switched it off", () => {
    const state: ProviderState = {
      key: "vup",
      enabled: false,
      maxConcurrent: null,
      planState: "active",
      planExpiresAt: null,
      costTier: "free",
      notes: null,
    };
    expect(
      effectiveStatus({
        definition: provider("vup"),
        state,
        health: health("vup", "up"),
        keyPresent: true,
      }),
    ).toBe("disabled");
  });

  it("reports no_key when the credential env var is missing", () => {
    expect(
      effectiveStatus({
        definition: provider("vup"),
        health: health("vup", "up"),
        keyPresent: false,
      }),
    ).toBe("no_key");
  });

  it("treats a provider that needs no credential as keyed", () => {
    expect(
      effectiveStatus({
        definition: provider("ollama", { keyEnvVar: null }),
        health: health("ollama", "up"),
        keyPresent: false,
      }),
    ).toBe("up");
  });

  it("reports unknown — never green — when there is no probe result", () => {
    expect(
      effectiveStatus({ definition: provider("r2"), keyPresent: true }),
    ).toBe("unknown");
  });

  it("passes the probe verdict through when nothing overrides it", () => {
    expect(
      effectiveStatus({
        definition: provider("forge"),
        health: health("forge", "down"),
        keyPresent: true,
      }),
    ).toBe("down");
  });
});

describe("isUsable", () => {
  it("allows up, degraded and unknown", () => {
    expect(isUsable("up")).toBe(true);
    expect(isUsable("degraded")).toBe(true);
    // Unknown must stay usable: refusing to dispatch to everything we cannot
    // probe would take the whole system down.
    expect(isUsable("unknown")).toBe(true);
  });

  it("blocks down, expired, disabled and no_key", () => {
    expect(isUsable("down")).toBe(false);
    expect(isUsable("expired")).toBe(false);
    expect(isUsable("disabled")).toBe(false);
    expect(isUsable("no_key")).toBe(false);
  });
});

// ── resolveChain ────────────────────────────────────────────────────────────

describe("resolveChain", () => {
  const providers = [
    provider("vup", { planState: "self_hosted" }),
    provider("forge", { planState: "self_hosted" }),
    provider("fastgen", { planState: "expired", planExpiresAt: "2026-07-21" }),
    provider("ai33"),
  ];

  const snapshot = {
    providers,
    states: {} as Record<string, ProviderState>,
    health: {
      vup: health("vup", "up"),
      forge: health("forge", "up"),
      fastgen: health("fastgen", "up"),
      ai33: health("ai33", "up"),
    },
    links: [
      link("vup", 1),
      link("forge", 2),
      link("fastgen", 3, false),
      link("ai33", 4, false),
    ],
  };

  it("orders the chain by position", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: ALL_KEYS_PRESENT,
    });
    expect(chain.map((c) => c.providerKey)).toEqual([
      "vup",
      "forge",
      "fastgen",
      "ai33",
    ]);
  });

  it("returns every hop including blocked ones, so the UI can render them", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: ALL_KEYS_PRESENT,
    });
    expect(chain).toHaveLength(4);
    expect(eligibleProviders(chain)).toEqual(["vup", "forge"]);
  });

  it("marks a switched-off link ineligible with an explicit reason", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: ALL_KEYS_PRESENT,
    });
    const ai33 = chain.find((c) => c.providerKey === "ai33")!;
    expect(ai33.eligible).toBe(false);
    expect(ai33.ineligibleReason).toBe("fallback link switched off");
  });

  it("marks an expired provider ineligible even when its link is enabled", () => {
    const withFastgenOn = {
      ...snapshot,
      links: [link("vup", 1), link("fastgen", 2, true)],
    };
    const chain = resolveChain(withFastgenOn, "image", null, {
      keyPresent: ALL_KEYS_PRESENT,
      now: new Date("2026-07-28T00:00:00Z"),
    });
    const fastgen = chain.find((c) => c.providerKey === "fastgen")!;
    expect(fastgen.status).toBe("expired");
    expect(fastgen.eligible).toBe(false);
    expect(fastgen.ineligibleReason).toBe("provider expired");
  });

  it("skips a provider whose key is missing", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: (k) => k !== "forge",
    });
    expect(eligibleProviders(chain)).toEqual(["vup"]);
  });

  it("lets a consumer override chain fully replace the global chain", () => {
    const withOverride = {
      ...snapshot,
      links: [
        ...snapshot.links,
        link("ai33", 1, true, "TUTORIAL_STUDIO"),
        link("vup", 2, true, "TUTORIAL_STUDIO"),
      ],
    };
    const chain = resolveChain(withOverride, "image", "TUTORIAL_STUDIO", {
      keyPresent: ALL_KEYS_PRESENT,
    });
    expect(chain.map((c) => c.providerKey)).toEqual(["ai33", "vup"]);
  });

  it("falls back to the global chain for a consumer with no override", () => {
    const chain = resolveChain(snapshot, "image", "CASUALLY_EXPLAINED", {
      keyPresent: ALL_KEYS_PRESENT,
    });
    expect(chain.map((c) => c.providerKey)).toEqual([
      "vup",
      "forge",
      "fastgen",
      "ai33",
    ]);
  });

  it("flags a link pointing at a provider missing from the catalog", () => {
    const orphan = { ...snapshot, links: [link("ghost-provider", 1)] };
    const chain = resolveChain(orphan, "image", null, {
      keyPresent: ALL_KEYS_PRESENT,
    });
    expect(chain[0]!.ineligibleReason).toBe("provider not in catalog");
  });

  it("primaryProvider returns the first ELIGIBLE hop, not merely the first", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: (k) => k !== "vup",
    });
    expect(primaryProvider(chain)).toBe("forge");
  });

  it("primaryProvider returns null when nothing is eligible", () => {
    const chain = resolveChain(snapshot, "image", null, {
      keyPresent: () => false,
    });
    expect(primaryProvider(chain)).toBeNull();
  });
});

// ── effectivePriority ───────────────────────────────────────────────────────

describe("effectivePriority", () => {
  const overrides: ConsumerPriority[] = [
    {
      consumer: "LONG_FORM_DRAMA",
      capability: null,
      priority: 10,
      maxConcurrent: null,
    },
    {
      consumer: "LONG_FORM_DRAMA",
      capability: "image",
      priority: 5,
      maxConcurrent: null,
    },
  ];

  it("keeps TUTORIAL_STUDIO highest by default", () => {
    const tutorial = effectivePriority([], "TUTORIAL_STUDIO", "image");
    const others = Object.entries(DEFAULT_CONSUMER_PRIORITIES)
      .filter(([k]) => k !== "TUTORIAL_STUDIO")
      .map(([, v]) => v);
    expect(Math.max(...others)).toBeLessThan(tutorial);
  });

  it("prefers a capability-specific override over a consumer-wide one", () => {
    expect(effectivePriority(overrides, "LONG_FORM_DRAMA", "image")).toBe(5);
  });

  it("uses the consumer-wide override for other capabilities", () => {
    expect(effectivePriority(overrides, "LONG_FORM_DRAMA", "tts")).toBe(10);
  });

  it("uses the consumer-wide override when no capability is given", () => {
    expect(effectivePriority(overrides, "LONG_FORM_DRAMA", null)).toBe(10);
  });

  it("falls back to the built-in default", () => {
    expect(effectivePriority([], "CASUALLY_EXPLAINED", "image")).toBe(100);
  });

  it("falls back to the floor for an unknown consumer", () => {
    expect(effectivePriority([], "SOMETHING_NEW", "image")).toBe(40);
  });
});

// ── resolveConcurrency ──────────────────────────────────────────────────────

describe("resolveConcurrency", () => {
  const def = provider("vup", { defaultMaxConcurrent: 4 });

  it("uses the catalog cap when the operator set none", () => {
    const d = resolveConcurrency({ definition: def, inFlight: 2 });
    expect(d).toMatchObject({ cap: 4, admit: true, source: "catalog" });
  });

  it("lets the operator cap win over the catalog", () => {
    const state: ProviderState = {
      key: "vup",
      enabled: true,
      maxConcurrent: 2,
      planState: "active",
      planExpiresAt: null,
      costTier: "free",
      notes: null,
    };
    const d = resolveConcurrency({ definition: def, state, inFlight: 2 });
    expect(d).toMatchObject({ cap: 2, admit: false, source: "operator" });
  });

  it("admits an operator cap of 0 for nothing", () => {
    const state: ProviderState = {
      key: "vup",
      enabled: true,
      maxConcurrent: 0,
      planState: "active",
      planExpiresAt: null,
      costTier: "free",
      notes: null,
    };
    const d = resolveConcurrency({ definition: def, state, inFlight: 0 });
    expect(d.cap).toBe(0);
    expect(d.admit).toBe(false);
  });

  it("treats a null cap as uncapped", () => {
    const d = resolveConcurrency({
      definition: provider("deepseek", { defaultMaxConcurrent: null }),
      inFlight: 999,
    });
    expect(d).toMatchObject({ cap: null, admit: true, source: "uncapped" });
  });

  it("refuses at exactly the cap, admits one below it", () => {
    expect(resolveConcurrency({ definition: def, inFlight: 3 }).admit).toBe(
      true,
    );
    expect(resolveConcurrency({ definition: def, inFlight: 4 }).admit).toBe(
      false,
    );
  });

  it("lets a per-consumer sub-cap restrict further but never loosen", () => {
    // Global pool has room (2 of 4) but this consumer already holds its share.
    const restricted = resolveConcurrency({
      definition: def,
      inFlight: 2,
      consumerCap: 1,
      consumerInFlight: 1,
    });
    expect(restricted.admit).toBe(false);
    // A consumer sub-cap cannot admit past a full global pool.
    const stillBlocked = resolveConcurrency({
      definition: def,
      inFlight: 4,
      consumerCap: 99,
      consumerInFlight: 0,
    });
    expect(stillBlocked.admit).toBe(false);
  });
});

// ── classifyOutcome — the Nano-Banana-2 → Seedream detector ─────────────────

describe("classifyOutcome", () => {
  it("does not flag the chain primary", () => {
    const v = classifyOutcome({
      chain: ["vup", "forge", "fastgen"],
      servedProvider: "vup",
    });
    expect(v).toMatchObject({
      isFallback: false,
      fallbackDepth: 0,
      requestedProvider: "vup",
      offChain: false,
    });
  });

  it("flags the first fallback hop with depth 1", () => {
    const v = classifyOutcome({
      chain: ["vup", "forge", "fastgen"],
      servedProvider: "forge",
    });
    expect(v).toMatchObject({
      isFallback: true,
      fallbackDepth: 1,
      requestedProvider: "vup",
      servedProvider: "forge",
      offChain: false,
    });
  });

  it("reports the depth of a deeper fallback", () => {
    const v = classifyOutcome({
      chain: ["vup", "forge", "fastgen"],
      servedProvider: "fastgen",
    });
    expect(v.fallbackDepth).toBe(2);
    expect(v.isFallback).toBe(true);
  });

  it("flags an off-chain provider loudly — the Seedream case", () => {
    // The request wanted Nano Banana 2 and something outside the modelled
    // chain served it. This is the exact silent-downgrade that shipped bad
    // thumbnails, and it must be louder than a normal fallback.
    const v = classifyOutcome({
      chain: ["nano-banana-2"],
      servedProvider: "seedream-4.5",
    });
    expect(v.isFallback).toBe(true);
    expect(v.offChain).toBe(true);
    expect(v.requestedProvider).toBe("nano-banana-2");
    expect(describeFallback(v)).toContain("OFF-CHAIN");
  });

  it("does not flag an explicitly pinned backend", () => {
    const v = classifyOutcome({
      chain: ["vup", "forge"],
      servedProvider: "forge",
      pinned: true,
    });
    expect(v.isFallback).toBe(false);
    expect(v.requestedProvider).toBe("forge");
  });

  it("still records off-chain-ness for a pin outside the chain", () => {
    const v = classifyOutcome({
      chain: ["vup"],
      servedProvider: "ai33",
      pinned: true,
    });
    expect(v.isFallback).toBe(false);
    expect(v.offChain).toBe(true);
  });

  it("handles an empty chain without pretending the primary was honoured", () => {
    const v = classifyOutcome({ chain: [], servedProvider: "fastgen" });
    expect(v.isFallback).toBe(true);
    expect(v.offChain).toBe(true);
    expect(v.requestedProvider).toBeNull();
    expect(v.fallbackDepth).toBe(1);
  });

  it("describes a normal fallback in operator language", () => {
    const v = classifyOutcome({
      chain: ["vup", "forge"],
      servedProvider: "forge",
    });
    expect(describeFallback(v)).toBe("wanted vup, got forge (fallback #1)");
  });

  it("describes a primary hit plainly", () => {
    const v = classifyOutcome({ chain: ["vup"], servedProvider: "vup" });
    expect(describeFallback(v)).toBe("served by vup (primary)");
  });
});
