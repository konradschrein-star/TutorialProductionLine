import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────
// @repo/db is fully replaced — no dist needed at runtime.
vi.mock("@repo/db", () => ({
  createDrizzleClient: vi.fn(),
  clips: {
    id: "clips.id",
    review_status: "clips.review_status",
    ai_description: "clips.ai_description",
    library_id: "clips.library_id",
    source_video_id: "clips.source_video_id",
    storage_key: "clips.storage_key",
    start_ms: "clips.start_ms",
    end_ms: "clips.end_ms",
  },
  sourceVideos: {
    id: "source_videos.id",
    title: "source_videos.title",
    library_id: "source_videos.library_id",
    storage_key: "source_videos.storage_key",
  },
  clipLibraries: { id: "clip_libraries.id", slug: "clip_libraries.slug" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => "eq_condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: new Proxy(
    (strings: TemplateStringsArray, ..._values: unknown[]) => strings.join("?"),
    { get: (_t, _p) => () => "sql_fragment" },
  ),
}));

vi.mock("../../footage-quality-gate.js", () => ({
  evaluateClip: vi.fn(),
}));

import { evaluateClip } from "../../footage-quality-gate.js";
import {
  queryApprovedClips,
  clipLibrarySource,
  type ApprovedClipRow,
} from "../clip-library.js";
import type { DrizzleClient } from "@repo/db";

// ── Raw DB row shape (what Drizzle's `.limit()` actually returns) ─────────────
interface RawDbRow {
  clip_id: string;
  library_id: string;
  source_video_id: string;
  clip_storage_key: string | null;
  sv_storage_key: string | null;
  ai_description: string | null;
}

const BASE_RAW_ROW: RawDbRow = {
  clip_id: "clip-uuid-1",
  library_id: "lib-uuid-1",
  source_video_id: "sv-uuid-1",
  clip_storage_key: "/opt/content-forge/media/clips/fight_scene.mp4",
  sv_storage_key: null,
  ai_description: "Darth Vader fighting scene",
};

// ── Helper: build a mock DrizzleClient ───────────────────────────────────────
function buildMockDb(rows: RawDbRow[]): DrizzleClient {
  const queryBuilder = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return {
    select: vi.fn().mockReturnValue(queryBuilder),
  } as unknown as DrizzleClient;
}

describe("queryApprovedClips()", () => {
  it("returns mapped ApprovedClipRow when the db query resolves with results", async () => {
    const db = buildMockDb([BASE_RAW_ROW]);
    const rows = await queryApprovedClips(db, "vader fighting");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clip_id).toBe("clip-uuid-1");
    expect(rows[0]!.storage_key).toBe(
      "/opt/content-forge/media/clips/fight_scene.mp4",
    );
  });

  it("falls back to sv_storage_key when clip_storage_key is null", async () => {
    const db = buildMockDb([
      {
        ...BASE_RAW_ROW,
        clip_storage_key: null,
        sv_storage_key: "/opt/content-forge/media/sources/movie.mp4",
      },
    ]);
    const rows = await queryApprovedClips(db, "vader fighting");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storage_key).toBe(
      "/opt/content-forge/media/sources/movie.mp4",
    );
  });

  it("returns empty array when no rows match", async () => {
    const db = buildMockDb([]);
    const rows = await queryApprovedClips(db, "underwater octopus");
    expect(rows).toHaveLength(0);
  });

  it("accepts librarySlug and runs the leftJoin query path", async () => {
    const db = buildMockDb([BASE_RAW_ROW]);
    const rows = await queryApprovedClips(db, "vader", "star-wars");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clip_id).toBe("clip-uuid-1");
  });

  it("drops rows where both storage keys are null", async () => {
    const db = buildMockDb([
      { ...BASE_RAW_ROW, clip_storage_key: null, sv_storage_key: null },
    ]);
    const rows = await queryApprovedClips(db, "vader");
    expect(rows).toHaveLength(0);
  });
});

describe("clipLibrarySource.fetch()", () => {
  beforeEach(async () => {
    vi.mocked(evaluateClip).mockReset();
    process.env["LOCAL_MEDIA_ROOT"] = "/opt/content-forge/media";

    // Reset the db singleton before each fetch test
    const mod = await import("../clip-library.js");
    mod.__setDb(null as unknown as DrizzleClient);
  });

  async function fetchWithDb(
    db: DrizzleClient,
    req: Parameters<typeof clipLibrarySource.fetch>[0],
  ) {
    const mod = await import("../clip-library.js");
    mod.__setDb(db);
    return mod.clipLibrarySource.fetch(req);
  }

  it("returns FootageResult when an approved clip matches the query", async () => {
    const db = buildMockDb([BASE_RAW_ROW]);
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: true,
      reasons: [],
      metrics: { width: 1920, height: 1080, durationSeconds: 8, fps: 24 },
    });

    const result = await fetchWithDb(db, {
      query: "vader fighting",
      format: "POLITICAL_COMMENTARY",
      durationSeconds: 8,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("clip-library");
    expect(result!.attribution).toBeNull();
    expect(result!.localPath).toBe(BASE_RAW_ROW.clip_storage_key);
    expect(result!.ref).toBe("clips/fight_scene.mp4");
    expect(result!.durationSeconds).toBe(8);
    expect(result!.width).toBe(1920);
    expect(result!.height).toBe(1080);
    expect(result!.providerMeta.clip_id).toBe("clip-uuid-1");
    expect(result!.providerMeta.library_id).toBe("lib-uuid-1");
    expect(result!.providerMeta.source_video_id).toBe("sv-uuid-1");
  });

  it("returns null when no clips match", async () => {
    const db = buildMockDb([]);

    const result = await fetchWithDb(db, {
      query: "no match query",
      format: "POLITICAL_COMMENTARY",
      durationSeconds: 8,
    });

    expect(result).toBeNull();
    expect(evaluateClip).not.toHaveBeenCalled();
  });

  it("respects clipLibrarySlug filter", async () => {
    const db = buildMockDb([BASE_RAW_ROW]);
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: true,
      reasons: [],
      metrics: { width: 1280, height: 720, durationSeconds: 6, fps: 24 },
    });

    const result = await fetchWithDb(db, {
      query: "vader fighting",
      format: "POLITICAL_COMMENTARY",
      durationSeconds: 6,
      clipLibrarySlug: "star-wars",
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("clip-library");
  });

  it("returns null when clip fails the quality gate", async () => {
    const db = buildMockDb([BASE_RAW_ROW]);
    vi.mocked(evaluateClip).mockResolvedValueOnce({
      accepted: false,
      reasons: ["resolution too low"],
      metrics: { width: 320, height: 240, durationSeconds: 6, fps: 15 },
    });

    const result = await fetchWithDb(db, {
      query: "vader fighting",
      format: "POLITICAL_COMMENTARY",
      durationSeconds: 6,
    });

    expect(result).toBeNull();
  });
});
