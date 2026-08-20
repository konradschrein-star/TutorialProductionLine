import { describe, it, expect, afterEach } from "vitest";
import {
  PROVIDER_ORDER_BY_INTENT,
  providerOrderFor,
  screenCandidates,
  validateProvenance,
  validateRequest,
} from "../policy.js";
import { makeCandidate, makeRequest } from "./fixtures.js";

const ENV_KEYS = [
  "VISUAL_GATEWAY_PROVIDERS",
  "VISUAL_GATEWAY_PROVIDERS_BROLL",
  "VISUAL_GATEWAY_PROVIDERS_LONG_TAIL",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("providerOrderFor", () => {
  it("uses the intent default", () => {
    expect(providerOrderFor(makeRequest({ intent: "document" }))).toEqual(
      PROVIDER_ORDER_BY_INTENT.document,
    );
  });

  it("puts wikimedia first for documents — the best sourced provenance", () => {
    expect(providerOrderFor(makeRequest({ intent: "document" }))[0]).toBe(
      "wikimedia",
    );
  });

  it("puts generated first for prop plates", () => {
    expect(providerOrderFor(makeRequest({ intent: "prop-plate" }))[0]).toBe(
      "generated",
    );
  });

  it("honours an explicit per-request order", () => {
    const order = providerOrderFor(
      makeRequest({ providerOrder: ["wikimedia", "generated"] }),
    );
    expect(order).toEqual(["wikimedia", "generated"]);
  });

  it("honours the per-intent env override and drops unknown names", () => {
    process.env["VISUAL_GATEWAY_PROVIDERS_BROLL"] = "wikimedia, nonsense ,web";
    expect(providerOrderFor(makeRequest({ intent: "broll" }))).toEqual([
      "wikimedia",
      "web",
    ]);
  });

  it("prefers the env override over the global one", () => {
    process.env["VISUAL_GATEWAY_PROVIDERS"] = "web";
    process.env["VISUAL_GATEWAY_PROVIDERS_BROLL"] = "wikimedia";
    expect(providerOrderFor(makeRequest({ intent: "broll" }))).toEqual([
      "wikimedia",
    ]);
  });

  it("hoists pexels to the front when motion is preferred", () => {
    const order = providerOrderFor(
      makeRequest({ intent: "abstract-subject", preferMotion: true }),
    );
    expect(order[0]).toBe("pexels");
  });

  it("throws rather than silently trying every provider when the order is empty", () => {
    process.env["VISUAL_GATEWAY_PROVIDERS"] = "not-a-provider";
    expect(() => providerOrderFor(makeRequest())).toThrow(
      /no providers resolved/,
    );
  });
});

describe("validateRequest", () => {
  it("accepts a well-formed request", () => {
    expect(() => validateRequest(makeRequest())).not.toThrow();
  });

  it("rejects an empty query", () => {
    expect(() => validateRequest(makeRequest({ query: "  " }))).toThrow(
      /query is empty/,
    );
  });

  it("rejects a non-positive minWidth instead of picking one", () => {
    expect(() => validateRequest(makeRequest({ minWidth: 0 }))).toThrow(
      /minWidth must be a positive number/,
    );
  });

  it("rejects preferMotion without a clip duration rather than choosing one", () => {
    expect(() => validateRequest(makeRequest({ preferMotion: true }))).toThrow(
      /motionDurationSeconds is missing/,
    );
  });

  it("accepts preferMotion with a duration", () => {
    expect(() =>
      validateRequest(
        makeRequest({ preferMotion: true, motionDurationSeconds: 6 }),
      ),
    ).not.toThrow();
  });
});

describe("validateProvenance (fail-closed gate)", () => {
  it("accepts a complete provenance", () => {
    expect(validateProvenance(makeCandidate()).ok).toBe(true);
  });

  const blanked: Array<[string, Parameters<typeof makeCandidate>[0]]> = [
    ["sourceUrl", { provenance: { sourceUrl: "" } }],
    ["licence", { provenance: { licence: "" } }],
    ["retrievedAt", { provenance: { retrievedAt: "" } }],
    ["title", { provenance: { title: "  " } }],
  ];
  for (const [field, options] of blanked) {
    it(`discards a candidate with a blank ${field}`, () => {
      const result = validateProvenance(makeCandidate(options));
      expect(result.ok).toBe(false);
    });
  }

  it("discards a sourced candidate whose sourceUrl is not http(s)", () => {
    const result = validateProvenance(
      makeCandidate({ provenance: { sourceUrl: "file:///tmp/x.png" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("http(s)");
  });

  it("allows the generated provider's non-http media ref", () => {
    const result = validateProvenance(
      makeCandidate({
        provenance: {
          provider: "generated",
          sourceUrl: "mediagateway:fleet:abc123",
          licence: "generated:in-house",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("discards a malformed retrievedAt rather than reformatting it", () => {
    const result = validateProvenance(
      makeCandidate({ provenance: { retrievedAt: "2026-08-15" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ISO-8601");
  });

  it("discards a video candidate that declares no dimensions", () => {
    const result = validateProvenance(
      makeCandidate({
        mediaKind: "video",
        fileExtension: "mp4",
        dimensionsDeclared: false,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("video candidate");
  });
});

describe("screenCandidates", () => {
  it("drops candidates below the declared width floor", () => {
    const screening = screenCandidates(makeRequest({ minWidth: 1920 }), [
      makeCandidate({ provenance: { width: 1280, height: 720 } }),
    ]);
    expect(screening.accepted).toHaveLength(0);
    expect(screening.rejected[0]!.reason).toContain("below the 1920px floor");
  });

  it("keeps a needs-review candidate by default, flagged", () => {
    const screening = screenCandidates(makeRequest(), [
      makeCandidate({
        provenance: {
          provider: "google",
          licence: "unknown",
          sourceUrl: "https://example.com/a.jpg",
        },
      }),
    ]);
    expect(screening.accepted).toHaveLength(1);
    expect(screening.accepted[0]!.posture).toBe("needs-review");
    expect(screening.accepted[0]!.reviewReason).toBeTruthy();
  });

  it("refuses a needs-review candidate when allowNeedsReview is false", () => {
    const screening = screenCandidates(
      makeRequest({ allowNeedsReview: false }),
      [
        makeCandidate({
          provenance: {
            provider: "web",
            licence: "unknown",
            sourceUrl: "https://sba.gov/form.png",
          },
        }),
      ],
    );
    expect(screening.accepted).toHaveLength(0);
    expect(screening.rejected[0]!.reason).toContain("allowNeedsReview=false");
  });

  it("ranks publishable before needs-review, then widest first", () => {
    const screening = screenCandidates(makeRequest({ minWidth: 100 }), [
      makeCandidate({
        provenance: {
          provider: "google",
          licence: "unknown",
          sourceUrl: "https://example.com/huge.jpg",
          width: 4000,
          height: 3000,
        },
      }),
      makeCandidate({
        provenance: { sourceUrl: "https://pexels.com/a", width: 1280 },
      }),
      makeCandidate({
        provenance: { sourceUrl: "https://pexels.com/b", width: 2560 },
      }),
    ]);
    expect(
      screening.accepted.map((a) => a.candidate.provenance.sourceUrl),
    ).toEqual([
      "https://pexels.com/b",
      "https://pexels.com/a",
      "https://example.com/huge.jpg",
    ]);
  });
});
