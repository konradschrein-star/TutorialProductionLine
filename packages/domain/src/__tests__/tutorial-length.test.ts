import { describe, it, expect } from "vitest";
import {
  countSteps,
  modeForMinutes,
  stepCountAdvice,
  labelForMode,
  parseLengthBucket,
  planForMinutes,
  tutorialLengthPlan,
  MAX_TARGET_MINUTES,
} from "../tutorial-length.js";

/**
 * "In most cases the VAs have no idea how long a video should be." The rule has
 * to be right in BOTH directions: padding a short topic wastes the viewer, and
 * compressing a long one produces a list of clicks — the 195-word script this
 * codebase already shipped once.
 */
describe("countSteps", () => {
  it("counts real actions, not blank or stub lines", () => {
    expect(countSteps("Open Expenses\n\n  \nab\nClick New Expense")).toBe(2);
  });

  it("ignores list markers the operator pasted in", () => {
    expect(
      countSteps("1. Open Expenses\n- Click New Expense\n* Choose Distance"),
    ).toBe(3);
  });

  it("is zero for an empty box rather than throwing", () => {
    expect(countSteps("")).toBe(0);
    expect(countSteps("   \n\n")).toBe(0);
  });
});

describe("modeForMinutes", () => {
  it("only reaches for six minutes when the topic supports it", () => {
    expect(modeForMinutes(6)).toBe("SIX_MIN");
    expect(modeForMinutes(4.5)).toBe("SIX_MIN");
    // Below the threshold six minutes would need ~25% padding to hit its floor.
    expect(modeForMinutes(4.4)).toBe("THREE_MIN");
    expect(modeForMinutes(2)).toBe("THREE_MIN");
  });
});

describe("stepCountAdvice", () => {
  const steps = (n: number) =>
    Array.from({ length: n }, (_, i) => `Do the thing number ${i + 1}`).join(
      "\n",
    );

  it("recommends six minutes for a long workflow", () => {
    const a = stepCountAdvice(steps(12));
    expect(a.mode).toBe("SIX_MIN");
    expect(a.reason).toContain("12");
  });

  it("recommends three for a short one rather than padding it", () => {
    expect(stepCountAdvice(steps(3)).mode).toBe("THREE_MIN");
  });

  it("does not pretend to know anything from an empty box", () => {
    const a = stepCountAdvice("");
    expect(a.mode).toBe("THREE_MIN");
    expect(a.reason).toContain("No steps listed yet");
  });

  it("always labels a line count as a line count", () => {
    // It must never be presented as editorial judgement.
    expect(stepCountAdvice(steps(9)).source).toBe("step-count");
  });

  it("gives a VA words, not an enum", () => {
    expect(labelForMode("SIX_MIN")).toBe("6-Minute Tutorial");
    expect(labelForMode("THREE_MIN")).toBe("3-Minute Tutorial");
    expect(labelForMode("SIX_MIN_STITCH")).toContain("Stitch");
    expect(labelForMode("LONG_FORM")).toContain("Long-form");
    expect(labelForMode("SHORT_MATCH")).toContain("Match");
    expect(labelForMode("SHORT_PLUS")).toContain("Plus");
  });
});

describe("parseLengthBucket", () => {
  it("reads every bucket the Keyword Tool actually emits", () => {
    // Verified against prod: SELECT length_class, count(*) FROM kt_keywords.
    for (const label of [
      "SHORT",
      "<3min",
      "3-6min",
      "6-10min",
      "10-20min",
      "20-40min",
      "40-60min",
      "1-2hr",
      "2hr+",
    ]) {
      expect(parseLengthBucket(label), label).not.toBeNull();
    }
  });

  it("leaves the top bucket open-ended rather than inventing a ceiling", () => {
    expect(parseLengthBucket("2hr+")?.maxMinutes).toBeNull();
  });

  it("is null for nothing and for a label it does not know", () => {
    expect(parseLengthBucket(null)).toBeNull();
    expect(parseLengthBucket("")).toBeNull();
    expect(parseLengthBucket("medium-ish")).toBeNull();
  });
});

describe("planForMinutes", () => {
  it("maps minutes onto the four script shapes", () => {
    expect(planForMinutes(2).mode).toBe("THREE_MIN");
    expect(planForMinutes(5).mode).toBe("SIX_MIN");
    expect(planForMinutes(13).mode).toBe("SIX_MIN_STITCH");
    expect(planForMinutes(45).mode).toBe("LONG_FORM");
  });

  it("only sends target_minutes for the modes that honour it", () => {
    // THREE_MIN/SIX_MIN hardcode their length in the worker's
    // targetMinutesForMode — sending a number there would be a lie.
    expect(planForMinutes(2).targetMinutes).toBeNull();
    expect(planForMinutes(5).targetMinutes).toBeNull();
    expect(planForMinutes(13).targetMinutes).toBe(13);
    expect(planForMinutes(45).targetMinutes).toBe(45);
  });

  it("gives LONG_FORM a part length and nothing else one", () => {
    expect(planForMinutes(45).partLengthMinutes).toBe(8);
    expect(planForMinutes(13).partLengthMinutes).toBeNull();
  });

  it("caps rather than asking a VA to record four hours", () => {
    expect(planForMinutes(240).targetMinutes).toBe(MAX_TARGET_MINUTES);
  });
});

describe("tutorialLengthPlan", () => {
  it("THE REGRESSION: a 10-20min keyword never becomes a 3-minute script", () => {
    // The owner's exact case — a 13-minute reference video, and a VA who has
    // typed two steps. The step count used to win and select THREE_MIN.
    const plan = tutorialLengthPlan({
      lengthClass: "10-20min",
      durationSec: 803,
      stepsInput: "Open the app\nClick record",
    });
    expect(plan?.mode).toBe("SIX_MIN_STITCH");
    expect(plan?.targetMinutes).toBe(13);
    expect(plan?.source).toBe("keyword");
  });

  it("clamps a short step count up into the keyword's bucket", () => {
    // duration_sec missing, so the steps are the only number — and they must
    // still not drag the plan below what the bucket says.
    const plan = tutorialLengthPlan({
      lengthClass: "10-20min",
      durationSec: null,
      stepsInput: "One step here",
    });
    expect(plan?.mode).toBe("SIX_MIN_STITCH");
    expect(plan!.targetMinutes!).toBeGreaterThanOrEqual(10);
  });

  it("prefers a fetched transcript over the bucket midpoint", () => {
    const plan = tutorialLengthPlan({
      lengthClass: "10-20min",
      durationSec: null,
      transcriptWordCount: 2132, // the real Ableton reference video
    });
    expect(plan?.source).toBe("transcript");
    expect(plan?.mode).toBe("SIX_MIN_STITCH");
    expect(plan?.targetMinutes).toBe(14);
  });

  it("ignores a transcript too short to measure anything", () => {
    const plan = tutorialLengthPlan({
      lengthClass: "10-20min",
      transcriptWordCount: 12,
    });
    expect(plan?.source).toBe("keyword");
  });

  it("still lets a genuinely short keyword be short", () => {
    const plan = tutorialLengthPlan({ lengthClass: "<3min", durationSec: 120 });
    expect(plan?.mode).toBe("THREE_MIN");
    expect(plan?.targetMinutes).toBeNull();
  });

  it("routes the very long buckets to the chapter-by-chapter shape", () => {
    expect(
      tutorialLengthPlan({ lengthClass: "20-40min", durationSec: 1800 })?.mode,
    ).toBe("LONG_FORM");
    expect(
      tutorialLengthPlan({ lengthClass: "40-60min", durationSec: 3000 })?.mode,
    ).toBe("LONG_FORM");
    expect(
      tutorialLengthPlan({ lengthClass: "2hr+", durationSec: 40430 })
        ?.targetMinutes,
    ).toBe(MAX_TARGET_MINUTES);
  });

  it("falls back to the steps when there is no keyword at all", () => {
    const plan = tutorialLengthPlan({
      stepsInput: Array.from({ length: 12 }, (_, i) => `Do thing ${i}`).join(
        "\n",
      ),
    });
    expect(plan?.source).toBe("step-count");
    expect(plan?.mode).toBe("SIX_MIN");
  });

  it("says nothing rather than guessing when nothing is known", () => {
    expect(tutorialLengthPlan({})).toBeNull();
    expect(tutorialLengthPlan({ stepsInput: "   " })).toBeNull();
  });

  it("says out loud when it overrode the evidence", () => {
    const plan = tutorialLengthPlan({
      lengthClass: "10-20min",
      stepsInput: "One step",
    });
    expect(plan?.reason).toContain("10-20min");
  });
});
