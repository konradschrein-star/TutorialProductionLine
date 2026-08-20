import { describe, it, expect } from "vitest";
import {
  buildMetadataSidecar,
  dayStamp,
  monthFolder,
  planJobFolder,
  planTutorialFolder,
  rootFolderForFormat,
  sanitizeChannelFolder,
  shortJobId,
  slugifyTitle,
  DEFAULT_COMPARISONS_FOLDER_NAME,
  DEFAULT_ROOT_FOLDER_NAME,
  DEFAULT_TUTORIALS_FOLDER_NAME,
  UNKNOWN_CHANNEL_FOLDER,
} from "../folder-scheme.js";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Why Cats Knock Things Over")).toBe(
      "why-cats-knock-things-over",
    );
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugifyTitle("Uber die Bruecke")).toBe("uber-die-bruecke");
    expect(slugifyTitle("über café")).toBe("uber-cafe");
  });

  it("collapses punctuation and trims stray hyphens", () => {
    expect(slugifyTitle("  !!Hello -- World!!  ")).toBe("hello-world");
  });

  it("falls back to 'untitled' for empty or symbol-only input", () => {
    expect(slugifyTitle("")).toBe("untitled");
    expect(slugifyTitle("!!!")).toBe("untitled");
    expect(slugifyTitle("   ")).toBe("untitled");
  });

  it("truncates on a word boundary when one is close to the limit", () => {
    const slug = slugifyTitle("alpha beta gamma delta epsilon zeta", 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug).toBe("alpha-beta-gamma");
    expect(slug.endsWith("-")).toBe(false);
  });

  it("hard-cuts a single long word rather than returning nothing", () => {
    const slug = slugifyTitle("supercalifragilisticexpialidocious", 10);
    expect(slug).toBe("supercalif");
  });
});

describe("sanitizeChannelFolder", () => {
  it("keeps readable casing and spaces", () => {
    expect(sanitizeChannelFolder("Casually Explained")).toBe(
      "Casually Explained",
    );
  });

  it("strips path-ish and Drive-hostile characters", () => {
    expect(sanitizeChannelFolder('Tech / Compare: "X" ?')).toBe(
      "Tech Compare X",
    );
  });

  it("falls back for null, undefined and blank", () => {
    expect(sanitizeChannelFolder(null)).toBe(UNKNOWN_CHANNEL_FOLDER);
    expect(sanitizeChannelFolder(undefined)).toBe(UNKNOWN_CHANNEL_FOLDER);
    expect(sanitizeChannelFolder("   ")).toBe(UNKNOWN_CHANNEL_FOLDER);
    expect(sanitizeChannelFolder("///")).toBe(UNKNOWN_CHANNEL_FOLDER);
  });

  it("caps the length", () => {
    expect(sanitizeChannelFolder("a".repeat(300)).length).toBe(100);
  });
});

describe("date folders", () => {
  it("uses UTC, not local time", () => {
    // 23:30 on the 31st in UTC+2 is still the 31st in UTC.
    const d = new Date("2026-07-31T23:30:00Z");
    expect(monthFolder(d)).toBe("2026-07");
    expect(dayStamp(d)).toBe("2026-07-31");
  });

  it("zero-pads months and days", () => {
    const d = new Date("2026-01-05T00:00:00Z");
    expect(monthFolder(d)).toBe("2026-01");
    expect(dayStamp(d)).toBe("2026-01-05");
  });
});

describe("shortJobId", () => {
  it("takes 8 hex chars with hyphens removed", () => {
    expect(shortJobId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("a1b2c3d4");
  });
});

describe("planJobFolder", () => {
  const base = {
    jobId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    title: "Why Cats Knock Things Over",
    channelName: "Casually Explained",
    completedAt: new Date("2026-07-28T10:00:00Z"),
  };

  it("builds the documented four-level scheme", () => {
    const plan = planJobFolder(base);
    expect(plan.segments).toEqual([
      "Content Forge",
      "Casually Explained",
      "2026-07",
      "2026-07-28__why-cats-knock-things-over__a1b2c3d4",
    ]);
    expect(plan.path).toBe(
      "Content Forge/Casually Explained/2026-07/2026-07-28__why-cats-knock-things-over__a1b2c3d4",
    );
  });

  it("honours a custom root folder name", () => {
    const plan = planJobFolder({ ...base, rootFolderName: "CF Archive" });
    expect(plan.segments[0]).toBe("CF Archive");
  });

  it("stays unique for two same-day jobs with an identical title", () => {
    const a = planJobFolder(base);
    const b = planJobFolder({
      ...base,
      jobId: "ffffffff-0000-0000-0000-000000000000",
    });
    expect(a.path).not.toBe(b.path);
  });

  it("does not blow up on a null title or channel", () => {
    const plan = planJobFolder({ ...base, title: null, channelName: null });
    expect(plan.segments[1]).toBe(UNKNOWN_CHANNEL_FOLDER);
    expect(plan.segments[3]).toBe("2026-07-28__untitled__a1b2c3d4");
  });
});

describe("rootFolderForFormat", () => {
  it("routes TECH_COMPARISON to its own top-level tree", () => {
    expect(rootFolderForFormat("TECH_COMPARISON")).toBe(
      DEFAULT_COMPARISONS_FOLDER_NAME,
    );
  });

  it("leaves every other format in the content root", () => {
    expect(rootFolderForFormat("CASUALLY_EXPLAINED")).toBe(
      DEFAULT_ROOT_FOLDER_NAME,
    );
    expect(rootFolderForFormat("EXPLAINER")).toBe(DEFAULT_ROOT_FOLDER_NAME);
  });

  it("falls back to the content root for null/empty/unknown formats", () => {
    // An unrecognised format must NOT invent a folder — it would silently
    // scatter deliverables into trees nobody is watching.
    expect(rootFolderForFormat(null)).toBe(DEFAULT_ROOT_FOLDER_NAME);
    expect(rootFolderForFormat(undefined)).toBe(DEFAULT_ROOT_FOLDER_NAME);
    expect(rootFolderForFormat("   ")).toBe(DEFAULT_ROOT_FOLDER_NAME);
    expect(rootFolderForFormat("NOT_A_REAL_FORMAT")).toBe(
      DEFAULT_ROOT_FOLDER_NAME,
    );
  });

  it("honours an override map and a custom default root", () => {
    expect(
      rootFolderForFormat("RANKING", "Custom Root", { RANKING: "_Rankings" }),
    ).toBe("_Rankings");
    expect(
      rootFolderForFormat("EXPLAINER", "Custom Root", { RANKING: "_Rankings" }),
    ).toBe("Custom Root");
  });
});

describe("planJobFolder — format routing", () => {
  const base = {
    jobId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    title: "iPhone 17 vs Pixel 11",
    channelName: "Gadget Desk",
    completedAt: new Date("2026-07-28T12:00:00Z"),
  };

  it("puts TECH_COMPARISON under _Comparisons, keeping the rest of the tree", () => {
    const plan = planJobFolder({ ...base, format: "TECH_COMPARISON" });
    expect(plan.segments[0]).toBe(DEFAULT_COMPARISONS_FOLDER_NAME);
    expect(plan.path).toBe(
      "_Comparisons/Gadget Desk/2026-07/2026-07-28__iphone-17-vs-pixel-11__a1b2c3d4",
    );
  });

  it("keeps a normal content format in Content Forge", () => {
    const plan = planJobFolder({ ...base, format: "CASUALLY_EXPLAINED" });
    expect(plan.segments[0]).toBe(DEFAULT_ROOT_FOLDER_NAME);
  });

  it("keeps a null format in Content Forge (unchanged legacy behaviour)", () => {
    expect(planJobFolder({ ...base }).segments[0]).toBe(
      DEFAULT_ROOT_FOLDER_NAME,
    );
    expect(planJobFolder({ ...base, format: null }).segments[0]).toBe(
      DEFAULT_ROOT_FOLDER_NAME,
    );
  });

  it("still appends the language segment inside the comparison tree", () => {
    const plan = planJobFolder({
      ...base,
      format: "TECH_COMPARISON",
      languageCode: "de",
    });
    expect(plan.segments[0]).toBe(DEFAULT_COMPARISONS_FOLDER_NAME);
    expect(plan.segments.at(-1)).toBe("de");
  });

  it("gives comparisons, tutorials and content three distinct roots", () => {
    const roots = new Set([
      planJobFolder({ ...base, format: "TECH_COMPARISON" }).segments[0],
      planJobFolder({ ...base, format: "CASUALLY_EXPLAINED" }).segments[0],
      planTutorialFolder(base).segments[0],
    ]);
    expect(roots).toEqual(
      new Set([
        DEFAULT_COMPARISONS_FOLDER_NAME,
        DEFAULT_ROOT_FOLDER_NAME,
        DEFAULT_TUTORIALS_FOLDER_NAME,
      ]),
    );
  });
});

describe("buildMetadataSidecar", () => {
  it("stamps a version and a generation time", () => {
    const sidecar = buildMetadataSidecar(
      {
        content_forge_job_id: "job-1",
        title: "T",
        description: null,
        format: "CASUALLY_EXPLAINED",
        channel_id: "chan-1",
        channel_name: "Casually Explained",
        render_completed_at: "2026-07-28T10:00:00.000Z",
        duration_seconds: 300,
        size_bytes: 12345,
        sha256: "abc",
        vps_path: "/opt/content-forge/media/chan-1/job-1/final_video.mp4",
      },
      new Date("2026-07-28T11:00:00Z"),
    );
    expect(sidecar.schema_version).toBe(1);
    expect(sidecar.generated_at).toBe("2026-07-28T11:00:00.000Z");
    expect(sidecar.content_forge_job_id).toBe("job-1");
  });
});
