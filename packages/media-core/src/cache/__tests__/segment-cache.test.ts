import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { JsonValue } from "../canonical-json.js";
import {
  computeCacheKey,
  createSegmentCache,
  selectEvictions,
  SegmentCache,
  SegmentCacheError,
  SegmentCacheIntegrityError,
  type SegmentCacheEntry,
} from "../segment-cache.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const SPEC: JsonValue = {
  element: "FormulaReveal",
  layout: "framed-chart",
  aspect: "16:9",
  grade: "cool",
  data: { steps: [{ label: "NOI", value: 125_000 }] },
};

let root: string;
let cache: SegmentCache;
let scratch: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "segcache-"));
  scratch = join(root, "scratch");
  await mkdir(scratch, { recursive: true });
  cache = createSegmentCache({ mediaRoot: root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write a fake segment file of a given payload and return its path. */
async function makeSegment(name: string, payload: string): Promise<string> {
  const p = join(scratch, name);
  await writeFile(p, payload, "utf8");
  return p;
}

async function shardNames(): Promise<string[]> {
  return (await readdir(join(root, "segment-cache"))).sort();
}

// ---------------------------------------------------------------------------
// computeCacheKey
// ---------------------------------------------------------------------------

describe("computeCacheKey", () => {
  it("returns a 64-character lowercase sha256 hex digest", () => {
    expect(computeCacheKey(SPEC)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across object key insertion order", () => {
    const reordered: JsonValue = {
      data: { steps: [{ value: 125_000, label: "NOI" }] },
      grade: "cool",
      aspect: "16:9",
      layout: "framed-chart",
      element: "FormulaReveal",
    };
    expect(computeCacheKey(reordered)).toBe(computeCacheKey(SPEC));
  });

  it("changes when any hashed field changes", () => {
    const base = computeCacheKey(SPEC);
    expect(computeCacheKey({ ...SPEC, grade: "warm" } as JsonValue)).not.toBe(
      base,
    );
    expect(computeCacheKey({ ...SPEC, aspect: "9:16" } as JsonValue)).not.toBe(
      base,
    );
    expect(
      computeCacheKey({
        ...SPEC,
        data: { steps: [{ label: "NOI", value: 125_001 }] },
      } as JsonValue),
    ).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// miss -> store -> hit
// ---------------------------------------------------------------------------

describe("lookup / store", () => {
  it("misses on an empty store", async () => {
    expect(await cache.lookup(computeCacheKey(SPEC))).toBeNull();
  });

  it("stores then hits, with a shard directory named after the key prefix", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "SEGMENT-BYTES");

    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 90,
    });

    expect(stored.key).toBe(key);
    expect(stored.sourceDurationFrames).toBe(90);
    expect(stored.bytes).toBe("SEGMENT-BYTES".length);
    expect(stored.filePath).toBe(
      join(root, "segment-cache", key.slice(0, 2), `${key}.mp4`),
    );
    expect(await shardNames()).toEqual([key.slice(0, 2)]);

    const hit = await cache.lookup(key);
    expect(hit).not.toBeNull();
    expect(hit?.filePath).toBe(stored.filePath);
    expect(hit?.spec).toEqual(SPEC);
    expect(hit?.sourceDurationFrames).toBe(90);
    expect(await readFile(hit!.filePath, "utf8")).toBe("SEGMENT-BYTES");
  });

  it("writes an auditable sidecar next to the segment", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 45,
    });

    const sidecar: unknown = JSON.parse(
      await readFile(stored.sidecarPath, "utf8"),
    );
    expect(sidecar).toMatchObject({
      key,
      spec: SPEC,
      sourceDurationFrames: 45,
      bytes: 3,
    });
    const rec = sidecar as Record<string, unknown>;
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.lastAccessedAt).toBe("string");
  });

  it("leaves no staging files behind", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    await cache.store(key, src, { spec: SPEC, sourceDurationFrames: 30 });

    const files = await readdir(join(root, "segment-cache", key.slice(0, 2)));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files.sort()).toEqual([`${key}.mp4`, `${key}.mp4.json`]);
  });

  it("refreshes lastAccessedAt on a hit", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    await new Promise((r) => setTimeout(r, 5));
    const hit = await cache.lookup(key);

    expect(hit).not.toBeNull();
    expect(Date.parse(hit!.lastAccessedAt)).toBeGreaterThanOrEqual(
      Date.parse(stored.lastAccessedAt),
    );
    const sidecar = JSON.parse(
      await readFile(stored.sidecarPath, "utf8"),
    ) as Record<string, unknown>;
    expect(sidecar.lastAccessedAt).toBe(hit!.lastAccessedAt);
    expect(sidecar.createdAt).toBe(stored.createdAt);
  });

  it("keeps different specs in different entries", async () => {
    const k1 = computeCacheKey(SPEC);
    const spec2: JsonValue = { ...SPEC, grade: null };
    const k2 = computeCacheKey(spec2);

    await cache.store(k1, await makeSegment("a.mp4", "ONE"), {
      spec: SPEC,
      sourceDurationFrames: 10,
    });
    await cache.store(k2, await makeSegment("b.mp4", "TWO-TWO"), {
      spec: spec2,
      sourceDurationFrames: 20,
    });

    expect(await readFile((await cache.lookup(k1))!.filePath, "utf8")).toBe(
      "ONE",
    );
    expect(await readFile((await cache.lookup(k2))!.filePath, "utf8")).toBe(
      "TWO-TWO",
    );
  });
});

// ---------------------------------------------------------------------------
// fail-closed validation
// ---------------------------------------------------------------------------

describe("store — fail closed", () => {
  it("rejects a malformed key", async () => {
    const src = await makeSegment("a.mp4", "X");
    await expect(
      cache.store("not-a-hash", src, { spec: SPEC, sourceDurationFrames: 1 }),
    ).rejects.toThrow(SegmentCacheError);
  });

  it("rejects a key that does not hash from the supplied spec", async () => {
    const wrongKey = computeCacheKey({ ...SPEC, grade: "warm" } as JsonValue);
    const src = await makeSegment("a.mp4", "X");
    await expect(
      cache.store(wrongKey, src, { spec: SPEC, sourceDurationFrames: 1 }),
    ).rejects.toThrow(/would poison the cache/);
  });

  it("rejects a non-positive or non-integer frame count instead of defaulting", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "X");
    for (const frames of [0, -1, 1.5, Number.NaN]) {
      await expect(
        cache.store(key, src, { spec: SPEC, sourceDurationFrames: frames }),
      ).rejects.toThrow(/sourceDurationFrames must be a positive integer/);
    }
  });

  it("rejects a missing source file", async () => {
    const key = computeCacheKey(SPEC);
    await expect(
      cache.store(key, join(scratch, "nope.mp4"), {
        spec: SPEC,
        sourceDurationFrames: 1,
      }),
    ).rejects.toThrow(/source file does not exist/);
  });

  it("rejects a zero-byte source file — a failed render is not cacheable", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("empty.mp4", "");
    await expect(
      cache.store(key, src, { spec: SPEC, sourceDurationFrames: 1 }),
    ).rejects.toThrow(/zero bytes/);
  });

  it("rejects a spec that is not losslessly JSON-serialisable", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "X");
    const badSpec = { at: new Date(0) } as unknown as JsonValue;
    await expect(
      cache.store(key, src, { spec: badSpec, sourceDurationFrames: 1 }),
    ).rejects.toThrow(SegmentCacheError);
  });

  it("rejects a bad media extension at construction", () => {
    expect(() =>
      createSegmentCache({ mediaRoot: root, mediaExtension: ".mp4" }),
    ).toThrow(SegmentCacheError);
    expect(() =>
      createSegmentCache({ mediaRoot: root, mediaExtension: "../x" }),
    ).toThrow(SegmentCacheError);
  });
});

describe("lookup — integrity", () => {
  it("throws when a segment exists without its sidecar", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    await rm(stored.sidecarPath);

    await expect(cache.lookup(key)).rejects.toThrow(SegmentCacheIntegrityError);
  });

  it("throws when the sidecar is unparseable", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    await writeFile(stored.sidecarPath, "{ not json", "utf8");

    await expect(cache.lookup(key)).rejects.toThrow(SegmentCacheIntegrityError);
  });

  it("misses (does not throw) when only the sidecar survives", async () => {
    const key = computeCacheKey(SPEC);
    const src = await makeSegment("a.mp4", "XYZ");
    const stored = await cache.store(key, src, {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    await rm(stored.filePath);

    expect(await cache.lookup(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withCache
// ---------------------------------------------------------------------------

describe("withCache", () => {
  it("produces on a miss and serves from cache thereafter", async () => {
    const key = computeCacheKey(SPEC);
    let produceCalls = 0;

    const produce = async (ctx: {
      suggestedOutputPath: string;
    }): Promise<{ filePath: string; sourceDurationFrames: number }> => {
      produceCalls += 1;
      await writeFile(ctx.suggestedOutputPath, "RENDERED", "utf8");
      return { filePath: ctx.suggestedOutputPath, sourceDurationFrames: 120 };
    };

    const first = await cache.withCache(key, SPEC, produce);
    expect(first.hit).toBe(false);
    expect(produceCalls).toBe(1);

    const second = await cache.withCache(key, SPEC, produce);
    expect(second.hit).toBe(true);
    expect(produceCalls).toBe(1);
    expect(second.entry.filePath).toBe(first.entry.filePath);
    expect(await readFile(second.entry.filePath, "utf8")).toBe("RENDERED");
  });

  it("removes the producer work directory afterwards, on success and on failure", async () => {
    const key = computeCacheKey(SPEC);
    let seenWorkDir = "";

    await cache.withCache(key, SPEC, async (ctx) => {
      seenWorkDir = ctx.workDir;
      await writeFile(ctx.suggestedOutputPath, "RENDERED", "utf8");
      return { filePath: ctx.suggestedOutputPath, sourceDurationFrames: 30 };
    });
    await expect(stat(seenWorkDir)).rejects.toThrow();

    const otherSpec: JsonValue = { ...SPEC, grade: "warm" };
    const otherKey = computeCacheKey(otherSpec);
    let failedWorkDir = "";
    await expect(
      cache.withCache(otherKey, otherSpec, async (ctx) => {
        failedWorkDir = ctx.workDir;
        throw new Error("render blew up");
      }),
    ).rejects.toThrow("render blew up");
    await expect(stat(failedWorkDir)).rejects.toThrow();
  });

  it("propagates producer failures instead of caching a placeholder", async () => {
    const key = computeCacheKey(SPEC);
    await expect(
      cache.withCache(key, SPEC, async () => {
        throw new Error("remotion crashed");
      }),
    ).rejects.toThrow("remotion crashed");

    expect(await cache.lookup(key)).toBeNull();
    expect((await cache.stats()).entryCount).toBe(0);
  });

  it("rejects a producer that returns a path it did not write", async () => {
    const key = computeCacheKey(SPEC);
    await expect(
      cache.withCache(key, SPEC, async (ctx) => ({
        filePath: ctx.suggestedOutputPath,
        sourceDurationFrames: 30,
      })),
    ).rejects.toThrow(/source file does not exist/);
  });
});

// ---------------------------------------------------------------------------
// concurrency
// ---------------------------------------------------------------------------

describe("concurrent writers", () => {
  it("keeps exactly one intact entry when many producers race on the same key", async () => {
    const key = computeCacheKey(SPEC);
    const workers = 8;
    // Distinct, distinctly-sized payloads: a torn or interleaved write produces
    // a file that matches none of them.
    const payloads = Array.from({ length: workers }, (_, i) =>
      `WORKER-${i}`.padEnd(100 + i * 37, String(i)),
    );

    const results = await Promise.all(
      payloads.map((payload, i) =>
        cache.withCache(key, SPEC, async (ctx) => {
          await new Promise((r) => setTimeout(r, (i * 7) % 13));
          await writeFile(ctx.suggestedOutputPath, payload, "utf8");
          return {
            filePath: ctx.suggestedOutputPath,
            sourceDurationFrames: 60,
          };
        }),
      ),
    );

    const shard = join(root, "segment-cache", key.slice(0, 2));
    const files = (await readdir(shard)).sort();
    expect(files).toEqual([`${key}.mp4`, `${key}.mp4.json`]);

    const committed = await readFile(join(shard, `${key}.mp4`), "utf8");
    expect(payloads).toContain(committed);

    // Every caller resolves to the same path, and the sidecar is valid.
    for (const r of results) {
      expect(r.entry.filePath).toBe(join(shard, `${key}.mp4`));
    }
    const entry = await cache.lookup(key);
    expect(entry).not.toBeNull();
    expect(entry!.bytes).toBe(Buffer.byteLength(committed, "utf8"));
    expect(entry!.sourceDurationFrames).toBe(60);

    const listing = await cache.listEntries();
    expect(listing.entries).toHaveLength(1);
    expect(listing.orphans.mediaWithoutSidecar).toEqual([]);
    expect(listing.orphans.unreadableSidecar).toEqual([]);
  });

  it("keeps direct concurrent store() calls consistent", async () => {
    const key = computeCacheKey(SPEC);
    const a = await makeSegment("a.mp4", "A".repeat(64));
    const b = await makeSegment("b.mp4", "B".repeat(128));

    const [ra, rb] = await Promise.all([
      cache.store(key, a, { spec: SPEC, sourceDurationFrames: 30 }),
      cache.store(key, b, { spec: SPEC, sourceDurationFrames: 30 }),
    ]);

    expect(ra.filePath).toBe(rb.filePath);
    const committed = await readFile(ra.filePath, "utf8");
    expect([64, 128]).toContain(committed.length);
    expect(committed).toBe(committed[0]!.repeat(committed.length));

    const stats = await cache.stats();
    expect(stats.entryCount).toBe(1);
    expect(stats.totalBytes).toBe(committed.length);
  });
});

// ---------------------------------------------------------------------------
// stats / listEntries / remove
// ---------------------------------------------------------------------------

describe("stats and listEntries", () => {
  it("reports zeroes for an untouched store", async () => {
    const stats = await cache.stats();
    expect(stats).toEqual({
      entryCount: 0,
      totalBytes: 0,
      shardCount: 0,
      orphans: {
        mediaWithoutSidecar: [],
        sidecarWithoutMedia: [],
        unreadableSidecar: [],
      },
    });
  });

  it("counts entries and total bytes across shards", async () => {
    let expectedBytes = 0;
    for (let i = 0; i < 5; i++) {
      const spec: JsonValue = { ...SPEC, aspect: `16:${9 + i}` };
      const payload = "Z".repeat(10 + i);
      expectedBytes += payload.length;
      await cache.store(
        computeCacheKey(spec),
        await makeSegment(`s${i}.mp4`, payload),
        {
          spec,
          sourceDurationFrames: 30,
        },
      );
    }

    const stats = await cache.stats();
    expect(stats.entryCount).toBe(5);
    expect(stats.totalBytes).toBe(expectedBytes);
    expect(stats.shardCount).toBeGreaterThan(0);
  });

  it("reports orphans without throwing, unlike lookup", async () => {
    const key = computeCacheKey(SPEC);
    const stored = await cache.store(key, await makeSegment("a.mp4", "XYZ"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });
    await rm(stored.sidecarPath);

    const listing = await cache.listEntries();
    expect(listing.entries).toEqual([]);
    expect(listing.orphans.mediaWithoutSidecar).toEqual([stored.filePath]);
  });

  it("ignores files that are not part of the store", async () => {
    const key = computeCacheKey(SPEC);
    await cache.store(key, await makeSegment("a.mp4", "XYZ"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });
    const shard = join(root, "segment-cache", key.slice(0, 2));
    await writeFile(join(shard, `${key}.mp4.1234-abcd.tmp`), "partial", "utf8");
    await writeFile(join(shard, "README.txt"), "hello", "utf8");

    const stats = await cache.stats();
    expect(stats.entryCount).toBe(1);
    expect(stats.totalBytes).toBe(3);
    expect(stats.orphans.mediaWithoutSidecar).toEqual([]);
  });

  it("keeps different container extensions in the same store without collision", async () => {
    const webm = createSegmentCache({
      mediaRoot: root,
      mediaExtension: "webm",
    });
    const key = computeCacheKey(SPEC);

    await cache.store(key, await makeSegment("a.mp4", "MP4"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });
    await webm.store(key, await makeSegment("a.webm", "WEBM-ALPHA"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    expect(await readFile((await cache.lookup(key))!.filePath, "utf8")).toBe(
      "MP4",
    );
    expect(await readFile((await webm.lookup(key))!.filePath, "utf8")).toBe(
      "WEBM-ALPHA",
    );
    expect((await cache.stats()).entryCount).toBe(1);
    expect((await webm.stats()).entryCount).toBe(1);
  });
});

describe("remove", () => {
  it("deletes both files and reports whether anything was there", async () => {
    const key = computeCacheKey(SPEC);
    const stored = await cache.store(key, await makeSegment("a.mp4", "XYZ"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    expect(await cache.remove(key)).toBe(true);
    await expect(stat(stored.filePath)).rejects.toThrow();
    await expect(stat(stored.sidecarPath)).rejects.toThrow();
    expect(await cache.lookup(key)).toBeNull();

    expect(await cache.remove(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectEvictions (pure)
// ---------------------------------------------------------------------------

function fakeEntry(
  key: string,
  bytes: number,
  lastAccessedAt: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): SegmentCacheEntry {
  return {
    key: key.padEnd(64, "0"),
    filePath: `/cache/${key}.mp4`,
    sidecarPath: `/cache/${key}.mp4.json`,
    spec: { element: key },
    createdAt,
    lastAccessedAt,
    sourceDurationFrames: 30,
    bytes,
  };
}

describe("selectEvictions", () => {
  const oldest = fakeEntry("a", 100, "2026-01-01T00:00:00.000Z");
  const middle = fakeEntry("b", 200, "2026-02-01T00:00:00.000Z");
  const newest = fakeEntry("c", 300, "2026-03-01T00:00:00.000Z");
  const entries = [newest, oldest, middle]; // deliberately unsorted input

  it("evicts nothing when already within budget", () => {
    const plan = selectEvictions(entries, 600);
    expect(plan.evict).toEqual([]);
    expect(plan.overBytes).toBe(0);
    expect(plan.keep).toHaveLength(3);
    expect(plan.remainingBytes).toBe(600);
  });

  it("evicts least-recently-used first and stops as soon as it is under budget", () => {
    const plan = selectEvictions(entries, 350);
    expect(plan.evict.map((e) => e.key)).toEqual([oldest.key, middle.key]);
    expect(plan.keep.map((e) => e.key)).toEqual([newest.key]);
    expect(plan.reclaimedBytes).toBe(300);
    expect(plan.remainingBytes).toBe(300);
    expect(plan.overBytes).toBe(250);
  });

  it("evicts only the single oldest entry when that suffices", () => {
    const plan = selectEvictions(entries, 500);
    expect(plan.evict.map((e) => e.key)).toEqual([oldest.key]);
    expect(plan.remainingBytes).toBe(500);
  });

  it("selects everything at a zero budget", () => {
    const plan = selectEvictions(entries, 0);
    expect(plan.evict).toHaveLength(3);
    expect(plan.remainingBytes).toBe(0);
    expect(plan.keep).toEqual([]);
  });

  it("breaks ties on createdAt then key, deterministically", () => {
    const sameAccess = "2026-05-01T00:00:00.000Z";
    const x = fakeEntry("x", 10, sameAccess, "2026-04-02T00:00:00.000Z");
    const y = fakeEntry("y", 10, sameAccess, "2026-04-01T00:00:00.000Z");
    const z = fakeEntry("z", 10, sameAccess, "2026-04-01T00:00:00.000Z");

    const plan = selectEvictions([x, z, y], 0);
    expect(plan.evict.map((e) => e.key)).toEqual([y.key, z.key, x.key]);
  });

  it("is pure — it does not mutate or reorder its input", () => {
    const input = [...entries];
    selectEvictions(input, 0);
    expect(input).toEqual(entries);
  });

  it("rejects a negative or non-finite budget", () => {
    expect(() => selectEvictions(entries, -1)).toThrow(SegmentCacheError);
    expect(() => selectEvictions(entries, Number.NaN)).toThrow(
      SegmentCacheError,
    );
  });

  it("deletes nothing on its own — the store still holds every entry", async () => {
    const key = computeCacheKey(SPEC);
    await cache.store(key, await makeSegment("a.mp4", "XYZ"), {
      spec: SPEC,
      sourceDurationFrames: 30,
    });

    const listing = await cache.listEntries();
    const plan = selectEvictions(listing.entries, 0);
    expect(plan.evict).toHaveLength(1);

    // No implicit deletion: the entry survives until remove() is called.
    expect((await cache.stats()).entryCount).toBe(1);
    await cache.remove(plan.evict[0]!.key);
    expect((await cache.stats()).entryCount).toBe(0);
  });
});
