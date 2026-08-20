import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Minimal but REAL JPEG headers (SOI + SOF0), so sniffImage measures them for
 * real rather than being mocked out. 1376x768 is what veo_fleet actually
 * returns; 1280x720 is what normalisation must produce.
 */
const { JPEG_1376x768, JPEG_1280x720 } = vi.hoisted(() => {
  function jpeg(w: number, h: number): Buffer {
    const buf = Buffer.alloc(24);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    buf[3] = 0xc0;
    buf.writeUInt16BE(17, 4);
    buf[6] = 8;
    buf.writeUInt16BE(h, 7);
    buf.writeUInt16BE(w, 9);
    return buf;
  }
  return { JPEG_1376x768: jpeg(1376, 768), JPEG_1280x720: jpeg(1280, 720) };
});

const repo = vi.hoisted(() => ({
  // The character library is the ONLY source for the channel's host.
  // `channel_personas` is a read-only VIEW over exactly this data, so the engine
  // no longer reads it at all — there is nothing left to mock.
  resolveChannelHost: vi.fn(),
  getChannelThumbnailProfile: vi.fn(),
  getThumbnailArchetypeById: vi.fn(),
  resolveArchetypeCandidates: vi.fn(),
  pickLeastRecentlyUsedArchetype: vi.fn(),
  createThumbnailRecord: vi.fn(),
  updateThumbnailRecord: vi.fn(),
  getThumbnailById: vi.fn(),
  getThumbnailFormatRule: vi.fn(),
}));
vi.mock("@repo/db/repositories", () => repo);

const gateway = vi.hoisted(() => ({
  requestImageDetailed: vi.fn(async () => ({
    ref: "vup:https://x/y.jpg",
    servedBy: "vup",
    chain: ["vup", "forge", "fastgen", "ai33"],
    fallbackUsed: false,
    attempts: 1,
  })),
  resolveImageChain: vi.fn(() => ({
    chain: ["veo_fleet", "vup", "forge", "ai33"],
    configured: ["veo_fleet", "vup", "forge", "ai33"],
  })),
  downloadMedia: vi.fn(async () => undefined),
  // A real 1x1 JPEG header is not needed: the contract assert is exercised in
  // image-contract's own tests. Here we hand back bytes the sniffer accepts.
  downloadMediaBuffer: vi.fn(async () => JPEG_1376x768),
  // Mirrors the real capability table: only veo_fleet/ai33/fastgen carry more
  // than one i2i reference; vup carries one; forge and veoforge carry none.
  maxImageReferences: vi.fn((backend: string) =>
    backend === "veo_fleet" || backend === "ai33" || backend === "fastgen"
      ? Number.POSITIVE_INFINITY
      : backend === "vup"
        ? 1
        : 0,
  ),
  // veo_fleet / veoforge / vup all REJECT prompts over 2000 chars.
  maxPromptChars: vi.fn((backend: string) =>
    backend === "veo_fleet" || backend === "veoforge" || backend === "vup"
      ? 2000
      : Number.POSITIVE_INFINITY,
  ),
}));
vi.mock("../../media-gateway/index.js", () => gateway);

vi.mock("../../llm-client.js", () => ({
  requestLLMText: vi.fn(async () => "Punchy Headline"),
}));
vi.mock("../deepseek-prompt.js", () => ({
  authorThumbnailPrompt: vi.fn(async () => "ds prompt"),
}));
// No real disk I/O: mkdir is a no-op; readFile returns a byte so any LOCAL
// reference path would encode to a data URI. Tests use http(s) references so
// they pass through toGatewayRef unchanged and path assertions stay legible.
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("img")),
  writeFile: vi.fn(async () => undefined),
}));
// ffmpeg does not run in unit tests; the crop/scale maths has its own test.
vi.mock("@repo/media-core/images", () => ({
  normaliseYouTubeThumbnailBuffer: vi.fn(async () => ({
    buffer: JPEG_1280x720,
    width: 1280,
    height: 720,
    byteSize: JPEG_1280x720.byteLength,
    quality: 2,
  })),
}));

import { requestThumbnail } from "../index.js";

const archetype = {
  id: "a1",
  reference_image_path: "https://ref/a1.jpg",
  extra_reference_paths: [],
  layout_instructions: null,
  base_prompt: null,
  features_logo: false,
  aspect_ratio: "16:9",
  resolution: "1k",
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.resolveChannelHost.mockResolvedValue(undefined);
  repo.getChannelThumbnailProfile.mockResolvedValue(undefined);
  repo.getThumbnailFormatRule.mockResolvedValue(undefined);
  repo.createThumbnailRecord.mockResolvedValue({ id: "t1" });
  repo.updateThumbnailRecord.mockResolvedValue({ id: "t1" });
  gateway.requestImageDetailed.mockResolvedValue({
    ref: "vup:https://x/y.jpg",
    servedBy: "vup",
    chain: ["vup", "forge", "fastgen", "ai33"],
    fallbackUsed: false,
    attempts: 1,
  });
  gateway.resolveImageChain.mockReturnValue({
    chain: ["veo_fleet", "vup", "forge", "ai33"],
    configured: ["veo_fleet", "vup", "forge", "ai33"],
  });
  gateway.maxImageReferences.mockImplementation((backend: string) =>
    backend === "veo_fleet" || backend === "ai33" || backend === "fastgen"
      ? Number.POSITIVE_INFINITY
      : backend === "vup"
        ? 1
        : 0,
  );
  gateway.maxPromptChars.mockImplementation((backend: string) =>
    backend === "veo_fleet" || backend === "veoforge" || backend === "vup"
      ? 2000
      : Number.POSITIVE_INFINITY,
  );
});

describe("requestThumbnail", () => {
  it("records a visible failure when no archetype is available", async () => {
    repo.resolveArchetypeCandidates.mockResolvedValue({
      candidates: [],
      source: "global",
      tiers: ["base"],
      difficulty: null,
      difficultyNote: "no difficulty signal",
      emptyCurationReason: null,
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "tutorial_job",
      subjectId: "job1",
      format: "TUTORIAL_STUDIO",
      channelId: "c1",
      title: "T",
    });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("No archetype available");
    expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
    // The refusal must exist as a ROW, not only as a log line — a traceless
    // skip is what made 75 consecutive failures invisible.
    const recorded = repo.createThumbnailRecord.mock.calls[0][1];
    expect(recorded.status).toBe("failed");
    expect(recorded.error_message).toContain("No archetype available");
    expect(res.thumbnailId).toBe("t1");
  });

  it("generates with the archetype reference and records honest attribution", async () => {
    repo.resolveArchetypeCandidates.mockResolvedValue({
      candidates: [archetype],
      source: "global",
      tiers: ["base"],
      difficulty: null,
      difficultyNote: "no difficulty signal",
      emptyCurationReason: null,
    });
    // Deliberately an UNBRANDED format: this test is about provider
    // attribution and the single archetype reference, not about branding. A
    // TUTORIAL_STUDIO subject would (correctly) be refused for having no host,
    // which would test the contract instead of what this test is named for.
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job1",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "Docker in 5 minutes",
    });
    expect(res.status).toBe("completed");
    expect(res.providerUsed).toBe("vup");
    expect(res.fallbackUsed).toBe(false);
    const [, opts] = gateway.requestImageDetailed.mock.calls[0];
    expect(opts.referenceImages).toEqual(["https://ref/a1.jpg"]);
    expect(opts.aspectRatio).toBe("16:9");
    // is_selected is NOT written as a side effect of completion (fixes A2.12).
    const updateArgs = repo.updateThumbnailRecord.mock.calls.map((c) => c[2]);
    expect(updateArgs.some((u) => u.is_selected === true)).toBe(false);
  });

  it("surfaces a fallback as a visible downgrade, never silently", async () => {
    repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
    gateway.requestImageDetailed.mockResolvedValue({
      ref: "data:image/png;base64,AAAA",
      servedBy: "ai33",
      chain: ["vup", "forge", "fastgen", "ai33"],
      fallbackUsed: true,
      attempts: 2,
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job2",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "X vs Y",
      archetypeId: "a1",
    });
    expect(res.status).toBe("completed");
    expect(res.fallbackUsed).toBe(true);
    expect(res.downgradedFrom).toBe("vup");
    const persisted = repo.updateThumbnailRecord.mock.calls.find(
      (c) => c[2].status === "completed",
    )?.[2];
    expect(persisted.provider_used).toBe("ai33");
    expect(persisted.fallback_used).toBe(true);
  });

  it("refuses (fail policy) a thumbnail served by a fallback", async () => {
    repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
    gateway.requestImageDetailed.mockResolvedValue({
      ref: "data:image/png;base64,AAAA",
      servedBy: "ai33",
      chain: ["vup", "ai33"],
      fallbackUsed: true,
      attempts: 2,
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job2",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "X vs Y",
      archetypeId: "a1",
      onFallback: "fail",
    });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("on_fallback=fail");
  });

  it("refuses BEFORE spending when no configured backend can serve it", async () => {
    repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
    gateway.resolveImageChain.mockReturnValue({ chain: [], configured: [] });
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job9",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "X vs Y",
      archetypeId: "a1",
    });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("No configured backend");
    expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
  });

  it("iterate uses the PARENT's output as the reference", async () => {
    repo.getThumbnailById.mockResolvedValue({
      id: "p1",
      output_path: "https://ref/parent.jpg",
      archetype_id: "a1",
      aspect_ratio: "16:9",
      resolution: "1k",
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "studio",
      subjectId: "job4",
      format: "OTHER",
      title: "Anything",
      generationKind: "iterate",
      parentThumbnailId: "11111111-1111-1111-1111-111111111111",
      instructions: "make the background darker",
    });
    expect(res.status).toBe("completed");
    const [prompt, opts] = gateway.requestImageDetailed.mock.calls[0];
    expect(opts.referenceImages).toEqual(["https://ref/parent.jpg"]);
    expect(prompt).toContain("make the background darker");
  });

  it("regenerate uses the parent's ORIGINAL archetype reference, not its output", async () => {
    repo.getThumbnailById.mockResolvedValue({
      id: "p1",
      output_path: "https://ref/parent-output.jpg",
      archetype_id: "a1",
      reference_paths: { archetype: "https://ref/original.jpg" },
      aspect_ratio: "16:9",
      resolution: "1k",
    });
    repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
    const res = await requestThumbnail({} as never, {
      subjectKind: "studio",
      subjectId: "job5",
      format: "OTHER",
      title: "Anything",
      generationKind: "regenerate",
      parentThumbnailId: "22222222-2222-2222-2222-222222222222",
      instructions: "different angle",
    });
    expect(res.status).toBe("completed");
    const [, opts] = gateway.requestImageDetailed.mock.calls[0];
    expect(opts.referenceImages).toEqual(["https://ref/original.jpg"]);
    expect(opts.referenceImages).not.toContain("https://ref/parent-output.jpg");
  });

  it("localizes from a base thumbnail using it as the reference", async () => {
    repo.getThumbnailById.mockResolvedValue({
      output_path: "https://ref/base.jpg",
      aspect_ratio: "16:9",
      resolution: "1k",
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job3",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "X vs Y",
      targetLanguage: "Spanish",
      localizeFromThumbnailId: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.status).toBe("completed");
    const [prompt, opts] = gateway.requestImageDetailed.mock.calls[0];
    expect(opts.referenceImages).toEqual(["https://ref/base.jpg"]);
    expect(prompt).toContain("Translate all visible text to Spanish");
    const recordArg = repo.createThumbnailRecord.mock.calls[0][1];
    expect(recordArg.language).toBe("Spanish");
  });

  // ── Host character as i2i reference ────────────────────────
  // The host's face is the SECOND reference image. It comes from the character
  // library (characters + character_images + character_channels), which is the
  // single source of truth; `channel_personas` is a read-only view over it and
  // the engine no longer reads it.
  const host = {
    character: {
      id: "ch1",
      name: "General Guy",
      description: "clean-shaven man, early 30s",
    },
    images: [
      {
        id: "i1",
        image_path: "https://ref/host-1.jpg",
        pose: "pointing",
        expression: "smirk",
      },
      {
        id: "i2",
        image_path: "https://ref/host-2.jpg",
        pose: "arms-crossed",
        expression: "neutral",
      },
    ],
  };

  describe("channel host character", () => {
    it("attaches the host image as the SECOND reference and points the prompt at it", async () => {
      repo.resolveChannelHost.mockResolvedValue(host);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId: "job-p",
        format: "TECH_COMPARISON",
        channelId: "c1",
        title: "X vs Y",
        archetypeId: "a1",
      });
      expect(res.status).toBe("completed");
      const [prompt, opts] = gateway.requestImageDetailed.mock.calls[0];
      expect(opts.referenceImages).toHaveLength(2);
      expect(opts.referenceImages[0]).toBe("https://ref/a1.jpg");
      expect(host.images.map((i) => i.image_path)).toContain(
        opts.referenceImages[1],
      );
      expect(prompt).toContain("TWO reference images");
      expect(prompt).toContain("SECOND reference image");
      // The row records what was actually sent, so a missing host is visible
      // after the fact instead of being invisible forever.
      const recordArg = repo.createThumbnailRecord.mock.calls[0][1];
      expect(recordArg.reference_paths.archetype).toBe("https://ref/a1.jpg");
      expect(recordArg.reference_paths.persona).toBe(opts.referenceImages[1]);
    });

    it("cycles through the host's images so consecutive variants differ", async () => {
      repo.resolveChannelHost.mockResolvedValue(host);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const used: string[] = [];
      for (const variantIndex of [0, 1]) {
        await requestThumbnail({} as never, {
          subjectKind: "content_job",
          subjectId: "job-cycle",
          format: "TECH_COMPARISON",
          channelId: "c1",
          title: "X vs Y",
          archetypeId: "a1",
          variantIndex,
        });
        const call = gateway.requestImageDetailed.mock.calls.at(-1);
        used.push(call[1].referenceImages[1]);
      }
      // Two variants of one job must not show the same photo of the host — that
      // is the entire reason the owner uploaded several poses per character.
      expect(used[0]).not.toBe(used[1]);
      expect(new Set(used).size).toBe(2);
    });

    it("does not mention a second reference when the channel has no host", async () => {
      repo.resolveChannelHost.mockResolvedValue(undefined);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId: "job-p2",
        format: "TECH_COMPARISON",
        channelId: "c1",
        title: "X vs Y",
        archetypeId: "a1",
      });
      expect(res.status).toBe("completed");
      const [prompt, opts] = gateway.requestImageDetailed.mock.calls[0];
      expect(opts.referenceImages).toEqual(["https://ref/a1.jpg"]);
      expect(prompt).not.toContain("TWO reference images");
    });

    it("refuses a 2-reference request when no configured backend can carry 2", async () => {
      // The exact silent-degradation hole: a backend pin bypasses the
      // gateway's capability filter, so vup would "succeed" with the host's
      // face discarded.
      repo.resolveChannelHost.mockResolvedValue(host);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      gateway.resolveImageChain.mockReturnValue({
        chain: ["vup"],
        configured: ["vup"],
      });
      const res = await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId: "job-p3",
        format: "TECH_COMPARISON",
        channelId: "c1",
        title: "X vs Y",
        archetypeId: "a1",
        backend: "vup",
      });
      expect(res.status).toBe("failed");
      expect(res.error).toContain("reference image(s)");
      expect(res.error).toContain("persona would be discarded");
      expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
    });

    it("does not re-attach the host on an iterate (the base already has them)", async () => {
      repo.resolveChannelHost.mockResolvedValue(host);
      repo.getThumbnailById.mockResolvedValue({
        id: "p1",
        output_path: "https://ref/parent.jpg",
        archetype_id: "a1",
        aspect_ratio: "16:9",
        resolution: "1k",
      });
      const res = await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId: "job-p4",
        format: "OTHER",
        channelId: "c1",
        title: "Anything",
        generationKind: "iterate",
        parentThumbnailId: "11111111-1111-1111-1111-111111111111",
        instructions: "darker background",
      });
      expect(res.status).toBe("completed");
      const [, opts] = gateway.requestImageDetailed.mock.calls[0];
      expect(opts.referenceImages).toEqual(["https://ref/parent.jpg"]);
    });
  });

  // ── The branding contract ────────────────────────────
  // A tutorial video ships on a branded channel with a named host. Producing
  // one without a template or without that face is not a degraded thumbnail,
  // it is the WRONG thumbnail — so it must fail loudly and leave a row.
  describe("branding contract (TUTORIAL_STUDIO)", () => {
    it("refuses a tutorial thumbnail with no channel at all", async () => {
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "tutorial_job",
        subjectId: "job-nb1",
        format: "TUTORIAL_STUDIO",
        title: "How to do a thing",
        archetypeId: "a1",
      });
      expect(res.status).toBe("failed");
      expect(res.error).toContain("no channel is attached");
      expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
      const recorded = repo.createThumbnailRecord.mock.calls[0][1];
      expect(recorded.status).toBe("failed");
    });

    it("refuses a tutorial thumbnail whose channel has no host character", async () => {
      repo.resolveChannelHost.mockResolvedValue(undefined);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "tutorial_job",
        subjectId: "job-nb2",
        format: "TUTORIAL_STUDIO",
        channelId: "c1",
        title: "How to do a thing",
        archetypeId: "a1",
      });
      expect(res.status).toBe("failed");
      expect(res.error).toContain("no host character");
      expect(res.error).toContain("/characters");
      expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
    });

    it("generates when the channel has both a template and a host", async () => {
      repo.resolveChannelHost.mockResolvedValue(host);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "tutorial_job",
        subjectId: "job-nb3",
        format: "TUTORIAL_STUDIO",
        channelId: "c1",
        title: "How to do a thing",
        archetypeId: "a1",
      });
      expect(res.status).toBe("completed");
      const [, opts] = gateway.requestImageDetailed.mock.calls[0];
      expect(opts.referenceImages).toHaveLength(2);
    });

    it("does NOT hold an ad-hoc Studio render to the contract", async () => {
      // Scratch renders never ship; refusing them would break the Studio's own
      // preview button for no benefit.
      repo.resolveChannelHost.mockResolvedValue(undefined);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "studio",
        subjectId: "scratch-1",
        format: "TUTORIAL_STUDIO",
        title: "Playing around",
        archetypeId: "a1",
      });
      expect(res.status).toBe("completed");
    });

    it("does NOT hold an unbranded format to the contract", async () => {
      repo.resolveChannelHost.mockResolvedValue(undefined);
      repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
      const res = await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId: "job-cb",
        format: "TECH_COMPARISON",
        title: "X vs Y",
        archetypeId: "a1",
      });
      expect(res.status).toBe("completed");
    });
  });

  it("refuses with the curation reason rather than substituting an unchosen archetype", async () => {
    // A curated channel whose set resolved to nothing usable. The engine must
    // NOT reach for the global library — the owner's set is exhaustive.
    repo.resolveArchetypeCandidates.mockResolvedValue({
      candidates: [],
      source: "curated",
      tiers: ["base"],
      difficulty: null,
      difficultyNote: "no difficulty signal",
      emptyCurationReason:
        "channel has 7 curated archetype(s) in tier(s) base but none are " +
        "usable (7 inactive, 0 restricted to other formats).",
    });
    const res = await requestThumbnail({} as never, {
      subjectKind: "tutorial_job",
      subjectId: "job-curated",
      format: "TUTORIAL_STUDIO",
      channelId: "c1",
      title: "T",
    });
    expect(res.status).toBe("failed");
    expect(gateway.requestImageDetailed).not.toHaveBeenCalled();
    const recorded = repo.createThumbnailRecord.mock.calls[0][1];
    expect(recorded.status).toBe("failed");
    expect(recorded.error_message).toContain("7 curated archetype(s)");
    expect(recorded.error_message).toContain("7 inactive");
  });

  it("cycles archetypes deterministically: same job -> same archetype, variants differ", async () => {
    // Three distinct archetypes so the cycle has somewhere to go. The pool is
    // resolved from the DB (mocked); the PICK is real arithmetic, which is the
    // point of the test.
    const pool = [
      { ...archetype, id: "a1", name: "A1" },
      { ...archetype, id: "a2", name: "A2" },
      { ...archetype, id: "a3", name: "A3" },
    ];
    repo.resolveArchetypeCandidates.mockResolvedValue({
      candidates: pool,
      source: "curated",
      tiers: ["base"],
      difficulty: null,
      difficultyNote: "no difficulty signal",
      emptyCurationReason: null,
    });

    const pickedFor = async (subjectId: string, variantIndex: number) => {
      repo.createThumbnailRecord.mockClear();
      await requestThumbnail({} as never, {
        subjectKind: "content_job",
        subjectId,
        format: "TECH_COMPARISON",
        channelId: "c1",
        title: "X vs Y",
        variantIndex,
      });
      return repo.createThumbnailRecord.mock.calls[0][1].archetype_id;
    };

    // Reproducible: the same job replayed lands on the same template, so the
    // brief recorded on the row can never describe one that was not used.
    const first = await pickedFor("job-cycle", 0);
    expect(await pickedFor("job-cycle", 0)).toBe(first);

    // A 3-variant batch walks the ring instead of rendering one template 3x.
    const batch = [first, await pickedFor("job-cycle", 1)];
    batch.push(await pickedFor("job-cycle", 2));
    expect(new Set(batch).size).toBe(3);
  });

  it("records failure without throwing when the gateway errors", async () => {
    repo.getThumbnailArchetypeById.mockResolvedValue(archetype);
    gateway.requestImageDetailed.mockRejectedValueOnce(
      new Error("gateway down"),
    );
    const res = await requestThumbnail({} as never, {
      subjectKind: "content_job",
      subjectId: "job2",
      format: "TECH_COMPARISON",
      channelId: "c1",
      title: "X vs Y",
      archetypeId: "a1",
    });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("gateway down");
  });
});
