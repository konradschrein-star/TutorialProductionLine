import { describe, it, expect } from "vitest";
import {
  languageSegment,
  planJobFolder,
  planTutorialFolder,
  planClipForgeFolder,
} from "../folder-scheme.js";

const AT = new Date("2026-07-28T12:00:00Z");

describe("languageSegment", () => {
  it("treats null / undefined / en as the English original (no subfolder)", () => {
    expect(languageSegment(null)).toBeNull();
    expect(languageSegment(undefined)).toBeNull();
    expect(languageSegment("en")).toBeNull();
    expect(languageSegment("EN")).toBeNull();
    expect(languageSegment("en-US")).toBeNull();
  });

  it("lowercases and keeps region codes", () => {
    expect(languageSegment("DE")).toBe("de");
    expect(languageSegment("pt-BR")).toBe("pt-br");
    expect(languageSegment("es")).toBe("es");
  });

  it("strips junk", () => {
    expect(languageSegment("d e!")).toBe("de");
    expect(languageSegment("///")).toBeNull();
  });
});

describe("planJobFolder language variants", () => {
  const base = {
    jobId: "a1b2c3d4-0000-0000-0000-000000000000",
    title: "Why Cats Knock Things Over",
    channelName: "Casually Explained",
    completedAt: AT,
  };

  it("keeps the English original at the leaf root", () => {
    const plan = planJobFolder(base);
    expect(plan.segments).toEqual([
      "Content Forge",
      "Casually Explained",
      "2026-07",
      "2026-07-28__why-cats-knock-things-over__a1b2c3d4",
    ]);
    expect(plan.segments.at(-1)).not.toMatch(/\/en$/);
  });

  it("en / null adds no subfolder", () => {
    expect(planJobFolder({ ...base, languageCode: "en" }).segments).toHaveLength(
      4,
    );
    expect(planJobFolder({ ...base, languageCode: null }).segments).toHaveLength(
      4,
    );
  });

  it("a variant appends one language segment under the ORIGINAL folder name", () => {
    const plan = planJobFolder({
      ...base,
      jobId: "ffffffff-0000-0000-0000-000000000000",
      title: "Warum Katzen Dinge Umwerfen",
      languageCode: "de",
      sourceJobId: base.jobId,
      sourceTitle: base.title,
    });
    expect(plan.segments).toEqual([
      "Content Forge",
      "Casually Explained",
      "2026-07",
      // leaf derived from the ORIGINAL job so variants group together
      "2026-07-28__why-cats-knock-things-over__a1b2c3d4",
      "de",
    ]);
  });
});

describe("tutorial + clip forge trees are separate roots", () => {
  it("tutorials live under _Tutorials", () => {
    const plan = planTutorialFolder({
      jobId: "f00dcafe-0000-0000-0000-000000000000",
      title: "How To X",
      channelName: "DevChannel",
      completedAt: AT,
    });
    expect(plan.segments[0]).toBe("_Tutorials");
  });

  it("groups uploader-ready tutorial variants under one bundle leaf", () => {
    const sourceId = "f00dcafe-0000-0000-0000-000000000000";
    const english = planTutorialFolder({
      jobId: sourceId,
      title: "How To X",
      channelName: "USA Tutorials",
      completedAt: AT,
      languageCode: "en",
      bundleFolderName: "Upload Bundles",
    });
    const german = planTutorialFolder({
      jobId: "de000000-0000-0000-0000-000000000000",
      title: "So geht X",
      channelName: "German Tutorials",
      completedAt: AT,
      sourceJobId: sourceId,
      sourceTitle: "How To X",
      languageCode: "de",
      bundleFolderName: "Upload Bundles",
    });
    expect(german.segments.slice(0, -1)).toEqual(english.segments);
    expect(german.segments.at(-1)).toBe("de");
  });

  it("clip forge lives in its own root, never nested in Content Forge", () => {
    const plan = planClipForgeFolder({
      clipId: "c1000000-0000-0000-0000-000000000000",
      slug: "marc-clip",
      ownerName: "Marc Gebauer",
      completedAt: AT,
    });
    expect(plan.segments[0]).toBe("Clip Forge");
    expect(plan.segments).not.toContain("Content Forge");
  });
});
