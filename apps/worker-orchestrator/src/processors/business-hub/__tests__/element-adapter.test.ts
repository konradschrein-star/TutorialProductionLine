import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  BUSINESS_HUB_MG_ELEMENT_NAMES,
  type AmortizationSchedule,
  type BreakEvenResult,
  type BusinessHubMgElementName,
  type ChartSeries,
  type DscrResult,
  type Eb5JobsResult,
  type Projection,
  type SbaFeeResult,
} from "@repo/contracts";

import {
  ElementAdapterError,
  FIGURE_ELEMENT_SUPPORT,
  VALUE_FORMAT_KINDS,
  adaptDocumentToElementProps,
  adaptFigureToElementProps,
  buildDscrSteps,
  documentHeadline,
  parseValueFormatDirective,
  supportedElementsFor,
  type ElementAdapterErrorCode,
  type ElementProps,
  type FinanceFigure,
  type FinanceFigureKind,
  type ValueFormat,
} from "../element-adapter.js";
import { FIGURE_ELEMENT, computeSceneCacheKey } from "../planner.js";

/**
 * The adapter is the join between two packages that cannot import each other:
 * finance-kit result objects on one side, Remotion element props on the other.
 * Nothing here asserts on a mock. Every test either
 *
 *  - re-reads the renderer's own source to check the two sides still agree, or
 *  - re-implements the renderer's prop readers (`reqChartSeries`,
 *    `reqValueFormat`, …) and runs the produced payload through them, or
 *  - runs the produced payload through the renderer's REAL validator
 *    (M4's `validateSteps`, which is dependency-free and so is importable).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — plausible finance-kit output, never used as an expected value
// ─────────────────────────────────────────────────────────────────────────────

const AMORTIZATION: AmortizationSchedule = {
  principal: 750_000,
  annualRate: 0.115,
  termMonths: 3,
  monthlyPayment: 254_558.33,
  totalInterest: 13_675,
  totalPaid: 763_675,
  rows: [
    {
      period: 1,
      payment: 254_558.33,
      principal: 247_371.66,
      interest: 7_187.5,
      balance: 502_628.34,
      cumulativeInterest: 7_187.5,
    },
    {
      period: 2,
      payment: 254_558.33,
      principal: 249_688.83,
      interest: 4_869.5,
      balance: 252_939.51,
      cumulativeInterest: 12_057,
    },
    {
      period: 3,
      payment: 254_558.33,
      principal: 252_939.51,
      interest: 1_618,
      balance: 0,
      cumulativeInterest: 13_675,
    },
  ],
};

const DSCR_PASS: DscrResult = {
  netOperatingIncome: 148_000,
  annualDebtService: 112_000,
  dscr: 1.3214285714285714,
  threshold: 1.25,
  meetsThreshold: true,
};

const DSCR_FAIL: DscrResult = {
  netOperatingIncome: 133_000,
  annualDebtService: 112_000,
  dscr: 1.1875,
  threshold: 1.25,
  meetsThreshold: false,
};

const BREAK_EVEN: BreakEvenResult = {
  fixedCosts: 264_000,
  pricePerUnit: 14,
  variableCostPerUnit: 5.6,
  contributionMargin: 8.4,
  contributionMarginRatio: 0.6,
  breakEvenUnits: 31_428.57,
  breakEvenRevenue: 440_000,
};

const PROJECTION: Projection = {
  years: [
    {
      year: 1,
      revenue: 420_000,
      cogs: 168_000,
      grossProfit: 252_000,
      operatingExpenses: 231_000,
      ebitda: 21_000,
      depreciation: 18_000,
      interestExpense: 41_000,
      taxes: 0,
      netIncome: -38_000,
    },
    {
      year: 2,
      revenue: 610_000,
      cogs: 238_000,
      grossProfit: 372_000,
      operatingExpenses: 268_000,
      ebitda: 104_000,
      depreciation: 18_000,
      interestExpense: 38_000,
      taxes: 10_000,
      netIncome: 38_000,
    },
  ],
};

const SBA_FEES: SbaFeeResult = {
  loanAmount: 750_000,
  guarantyPercent: 0.75,
  guaranteedAmount: 562_500,
  guarantyFee: 19_687.5,
  annualServiceFee: 3_093.75,
  totalUpfrontFees: 21_187.5,
};

const EB5_SHORT: Eb5JobsResult = {
  investmentPerInvestor: 800_000,
  investorCount: 12,
  totalInvestment: 9_600_000,
  jobsPerInvestor: 10,
  jobsRequired: 120,
  jobsCreated: 119.4,
  meetsRequirement: false,
};

const EB5_OK: Eb5JobsResult = {
  ...EB5_SHORT,
  jobsCreated: 141,
  meetsRequirement: true,
};

const SERIES: ChartSeries = {
  points: [0.41, 0.37, 0.34, 0.29],
  labels: ["2022", "2023", "2024", "2025"],
};

const FIGURES: Readonly<Record<FinanceFigureKind, FinanceFigure>> = {
  amortization: { kind: "amortization", value: AMORTIZATION },
  dscr: { kind: "dscr", value: DSCR_PASS },
  "break-even": { kind: "break-even", value: BREAK_EVEN },
  projection: { kind: "projection", value: PROJECTION },
  "sba-fees": { kind: "sba-fees", value: SBA_FEES },
  "eb5-jobs": { kind: "eb5-jobs", value: EB5_OK },
  series: { kind: "series", value: SERIES },
};

const ALL_KINDS = Object.keys(FIGURES) as FinanceFigureKind[];

const PERCENT: ValueFormat = { kind: "percent", decimals: 0 };

/** The `[format:]` a kind needs, i.e. one only for `series`. */
const formatFor = (kind: FinanceFigureKind): ValueFormat | undefined =>
  kind === "series" ? PERCENT : undefined;

function adapt(
  kind: FinanceFigureKind,
  element: BusinessHubMgElementName,
): ElementProps {
  return adaptFigureToElementProps({
    element,
    figure: FIGURES[kind],
    beat: `beat-${kind}`,
    valueFormat: formatFor(kind),
  });
}

function expectAdapterError(
  run: () => unknown,
  code: ElementAdapterErrorCode,
): ElementAdapterError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}, nothing was thrown`).toBeInstanceOf(
    ElementAdapterError,
  );
  const error = caught as ElementAdapterError;
  expect(error.code, error.message).toBe(code);
  return error;
}

// ─────────────────────────────────────────────────────────────────────────────
// The renderer's own prop readers, re-implemented
// ─────────────────────────────────────────────────────────────────────────────

/**
 * These mirror `reqChartSeries` / `reqValueFormat` / `reqNumber` / `reqString`
 * in `apps/worker-render/src/remotion/business-hub/BusinessHubScene.tsx`. They
 * throw exactly where the renderer throws: a missing key, a wrong type, a
 * non-integer where an integer is required. Running every adapted payload
 * through them is the closest a test in this package can get to mounting the
 * component, since the renderer's own module pulls in React and Remotion.
 */
function reqRecord(props: ElementProps, key: string): Record<string, unknown> {
  const value = props[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`\`${key}\` must be a JSON object, got ${String(value)}`);
  }
  return value as Record<string, unknown>;
}

function reqString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `\`${key}\` must be a non-empty string, got ${String(value)}`,
    );
  }
  return value;
}

function reqNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${key}\` must be a finite number, got ${String(value)}`);
  }
  return value;
}

function optInteger(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`\`${key}\` must be an integer, got ${String(value)}`);
  }
  return value;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `\`${key}\` must be a non-empty string, got ${String(value)}`,
    );
  }
  return value;
}

function assertChartSeries(
  obj: Record<string, unknown>,
  key: string,
): ChartSeries {
  const raw = reqRecord(obj as ElementProps, key);
  const points = raw["points"];
  const labels = raw["labels"];
  if (!Array.isArray(points) || !Array.isArray(labels)) {
    throw new Error(`\`${key}\` needs array points and labels`);
  }
  if (points.length === 0) throw new Error(`\`${key}\` has no points`);
  if (points.length !== labels.length) {
    throw new Error(
      `\`${key}\` has ${points.length} points but ${labels.length} labels — a short label array renders blank axis ticks`,
    );
  }
  points.forEach((point, index) => {
    if (typeof point !== "number" || !Number.isFinite(point)) {
      throw new Error(`\`${key}.points[${index}]\` is ${String(point)}`);
    }
  });
  labels.forEach((label, index) => {
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(`\`${key}.labels[${index}]\` is ${String(label)}`);
    }
  });
  return { points: points as number[], labels: labels as string[] };
}

function assertValueFormat(obj: Record<string, unknown>, key: string): void {
  const raw = reqRecord(obj as ElementProps, key);
  const kind = reqString(raw, "kind");
  if (!(VALUE_FORMAT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`\`${key}.kind\` is "${kind}"`);
  }
  const decimals = optInteger(raw, "decimals");
  if (decimals === undefined || decimals < 0 || decimals > 6) {
    throw new Error(`\`${key}.decimals\` is ${String(decimals)}`);
  }
  if (kind === "currency") reqString(raw, "currency");
}

const TONES = ["neutral", "negative"];

/**
 * Validates one adapted payload against the props its element declares.
 *
 * @throws {Error} on anything the renderer would reject.
 */
function assertElementProps(
  element: BusinessHubMgElementName,
  props: ElementProps,
): void {
  switch (element) {
    case "StatCallout": {
      reqNumber(props, "value");
      assertValueFormat(props, "format");
      reqString(props, "label");
      optString(props, "context");
      const tone = optString(props, "tone");
      if (tone !== undefined && !TONES.includes(tone)) {
        throw new Error(`tone "${tone}"`);
      }
      return;
    }
    case "StatGrid": {
      const series = assertChartSeries(props, "series");
      assertValueFormat(props, "format");
      const columns = optInteger(props, "columns");
      if (columns !== undefined && (columns < 1 || columns > 4)) {
        throw new Error(`StatGrid columns must be 1..4, got ${columns}`);
      }
      const negatives = props["negativeIndices"];
      if (negatives !== undefined) {
        if (!Array.isArray(negatives)) throw new Error("negativeIndices");
        negatives.forEach((index) => {
          if (
            typeof index !== "number" ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= series.points.length
          ) {
            throw new Error(
              `negativeIndices holds ${String(index)}, outside 0..${series.points.length - 1}`,
            );
          }
        });
      }
      return;
    }
    case "BarChart": {
      const series = assertChartSeries(props, "series");
      assertValueFormat(props, "format");
      if (series.points.length > 8) {
        throw new Error(`BarChart refuses ${series.points.length} bars`);
      }
      optInteger(props, "highlightIndex");
      return;
    }
    case "LineChart": {
      const series = assertChartSeries(props, "series");
      assertValueFormat(props, "format");
      optString(props, "seriesLabel");
      optString(props, "xAxisLabel");
      const compare = props["compare"];
      if (compare !== undefined) {
        const raw = reqRecord(props, "compare");
        const compareSeries = assertChartSeries(raw, "series");
        reqString(raw, "label");
        if (compareSeries.points.length !== series.points.length) {
          throw new Error(
            "LineChart: two lines on one x-axis must share it — never padded",
          );
        }
      }
      // The element refuses a degenerate y-range.
      const all = [0, ...series.points];
      if (Math.max(...all) <= Math.min(...all)) {
        throw new Error("LineChart: degenerate y-range");
      }
      return;
    }
    case "PercentageBar": {
      reqString(props, "label");
      const fraction = reqNumber(props, "fraction");
      if (fraction < 0 || fraction > 1) {
        throw new Error(`PercentageBar fraction ${fraction} is not a fraction`);
      }
      optInteger(props, "decimals");
      optString(props, "comparison");
      return;
    }
    case "PaperClipping": {
      reqString(props, "headlineText");
      reqString(props, "publication");
      reqString(props, "dateText");
      optString(props, "excerpt");
      return;
    }
    case "FormulaReveal": {
      const steps = props["steps"];
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error("FormulaReveal needs a non-empty steps array");
      }
      return;
    }
    case "ComparisonTable":
    case "TimelineGraphic":
    case "ProcessDiagram":
    case "QuoteCard":
    case "Checklist":
    case "CalloutLabel":
      throw new Error(
        `no adapted payload should reach ${element}; FIGURE_ELEMENT_SUPPORT lists no figure for it`,
      );
    default: {
      const never: never = element;
      throw new Error(`unhandled element ${JSON.stringify(never)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The renderer element registry — the pin that closes the name gap
// ─────────────────────────────────────────────────────────────────────────────

const RENDERER_ROOT = new URL(
  "../../../../../worker-render/src/remotion/business-hub/",
  import.meta.url,
);

/** Reads an `as const` string-array literal out of a renderer source file. */
function readNameArray(relativePath: string, constName: string): string[] {
  const source = readFileSync(
    fileURLToPath(new URL(relativePath, RENDERER_ROOT)),
    "utf8",
  );
  const declaration = new RegExp(
    `${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`,
  ).exec(source);
  if (declaration === null) {
    throw new Error(
      `could not find "${constName} = [...] as const" in ${relativePath}. ` +
        `This test pins @repo/contracts' element union to the renderer's; if the ` +
        `declaration moved, follow it — do not delete the check.`,
    );
  }
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("renderer element registry", () => {
  /**
   * `apps/worker-render` is an app, not a package, so the orchestrator cannot
   * import its element list; `@repo/contracts` carries a copy and the planner is
   * typed against that. This reads the renderer's source and fails the moment
   * the two disagree — which is the failure that made five of the seven figure
   * kinds unrenderable in the first place.
   */
  it("declares exactly the names @repo/contracts declares", () => {
    const m3 = readNameArray("elements/index.ts", "BUSINESS_HUB_ELEMENT_NAMES");
    const formulaName = /FORMULA_ELEMENT_NAME\s*=\s*"([^"]+)"/.exec(
      readFileSync(
        fileURLToPath(new URL("BusinessHubScene.tsx", RENDERER_ROOT)),
        "utf8",
      ),
    );
    expect(
      formulaName,
      "FORMULA_ELEMENT_NAME in BusinessHubScene.tsx",
    ).not.toBeNull();
    const renderable = [...m3, formulaName?.[1]];

    expect([...renderable].sort()).toEqual(
      [...BUSINESS_HUB_MG_ELEMENT_NAMES].sort(),
    );
  });

  it("dispatches every contracts name in its element registry", () => {
    const source = readFileSync(
      fileURLToPath(new URL("BusinessHubScene.tsx", RENDERER_ROOT)),
      "utf8",
    );
    for (const name of BUSINESS_HUB_MG_ELEMENT_NAMES) {
      expect(source, `${name} has no ELEMENT_REGISTRY entry`).toContain(
        `${name}: ({`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage of the figure → element matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("figure → element coverage", () => {
  it("gives every figure kind at least one element", () => {
    for (const kind of ALL_KINDS) {
      expect(supportedElementsFor(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it("only ever names elements the renderer implements", () => {
    for (const kind of ALL_KINDS) {
      for (const element of FIGURE_ELEMENT_SUPPORT[kind]) {
        expect(
          BUSINESS_HUB_MG_ELEMENT_NAMES as readonly string[],
          `${kind} → ${element}`,
        ).toContain(element);
      }
    }
  });

  it("uses each kind's first supported element as the planner's default", () => {
    for (const kind of ALL_KINDS) {
      expect(FIGURE_ELEMENT[kind], kind).toBe(FIGURE_ELEMENT_SUPPORT[kind][0]);
    }
  });

  it("produces props every supported pairing's element can read", () => {
    for (const kind of ALL_KINDS) {
      for (const element of FIGURE_ELEMENT_SUPPORT[kind]) {
        const props = adapt(kind, element);
        expect(
          () => assertElementProps(element, props),
          `${kind} → ${element}`,
        ).not.toThrow();
      }
    }
  });

  it("emits plain JSON with no undefined members, so the cache key is canonical", () => {
    for (const kind of ALL_KINDS) {
      for (const element of FIGURE_ELEMENT_SUPPORT[kind]) {
        const props = adapt(kind, element);
        for (const [key, value] of Object.entries(props)) {
          expect(value, `${kind} → ${element}.${key}`).not.toBeUndefined();
        }
        // Round-trips through JSON unchanged: nothing is a Date, a Map or a
        // class instance that would hash differently than it renders.
        expect(JSON.parse(JSON.stringify(props))).toEqual(props);
      }
    }
  });

  it("refuses a pairing it has no adaptation for instead of improvising", () => {
    const error = expectAdapterError(
      () =>
        adaptFigureToElementProps({
          element: "Checklist",
          figure: FIGURES.amortization,
          beat: "loan",
          valueFormat: undefined,
        }),
      "UNSUPPORTED_PAIRING",
    );
    expect(error.message).toContain("LineChart");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism / cache key
// ─────────────────────────────────────────────────────────────────────────────

describe("cache key stability", () => {
  const keyFor = (kind: FinanceFigureKind): string => {
    const element = FIGURE_ELEMENT[kind];
    return computeSceneCacheKey({
      element,
      data: adapt(kind, element),
      grade: "ground-default",
      layout: "framed-chart",
      aspect: "16:9",
    });
  };

  it("is byte-identical across repeated adaptations of the same figure", () => {
    for (const kind of ALL_KINDS) {
      expect(keyFor(kind), kind).toBe(keyFor(kind));
    }
  });

  it("gives different figure kinds different keys", () => {
    const keys = ALL_KINDS.map(keyFor);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("changes when a number the viewer sees changes", () => {
    const props = (result: DscrResult): ElementProps =>
      adaptFigureToElementProps({
        element: "StatCallout",
        figure: { kind: "dscr", value: result },
        beat: "dscr",
        valueFormat: undefined,
      });
    const key = (result: DscrResult): string =>
      computeSceneCacheKey({
        element: "StatCallout",
        data: props(result),
        grade: "ground-default",
        layout: "framed-chart",
        aspect: "16:9",
      });
    expect(key(DSCR_FAIL)).not.toBe(key(DSCR_PASS));
  });

  it("does NOT change when a field the element never draws changes", () => {
    // The whole economic argument of the segment cache: "why 1.25 DSCR" renders
    // once for a keyword matrix. Two jobs whose amortization schedules differ
    // only in a summary field the LineChart does not plot must share a segment.
    const withDifferentSummary: AmortizationSchedule = {
      ...AMORTIZATION,
      annualRate: 0.129,
    };
    const key = (schedule: AmortizationSchedule): string =>
      computeSceneCacheKey({
        element: "LineChart",
        data: adaptFigureToElementProps({
          element: "LineChart",
          figure: { kind: "amortization", value: schedule },
          beat: "loan",
          valueFormat: undefined,
        }),
        grade: "ground-default",
        layout: "framed-chart",
        aspect: "16:9",
      });
    expect(key(withDifferentSummary)).toBe(key(AMORTIZATION));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Value formats
// ─────────────────────────────────────────────────────────────────────────────

describe("[format:] directive", () => {
  it("parses each unit with its default precision", () => {
    expect(parseValueFormatDirective("currency")).toEqual({
      kind: "currency",
      currency: "USD",
      decimals: 0,
    });
    expect(parseValueFormatDirective("percent")).toEqual({
      kind: "percent",
      decimals: 1,
    });
    expect(parseValueFormatDirective("ratio")).toEqual({
      kind: "ratio",
      decimals: 2,
    });
    expect(parseValueFormatDirective("number")).toEqual({
      kind: "number",
      decimals: 0,
    });
  });

  it("takes an explicit precision", () => {
    expect(parseValueFormatDirective("percent 3")).toEqual({
      kind: "percent",
      decimals: 3,
    });
  });

  it("rejects an unknown unit rather than defaulting to one", () => {
    expectAdapterError(
      () => parseValueFormatDirective("dollars"),
      "INVALID_VALUE_FORMAT",
    );
  });

  it("rejects a precision the renderer would throw on", () => {
    expectAdapterError(
      () => parseValueFormatDirective("percent 9"),
      "INVALID_VALUE_FORMAT",
    );
    expectAdapterError(
      () => parseValueFormatDirective("percent x"),
      "INVALID_VALUE_FORMAT",
    );
  });

  it("requires a unit for a bare series and rejects one everywhere else", () => {
    expectAdapterError(
      () =>
        adaptFigureToElementProps({
          element: "LineChart",
          figure: FIGURES.series,
          beat: "rate",
          valueFormat: undefined,
        }),
      "MISSING_VALUE_FORMAT",
    );
    expectAdapterError(
      () =>
        adaptFigureToElementProps({
          element: "LineChart",
          figure: FIGURES.projection,
          beat: "projection",
          valueFormat: PERCENT,
        }),
      "UNEXPECTED_VALUE_FORMAT",
    );
  });

  it("carries the stated unit through to the element", () => {
    expect(adapt("series", "LineChart")["format"]).toEqual(PERCENT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verdicts are carried, never re-derived
// ─────────────────────────────────────────────────────────────────────────────

describe("finance-kit's verdicts are carried, not recomputed", () => {
  it("marks a short EB-5 job count negative on the grid", () => {
    const shortfall = adaptFigureToElementProps({
      element: "StatGrid",
      figure: { kind: "eb5-jobs", value: EB5_SHORT },
      beat: "jobs",
      valueFormat: undefined,
    });
    expect(shortfall["negativeIndices"]).toEqual([1]);
    // 119.4 must not round to 120 next to a required "120".
    expect(shortfall["format"]).toEqual({ kind: "number", decimals: 1 });
    expect(adapt("eb5-jobs", "StatGrid")["negativeIndices"]).toBeUndefined();
  });

  it("uses meetsThreshold rather than comparing the rounded display value", () => {
    // 1.249 prints as "1.25" — the exact case that would flip a rejection into
    // an approval if the tone were re-derived from the displayed string.
    const borderline: DscrResult = {
      ...DSCR_FAIL,
      dscr: 1.249,
      meetsThreshold: false,
    };
    const props = adaptFigureToElementProps({
      element: "StatCallout",
      figure: { kind: "dscr", value: borderline },
      beat: "dscr",
      valueFormat: undefined,
    });
    expect(props["tone"]).toBe("negative");
    expect(props["context"]).toContain("Falls short");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Render-side limits, enforced at plan time
// ─────────────────────────────────────────────────────────────────────────────

describe("render limits are raised at plan time", () => {
  it("refuses a bar chart past the renderer's eight-bar limit", () => {
    const long: ChartSeries = {
      points: Array.from({ length: 12 }, (_, i) => i + 1),
      labels: Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
    };
    const error = expectAdapterError(
      () =>
        adaptFigureToElementProps({
          element: "BarChart",
          figure: { kind: "series", value: long },
          beat: "months",
          valueFormat: { kind: "number", decimals: 0 },
        }),
      "FIGURE_TOO_LARGE_FOR_ELEMENT",
    );
    expect(error.message).toContain("LineChart");
  });

  it("still draws the same twelve points as a line", () => {
    const long: ChartSeries = {
      points: Array.from({ length: 12 }, (_, i) => i + 1),
      labels: Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
    };
    const props = adaptFigureToElementProps({
      element: "LineChart",
      figure: { kind: "series", value: long },
      beat: "months",
      valueFormat: { kind: "number", decimals: 0 },
    });
    expect(() => assertElementProps("LineChart", props)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Document clippings
// ─────────────────────────────────────────────────────────────────────────────

describe("document clippings", () => {
  const RAW =
    "SBA SOP 50 10 7 | U.S. Small Business Administration | 1 August 2023";

  it("splits the directive into the three fields PaperClipping draws", () => {
    expect(adaptDocumentToElementProps(RAW, "doc")).toEqual({
      headlineText: "SBA SOP 50 10 7",
      publication: "U.S. Small Business Administration",
      dateText: "1 August 2023",
    });
    expect(documentHeadline(RAW, "doc")).toBe("SBA SOP 50 10 7");
  });

  it("keeps an excerpt when the script supplies one", () => {
    const props = adaptDocumentToElementProps(
      `${RAW} | Repayment ability`,
      "doc",
    );
    expect(props["excerpt"]).toBe("Repayment ability");
  });

  it("throws rather than inventing a masthead or a date", () => {
    expectAdapterError(
      () => adaptDocumentToElementProps("SBA SOP 50 10 7", "doc"),
      "INVALID_DOCUMENT",
    );
    expectAdapterError(
      () => adaptDocumentToElementProps("SBA SOP 50 10 7 |  | 2023", "doc"),
      "INVALID_DOCUMENT",
    );
  });

  it("throws on more fields than a clipping has slots", () => {
    expectAdapterError(
      () => adaptDocumentToElementProps(`${RAW} | a | b`, "doc"),
      "INVALID_DOCUMENT",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FormulaReveal steps, checked against M4's real validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `formula/validate.ts` has no runtime imports at all (its only import is a
 * type-only one), so it can be loaded straight out of `apps/worker-render`
 * without dragging React or Remotion in. The specifier is built at runtime so
 * `tsc` never pulls the renderer's type graph into this package.
 */
async function loadValidateSteps(): Promise<(steps: unknown[]) => void> {
  const specifier = new URL("formula/validate.ts", RENDERER_ROOT).href;
  const module = (await import(/* @vite-ignore */ specifier)) as {
    validateSteps: (steps: unknown[]) => void;
  };
  return module.validateSteps;
}

describe("FormulaReveal DSCR derivation", () => {
  it("passes M4's own validateSteps", async () => {
    const validateSteps = await loadValidateSteps();
    expect(() => validateSteps([...buildDscrSteps(DSCR_PASS)])).not.toThrow();
    expect(() => validateSteps([...buildDscrSteps(DSCR_FAIL)])).not.toThrow();
  });

  it("reads the verdict off the result instead of comparing display strings", () => {
    const pass = buildDscrSteps(DSCR_PASS);
    const fail = buildDscrSteps(DSCR_FAIL);
    const landing = (steps: ReturnType<typeof buildDscrSteps>): string => {
      const last = steps[steps.length - 1];
      if (last.kind !== "result") throw new Error("expected a result beat");
      return last.result.status;
    };
    expect(landing(pass)).toBe("pass");
    expect(landing(fail)).toBe("fail");
  });

  it("formats every number from the result and none from anywhere else", () => {
    const text = JSON.stringify(buildDscrSteps(DSCR_PASS));
    expect(text).toContain("$148,000");
    expect(text).toContain("$112,000");
    expect(text).toContain("1.32");
    expect(text).toContain("1.25");
  });

  it("lands on the scene as the FormulaReveal props the renderer reads", () => {
    const props = adapt("dscr", "FormulaReveal");
    expect(Object.keys(props)).toEqual(["steps"]);
    expect(() => assertElementProps("FormulaReveal", props)).not.toThrow();
  });
});
