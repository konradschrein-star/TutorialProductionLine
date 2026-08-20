/**
 * Unit tests for the pure parts of BUSINESS_PLAN_HUB script generation (O4):
 * source-tag parsing, ref classification, sentence-boundary chapter splitting,
 * truncation detection, CTA placement, and the fail-closed gates in
 * `generateBusinessHubScript` driven by a scripted fake LLM.
 *
 * No network, no provider environment: `generateBusinessHubScript` takes its
 * LLM as an argument, so nothing here mocks a module.
 */

import { describe, it, expect } from "vitest";
import {
  BUSINESS_HUB_WPM,
  BusinessHubScriptError,
  assertChapterComplete,
  buildBusinessHubExpansionPrompt,
  buildBusinessHubOutlinePrompt,
  classifySourceRef,
  cleanChapterText,
  ctaPlanFor,
  generateBusinessHubScript,
  parseSourceTags,
  requiredSourceCount,
  splitChapterAtSentences,
  splitSentenceSpans,
  toPlannableScript,
  type BusinessHubLlm,
  type BusinessHubScriptRequest,
} from "../script.js";
import { narrationTextFor, planBusinessHub } from "../planner.js";

const SBA_REF = "sba.gov/document/sop-50-10-business-loan-program#dscr";
const REPO_REF = "packages/finance-kit/src/amortization.ts#monthlyPayment";

// ─────────────────────────────────────────────────────────────────────────────

describe("splitSentenceSpans", () => {
  it("does not split a decimal in half", () => {
    const spans = splitSentenceSpans(
      "Lenders underwrite to 1.25. The number is not arbitrary.",
    );
    expect(spans.map((s) => s.text.trim())).toEqual([
      "Lenders underwrite to 1.25.",
      "The number is not arbitrary.",
    ]);
  });

  it("returns offsets that index back into the original string", () => {
    const text = "First one. Second one.";
    for (const span of splitSentenceSpans(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.text);
    }
  });

  it("returns a trailing fragment rather than dropping it", () => {
    const spans = splitSentenceSpans("Complete sentence. And this one was cut");
    expect(spans).toHaveLength(2);
    expect(spans[1]?.text.trim()).toBe("And this one was cut");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("parseSourceTags", () => {
  it("strips the tag and attributes it to the sentence it follows", () => {
    const raw = `Lenders underwrite to 1.25. [[SOURCE: ${SBA_REF}]] That is the floor.`;
    const parsed = parseSourceTags(raw);

    expect(parsed.narration).toBe(
      "Lenders underwrite to 1.25. That is the floor.",
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.tags).toHaveLength(1);
    expect(parsed.tags[0]?.ref).toBe(SBA_REF);
    expect(parsed.tags[0]?.sentence).toBe("Lenders underwrite to 1.25.");
  });

  it("reports the offset the tag stood at in the stripped narration", () => {
    const raw = `A. [[SOURCE: ${SBA_REF}]] B.`;
    const parsed = parseSourceTags(raw);
    expect(parsed.narration).toBe("A. B.");
    expect(parsed.tags[0]?.charIndex).toBe("A.".length);
  });

  it("is case and whitespace tolerant about the tag itself", () => {
    const parsed = parseSourceTags(`Claim here. [[ source :  ${REPO_REF} ]]`);
    expect(parsed.tags[0]?.ref).toBe(REPO_REF);
    expect(parsed.narration).toBe("Claim here.");
  });

  it("keeps multiple tags in order with their own sentences", () => {
    const raw = `One claim. [[SOURCE: ${SBA_REF}]] Two claim. [[SOURCE: ${REPO_REF}]]`;
    const parsed = parseSourceTags(raw);
    expect(parsed.tags.map((t) => t.ref)).toEqual([SBA_REF, REPO_REF]);
    expect(parsed.tags.map((t) => t.sentence)).toEqual([
      "One claim.",
      "Two claim.",
    ]);
  });

  it("flags a single-bracket near-miss instead of silently ignoring it", () => {
    const parsed = parseSourceTags(`A claim. [SOURCE: ${SBA_REF}]`);
    expect(parsed.tags).toEqual([]);
    expect(parsed.malformed).toHaveLength(1);
  });

  it("does not mistake the inner bracket of a valid tag for a near-miss", () => {
    const parsed = parseSourceTags(`A claim. [[SOURCE: ${SBA_REF}]]`);
    expect(parsed.malformed).toEqual([]);
  });

  it("leaves text with no tags untouched", () => {
    const parsed = parseSourceTags("Nothing cited here at all.");
    expect(parsed.narration).toBe("Nothing cited here at all.");
    expect(parsed.tags).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("classifySourceRef", () => {
  it("accepts an allowlisted government document path", () => {
    const result = classifySourceRef(SBA_REF);
    expect(result).toEqual({
      ok: true,
      source: { kind: "primary", ref: SBA_REF },
    });
  });

  it("accepts a full URL on an allowlisted host, www and all", () => {
    const ref = "https://www.uscis.gov/policy-manual/volume-6-part-g";
    const result = classifySourceRef(ref);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.kind).toBe("primary");
  });

  it("rejects a host that is not on the allowlist", () => {
    const result = classifySourceRef("sbaloans.example.com/dscr-explained");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("allowlist");
  });

  it("rejects a bare domain with no document path", () => {
    const result = classifySourceRef("sba.gov");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("bare domain");
  });

  it("accepts a repo-relative file path with an anchor", () => {
    const result = classifySourceRef(REPO_REF);
    expect(result).toEqual({
      ok: true,
      source: { kind: "repo", ref: REPO_REF },
    });
  });

  it("rejects a repo-ish ref with no file extension", () => {
    const result = classifySourceRef("packages/finance-kit/src/amortization");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty ref", () => {
    expect(classifySourceRef("   ").ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("requiredSourceCount", () => {
  it("is one per two minutes with a floor of three", () => {
    expect(requiredSourceCount(15)).toBe(8);
    expect(requiredSourceCount(4)).toBe(3);
    expect(requiredSourceCount(1)).toBe(3);
  });

  it("throws rather than picking a number for a bad length", () => {
    expect(() => requiredSourceCount(0)).toThrow(BusinessHubScriptError);
    expect(() => requiredSourceCount(Number.NaN)).toThrow(
      BusinessHubScriptError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("splitChapterAtSentences", () => {
  const sentence = (n: number) =>
    `Sentence number ${n} states a rule that a lender applies to your file.`;

  it("leaves a chapter within the overflow factor alone", () => {
    const text = Array.from({ length: 10 }, (_, i) => sentence(i)).join(" ");
    expect(splitChapterAtSentences(text, 2)).toEqual([text]);
  });

  it("splits an overlong chapter, and every chunk ends a sentence", () => {
    const text = Array.from({ length: 120 }, (_, i) => sentence(i)).join(" ");
    const chunks = splitChapterAtSentences(text, 2);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.endsWith(".")).toBe(true);
  });

  it("loses no words when it splits", () => {
    const text = Array.from({ length: 120 }, (_, i) => sentence(i)).join(" ");
    const chunks = splitChapterAtSentences(text, 2);
    const rejoined = chunks.join(" ");
    expect(rejoined.split(/\s+/).length).toBe(text.split(/\s+/).length);
  });

  it("never separates a citation from the sentence it cites", () => {
    const cited = `The ratio is 1.25 on that programme. [[SOURCE: ${SBA_REF}]]`;
    const filler = Array.from({ length: 120 }, (_, i) => sentence(i)).join(" ");
    const chunks = splitChapterAtSentences(`${filler} ${cited}`, 2);
    const withTag = chunks.filter((c) => c.includes("[[SOURCE:"));
    expect(withTag).toHaveLength(1);
    expect(withTag[0]).toContain("The ratio is 1.25 on that programme.");
  });

  it("keeps a mid-chapter citation whole and attached", () => {
    // Regression: the sentence splitter used to treat the dot in "sba.gov" as a
    // terminator, so rejoining chunks produced "sba. gov/..." and the citation
    // no longer resolved.
    const before = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" ");
    const after = Array.from({ length: 60 }, (_, i) => sentence(100 + i)).join(
      " ",
    );
    const cited = `The floor is 1.25 on that programme. [[SOURCE: ${SBA_REF}]]`;
    const chunks = splitChapterAtSentences(`${before} ${cited} ${after}`, 2);
    expect(chunks.join(" ")).toContain(cited);
  });

  it("throws on a non-positive target instead of defaulting", () => {
    expect(() => splitChapterAtSentences("Some text.", 0)).toThrow(
      BusinessHubScriptError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("assertChapterComplete", () => {
  it("accepts a chapter that ends on a full stop", () => {
    expect(() =>
      assertChapterComplete("A complete thought.", { chapterIndex: 0 }),
    ).not.toThrow();
  });

  it("accepts a chapter ending on a citation", () => {
    expect(() =>
      assertChapterComplete(`It is 1.25. [[SOURCE: ${SBA_REF}]]`, {
        chapterIndex: 0,
      }),
    ).not.toThrow();
  });

  it("throws when the provider reports finish_reason=length", () => {
    expect(() =>
      assertChapterComplete("A complete thought.", {
        chapterIndex: 1,
        finishReason: "length",
        maxTokens: 8000,
      }),
    ).toThrow(/TRUNCATED/);
  });

  it("throws on text that ends mid-sentence", () => {
    expect(() =>
      assertChapterComplete("The lender then divides the", { chapterIndex: 2 }),
    ).toThrow(/complete sentence/);
  });

  it("throws on an empty chapter", () => {
    expect(() => assertChapterComplete("   ", { chapterIndex: 0 })).toThrow(
      BusinessHubScriptError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ctaPlanFor", () => {
  it("puts all three moments in a single-chapter video", () => {
    expect(ctaPlanFor(0, 1)).toEqual({
      midRoll: true,
      payoff: true,
      close: true,
    });
  });

  it("assigns each moment exactly once across four chapters", () => {
    const plans = [0, 1, 2, 3].map((i) => ctaPlanFor(i, 4));
    expect(plans.filter((p) => p.midRoll)).toHaveLength(1);
    expect(plans.filter((p) => p.payoff)).toHaveLength(1);
    expect(plans.filter((p) => p.close)).toHaveLength(1);
    expect(plans[0]).toEqual({ midRoll: false, payoff: false, close: false });
    expect(plans[3]).toEqual({ midRoll: false, payoff: true, close: true });
  });

  it("never puts the mid-roll on the same chapter as the payoff", () => {
    for (const total of [2, 3, 4, 5, 6, 8]) {
      for (let i = 0; i < total; i++) {
        const plan = ctaPlanFor(i, total);
        expect(plan.midRoll && plan.payoff).toBe(false);
      }
    }
  });

  it("throws on an out-of-range index", () => {
    expect(() => ctaPlanFor(4, 4)).toThrow(BusinessHubScriptError);
    expect(() => ctaPlanFor(-1, 4)).toThrow(BusinessHubScriptError);
    expect(() => ctaPlanFor(0, 0)).toThrow(BusinessHubScriptError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("cleanChapterText", () => {
  it("drops a leading chapter heading", () => {
    const result = cleanChapterText(
      "Chapter 2: The coverage ratio\n\nThe lender divides cash flow by debt service.",
    );
    expect(result.text).toBe("The lender divides cash flow by debt service.");
    expect(result.removed).toContain("chapter-heading");
  });

  it("keeps a real sentence that happens to start with Section", () => {
    const input =
      "Section 3 of the SOP is where this lives.\n\nRead it before you write.";
    expect(cleanChapterText(input).text).toBe(input);
  });

  it("strips markdown and converts a dash pause to a comma", () => {
    const result = cleanChapterText(
      "The **coverage ratio** — the number lenders check — is first.",
    );
    expect(result.text).toBe(
      "The coverage ratio, the number lenders check, is first.",
    );
  });

  it("leaves a source tag intact", () => {
    const input = `The floor is 1.25. [[SOURCE: ${SBA_REF}]]`;
    expect(cleanChapterText(input).text).toBe(input);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("prompt builders", () => {
  const request: BusinessHubScriptRequest = {
    topic: "how to write a business plan for an SBA 7(a) loan",
    family: "how-to-write-for",
  };

  it("asks the outline for exactly N chapters and forbids a recap chapter", () => {
    const prompt = buildBusinessHubOutlinePrompt(request, 4, 4);
    expect(prompt).toContain("EXACTLY 4 chapters");
    expect(prompt).toContain("NO RECAP CHAPTER");
    expect(prompt).toContain('{"parts":[{"title":"...","summary":"..."}]}');
    expect(prompt).toContain(request.topic);
  });

  it("gives a middle chapter a hard word ceiling and no CTA", () => {
    const prompt = buildBusinessHubExpansionPrompt(
      request,
      { title: "Cash flow", summary: "how the ratio is built" },
      4,
      { index: 2, total: 4 },
      [{ title: "The answer", summary: "the direct answer" }],
    );
    expect(prompt).toContain(
      `HARD CEILING: ${Math.round(4 * BUSINESS_HUB_WPM * 1.1)} words`,
    );
    expect(prompt).toContain("NO CTA IN THIS CHAPTER");
    expect(prompt).toContain("CHAPTERS ALREADY WRITTEN");
    expect(prompt).toContain("MIDDLE chapter");
  });

  it("gives the final chapter the payoff and the close", () => {
    const prompt = buildBusinessHubExpansionPrompt(
      request,
      { title: "Last", summary: "the last material" },
      4,
      { index: 3, total: 4 },
      [],
    );
    expect(prompt).toContain("free business plan checker");
    expect(prompt).toContain("CTA MOMENT, CLOSE");
    expect(prompt).not.toContain("NO CTA IN THIS CHAPTER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End to end, with a scripted fake LLM.
// ─────────────────────────────────────────────────────────────────────────────

const OUTLINE_JSON = JSON.stringify({
  parts: [
    { title: "The direct answer", summary: "answer the query in full" },
    { title: "What the lender checks", summary: "the underwriting gates" },
  ],
});

/** ~240 words, terminal punctuation, `citations` citations at the front. */
function fakeChapter(seed: number, citations: readonly string[]): string {
  const cited = citations
    .map(
      (ref, i) =>
        `Rule ${seed}${i} sets the threshold a lender applies. [[SOURCE: ${ref}]]`,
    )
    .join(" ");
  const filler = Array.from(
    { length: 20 },
    (_, i) =>
      `Point ${seed}${i} explains what to write in that part of the plan today.`,
  ).join(" ");
  return `${cited} ${filler}`;
}

function fakeLlm(
  chapters: readonly string[],
  outline = OUTLINE_JSON,
): BusinessHubLlm {
  let chapterCalls = 0;
  return async (request) => {
    if (request.purpose === "outline") return { text: outline };
    const text = chapters[chapterCalls];
    chapterCalls += 1;
    if (text === undefined) {
      throw new Error(`fake LLM has no chapter ${chapterCalls}`);
    }
    return { text };
  };
}

const baseRequest: BusinessHubScriptRequest = {
  topic: "what lenders check in an SBA 7(a) business plan",
  family: "what-they-check",
  targetMinutes: 4,
  chapterMinutes: 2,
};

describe("generateBusinessHubScript", () => {
  it("assembles the chapters and returns resolved citations", async () => {
    const llm = fakeLlm([
      fakeChapter(1, [SBA_REF, REPO_REF]),
      fakeChapter(2, [SBA_REF, "uscis.gov/policy-manual/volume-6"]),
    ]);
    const result = await generateBusinessHubScript(baseRequest, llm);

    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]?.title).toBe("The direct answer");
    expect(result.sources).toHaveLength(4);
    expect(result.sources.map((s) => s.source.kind)).toEqual([
      "primary",
      "repo",
      "primary",
      "primary",
    ]);
    // The script that goes to TTS carries no tags.
    expect(result.script).not.toContain("[[SOURCE:");
    expect(result.script).not.toContain("[");
    expect(result.wordCount).toBeGreaterThan(400);
    expect(result.outline).toHaveLength(2);
  });

  it("reports each citation's offset into the assembled script", async () => {
    const llm = fakeLlm([
      fakeChapter(1, [SBA_REF, REPO_REF]),
      fakeChapter(2, [SBA_REF, REPO_REF]),
    ]);
    const result = await generateBusinessHubScript(baseRequest, llm);
    for (const source of result.sources) {
      // The tag stood at the end of its sentence, so the sentence text must
      // appear immediately before the recorded offset.
      const before = result.script.slice(0, source.charIndex);
      expect(before.endsWith(source.sentence)).toBe(true);
    }
  });

  it("throws when a chapter ends mid-sentence", async () => {
    const llm = fakeLlm([
      fakeChapter(1, [SBA_REF, REPO_REF]),
      "The lender then divides the",
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /complete sentence/,
    );
  });

  it("throws on a citation that resolves to nothing", async () => {
    const llm = fakeLlm([
      fakeChapter(1, ["blogspot.example.com/why-1-25"]),
      fakeChapter(2, [SBA_REF, REPO_REF]),
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /allowlist/,
    );
  });

  it("throws on a malformed citation rather than letting TTS speak it", async () => {
    const llm = fakeLlm([
      `A rule applies here. [SOURCE: ${SBA_REF}] ${fakeChapter(1, [SBA_REF])}`,
      fakeChapter(2, [SBA_REF, REPO_REF]),
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /malformed citation/,
    );
  });

  it("throws on bracketed stage directions", async () => {
    const llm = fakeLlm([
      `[pause for effect] ${fakeChapter(1, [SBA_REF])}`,
      fakeChapter(2, [SBA_REF, REPO_REF]),
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /not a source tag/,
    );
  });

  it("throws when the script is under the citation floor", async () => {
    const llm = fakeLlm([
      fakeChapter(1, [SBA_REF]),
      fakeChapter(2, [REPO_REF]),
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /at least 3/,
    );
  });

  it("throws when the assembled script is far under target", async () => {
    const llm = fakeLlm([
      `Short one. [[SOURCE: ${SBA_REF}]]`,
      `Short two. [[SOURCE: ${REPO_REF}]]`,
    ]);
    await expect(generateBusinessHubScript(baseRequest, llm)).rejects.toThrow(
      /failed generation/,
    );
  });

  it("rejects a request with no topic instead of deriving one", async () => {
    const llm = fakeLlm([]);
    await expect(
      generateBusinessHubScript({ ...baseRequest, topic: "  " }, llm),
    ).rejects.toThrow(/needs a topic/);
  });

  it("rejects a chapter longer than the whole video", async () => {
    const llm = fakeLlm([]);
    await expect(
      generateBusinessHubScript(
        { ...baseRequest, targetMinutes: 4, chapterMinutes: 9 },
        llm,
      ),
    ).rejects.toThrow(/exceeds targetMinutes/);
  });

  it("splits an overlong chapter and marks the continuation", async () => {
    const long = `${fakeChapter(1, [SBA_REF, REPO_REF])} ${fakeChapter(3, [SBA_REF])} ${fakeChapter(4, [REPO_REF])}`;
    const llm = fakeLlm([long, fakeChapter(2, [SBA_REF, REPO_REF])]);
    const result = await generateBusinessHubScript(baseRequest, llm);
    expect(result.chapters.length).toBeGreaterThan(2);
    expect(result.chapters[1]?.title).toBe("The direct answer (continued)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generator output -> planner grammar (the O4/O1 contract seam)
// ─────────────────────────────────────────────────────────────────────────────

describe("toPlannableScript", () => {
  /** A chapter with real paragraph structure, so beats are distinguishable. */
  function fakeChapterParagraphs(
    seed: number,
    citations: readonly string[],
  ): string {
    const cited = citations
      .map(
        (ref, i) =>
          `Rule ${seed}${i} sets the threshold a lender applies. [[SOURCE: ${ref}]]`,
      )
      .join(" ");
    const paragraph = (n: number) =>
      Array.from(
        { length: 8 },
        (_, i) =>
          `Point ${seed}${n}${i} explains what to write in that part of the plan today.`,
      ).join(" ");
    return [`${cited} ${paragraph(0)}`, paragraph(1), paragraph(2)].join(
      "\n\n",
    );
  }

  async function generated() {
    const llm = fakeLlm([
      fakeChapterParagraphs(1, [SBA_REF, REPO_REF]),
      fakeChapterParagraphs(2, [SBA_REF, REPO_REF]),
    ]);
    return generateBusinessHubScript(baseRequest, llm);
  }

  it("annotates a generated script so the scene planner can compile it", async () => {
    const annotated = toPlannableScript(await generated());

    // The planner's own pre-flight: exactly one [hook] and one [close].
    expect(annotated.match(/^\s*\[hook\]/gim)).toHaveLength(1);
    expect(annotated.match(/^\s*\[close\]/gim)).toHaveLength(1);
    // Later chapters open with their outline title.
    expect(annotated).toContain("[chapter: What the lender checks]");
  });

  it("carries the resolved citations across as [source:] directives", async () => {
    const result = await generated();
    const annotated = toPlannableScript(result);
    const directives = annotated.match(/\[source: [^\]]+\]/g) ?? [];
    expect(directives.length).toBeGreaterThan(0);
    for (const directive of directives) {
      // "[source: <kind> <ref>]" — the exact grammar parseSourceDirective takes.
      expect(directive).toMatch(/^\[source: (repo|primary) \S+\]$/);
    }
  });

  it("invents no figure or document beat", async () => {
    const annotated = toPlannableScript(await generated());
    expect(annotated).not.toContain("[fig:");
    expect(annotated).not.toContain("[element:");
    expect(annotated).not.toContain("[doc:");
  });

  it("changes no narration — only the directives are added", async () => {
    const result = await generated();
    const annotated = toPlannableScript(result);
    const spoken = annotated
      .split(/\n{2,}/)
      .map((beat) => beat.replace(/^(\s*\[[^\]]*\])+\s*/, "").trim())
      .join("\n\n");
    const original = result.script
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0)
      .join("\n\n");
    expect(spoken).toBe(original);
  });

  it("refuses a script too short to have a distinct hook and close", () => {
    expect(() =>
      toPlannableScript({
        script: "one paragraph",
        chapters: [
          {
            index: 0,
            title: "Only",
            summary: "only",
            narration: "one paragraph",
            words: 2,
          },
        ],
        sources: [],
        wordCount: 2,
        estimatedMinutes: 0.01,
        outline: [],
      }),
    ).toThrow(/at least two paragraphs/);
  });
});

/**
 * The seam itself: a script this repo GENERATED must be one this repo's own
 * planner can compile. It could not, before — the pipeline threw one call after
 * paying for the generation, and no BUSINESS_PLAN_HUB job could run without a
 * hand-authored script. This test is the regression guard on that.
 */
describe("generated script -> scene planner", () => {
  it("plans a generated script end to end, and narrates it without the directives", async () => {
    const llm = fakeLlm([
      [
        `Rule 10 sets the threshold a lender applies. [[SOURCE: ${SBA_REF}]] ` +
          Array.from(
            { length: 16 },
            (_, i) => `Point 10${i} explains what to write in the plan today.`,
          ).join(" "),
        `Rule 11 is checked before anything else. [[SOURCE: ${SBA_REF}]] ` +
          Array.from(
            { length: 16 },
            (_, i) => `Point 11${i} explains what the underwriter reads first.`,
          ).join(" "),
      ].join("\n\n"),
      [
        `Rule 20 sets the threshold a lender applies. [[SOURCE: ${REPO_REF}]] ` +
          Array.from(
            { length: 16 },
            (_, i) => `Point 20${i} explains the cash-flow test in detail.`,
          ).join(" "),
        `Rule 21 decides the final approval. [[SOURCE: ${REPO_REF}]] ` +
          Array.from(
            { length: 16 },
            (_, i) => `Point 21${i} explains how to close the application out.`,
          ).join(" "),
      ].join("\n\n"),
    ]);
    const annotated = toPlannableScript(
      await generateBusinessHubScript(baseRequest, llm),
    );

    const plan = planBusinessHub({
      topic: baseRequest.topic,
      family: baseRequest.family,
      script: annotated,
      targetSeconds: 240,
      figures: {},
      poses: [],
      aspect: "16:9",
      // No figure directives are emitted, so no pose is needed either; the
      // presenter variant is exercised in planner.test.ts.
      placePresenter: false,
    });
    expect(plan.scenes.length).toBeGreaterThanOrEqual(4);

    // The voice must never be handed the directives.
    const spoken = narrationTextFor(annotated);
    expect(spoken).not.toContain("[hook]");
    expect(spoken).not.toContain("[close]");
    expect(spoken).not.toContain("[chapter:");
    expect(spoken).not.toContain("[source:");
    // ...and what is spoken is exactly what the scenes are timed against.
    expect(spoken).toBe(
      plan.scenes.map((scene) => scene.narration).join("\n\n"),
    );
  });
});
