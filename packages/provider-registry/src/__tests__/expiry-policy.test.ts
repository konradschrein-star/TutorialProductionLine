import { describe, expect, it } from "vitest";
import {
  applyPolicy,
  effectiveStatus,
  expiryClockStatus,
  providerExpiryStatus,
  resolveChain,
  resolvePolicy,
} from "../resolve.js";
import type {
  CapabilityPolicy,
  ChainLink,
  ProviderDefinition,
  ProviderExpiry,
} from "../types.js";

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
    keyEnvVar: null,
    costTier: "free",
    planState: "active",
    defaultMaxConcurrent: null,
    probe: null,
    usedBy: [],
    ...over,
  };
}

function expiry(over: Partial<ProviderExpiry>): ProviderExpiry {
  return {
    providerKey: "fish",
    kind: "api_key",
    label: "key",
    expiresAt: null,
    source: "manual",
    warnDaysBefore: 14,
    lastVerifiedAt: null,
    evidence: null,
    note: null,
    ...over,
  };
}

const NOW = new Date("2026-07-28T00:00:00.000Z");
const day = (n: number) =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("expiryClockStatus", () => {
  it("null date is unknown, never ok", () => {
    expect(
      expiryClockStatus({ expiresAt: null, warnDaysBefore: 14 }, NOW),
    ).toBe("unknown");
  });
  it("past date is expired", () => {
    expect(
      expiryClockStatus({ expiresAt: day(-1), warnDaysBefore: 14 }, NOW),
    ).toBe("expired");
  });
  it("within warn window is expiring_soon", () => {
    expect(
      expiryClockStatus({ expiresAt: day(4), warnDaysBefore: 14 }, NOW),
    ).toBe("expiring_soon");
  });
  it("comfortably ahead is ok", () => {
    expect(
      expiryClockStatus({ expiresAt: day(90), warnDaysBefore: 14 }, NOW),
    ).toBe("ok");
  });
});

describe("providerExpiryStatus", () => {
  it("takes the worst clock across a provider", () => {
    const clocks = [
      expiry({ providerKey: "forge", expiresAt: day(90) }),
      expiry({ providerKey: "forge", expiresAt: day(-2) }),
    ];
    expect(providerExpiryStatus(clocks, "forge", NOW)).toBe("expired");
  });
});

describe("effectiveStatus + expiries", () => {
  it("an expired clock forces expired even with a green probe", () => {
    const def = provider("fish", { keyEnvVar: "FISH_API_KEY" });
    const status = effectiveStatus({
      definition: def,
      keyPresent: true,
      health: {
        providerKey: "fish",
        status: "up",
        latencyMs: 10,
        httpStatus: 200,
        detail: null,
        error: null,
        checkedAt: NOW.toISOString(),
      },
      expiries: [expiry({ providerKey: "fish", expiresAt: day(-1) })],
      now: NOW,
    });
    expect(status).toBe("expired");
  });
  it("expiring_soon does NOT block — stays up", () => {
    const def = provider("fish", { keyEnvVar: "FISH_API_KEY" });
    const status = effectiveStatus({
      definition: def,
      keyPresent: true,
      health: {
        providerKey: "fish",
        status: "up",
        latencyMs: 10,
        httpStatus: 200,
        detail: null,
        error: null,
        checkedAt: NOW.toISOString(),
      },
      expiries: [expiry({ providerKey: "fish", expiresAt: day(3) })],
      now: NOW,
    });
    expect(status).toBe("up");
  });
});

describe("note-only + production-forbidden in resolveChain", () => {
  const providers = [
    provider("edge_tts", { productionForbidden: true }),
    provider("openai", { role: "note" }),
    provider("fish"),
  ];
  const links: ChainLink[] = [
    {
      capability: "tts",
      providerKey: "edge_tts",
      position: 1,
      enabled: true,
      consumer: null,
    },
    {
      capability: "tts",
      providerKey: "openai",
      position: 2,
      enabled: true,
      consumer: null,
    },
    {
      capability: "tts",
      providerKey: "fish",
      position: 3,
      enabled: true,
      consumer: null,
    },
  ];
  const snapshot = { providers, links, states: {}, health: {} };

  it("note is never eligible, forbidden is never primary", () => {
    const chain = resolveChain(snapshot, "tts", null, {
      keyPresent: () => true,
      now: NOW,
    });
    const byKey = Object.fromEntries(chain.map((e) => [e.providerKey, e]));
    expect(byKey["edge_tts"]?.eligible).toBe(false);
    expect(byKey["edge_tts"]?.ineligibleReason).toContain("primary");
    expect(byKey["openai"]?.eligible).toBe(false);
    expect(byKey["openai"]?.ineligibleReason).toContain("note");
    expect(byKey["fish"]?.eligible).toBe(true);
  });
});

describe("applyPolicy — fail instead of degrading", () => {
  const providers = [provider("vup"), provider("forge")];
  const links: ChainLink[] = [
    {
      capability: "image",
      providerKey: "vup",
      position: 1,
      enabled: true,
      consumer: null,
    },
    {
      capability: "image",
      providerKey: "forge",
      position: 2,
      enabled: true,
      consumer: null,
    },
  ];

  function chainWith(vupStatus: "up" | "down") {
    const health =
      vupStatus === "down"
        ? {
            vup: {
              providerKey: "vup",
              status: "down" as const,
              latencyMs: null,
              httpStatus: null,
              detail: null,
              error: "boom",
              checkedAt: NOW.toISOString(),
            },
          }
        : {};
    return resolveChain(
      { providers, links, states: {}, health },
      "image",
      null,
      { keyPresent: () => true, now: NOW },
    );
  }

  const strict: CapabilityPolicy = {
    capability: "image",
    consumer: null,
    strict: true,
    maxFallbackDepth: null,
    requireAck: false,
  };
  const permissive: CapabilityPolicy = { ...strict, strict: false };

  it("strict blocks with the chain in the reason when primary is down", () => {
    const res = applyPolicy(chainWith("down"), strict);
    expect(res.order).toEqual([]);
    expect(res.blockedReason).toContain("vup=down");
    expect(res.blockedReason).toContain("strict policy");
  });
  it("permissive falls back to forge when primary is down", () => {
    const res = applyPolicy(chainWith("down"), permissive);
    expect(res.order).toEqual(["forge"]);
    expect(res.blockedReason).toBeNull();
  });
  it("strict serves the primary when it is healthy", () => {
    const res = applyPolicy(chainWith("up"), strict);
    expect(res.order).toEqual(["vup"]);
  });
});

describe("resolvePolicy precedence", () => {
  const policies: CapabilityPolicy[] = [
    {
      capability: "image",
      consumer: null,
      strict: false,
      maxFallbackDepth: null,
      requireAck: false,
    },
    {
      capability: "image",
      consumer: "THUMBNAILS",
      strict: true,
      maxFallbackDepth: null,
      requireAck: false,
    },
  ];
  it("consumer override wins over global", () => {
    expect(resolvePolicy(policies, "image", "THUMBNAILS").strict).toBe(true);
    expect(resolvePolicy(policies, "image", "CASUALLY_EXPLAINED").strict).toBe(
      false,
    );
  });
  it("defaults to permissive when nothing matches", () => {
    expect(resolvePolicy([], "tts", null).strict).toBe(false);
  });
});
