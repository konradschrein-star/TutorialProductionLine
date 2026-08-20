import {
  isBusinessHubMgElementName,
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
  amortizationBalanceSeries,
  amortizationCumulativeInterestSeries,
  projectionSeries,
} from "@repo/finance-kit";

/**
 * BUSINESS_PLAN_HUB — finance figure → motion-graphic element props.
 *
 * ## Why this module exists
 *
 * A scene's `data` **is** the element's props. The renderer reads it field by
 * field (`ELEMENT_REGISTRY` in
 * `apps/worker-render/src/remotion/business-hub/BusinessHubScene.tsx`) and
 * throws on anything it cannot read. finance-kit, meanwhile, emits result
 * objects — `AmortizationSchedule`, `Projection`, `SbaFeeResult` — whose shapes
 * are nothing like `{ series, format }`. Until this module existed the planner
 * put the raw finance object on the scene, so every motion-graphic scene in the
 * format was unrenderable: `LineChart` asked for `data.series` and got an
 * object with `rows`.
 *
 * ## Why it runs at PLAN time and not at render time
 *
 * `scene.cacheKey = sha256({element, data, grade, layout, aspect})`. The cache
 * is what makes a keyword-matrix catalogue affordable — "why 1.25 DSCR" renders
 * once for the whole library. If `data` were adapted after the key was
 * computed, the key would describe a payload that never reaches a renderer, and
 * two scenes whose *props* are identical but whose raw finance objects differ in
 * some unused field would miss each other in the cache. So the props the
 * renderer will actually receive are the props the planner hashes.
 *
 * ## Fail-closed rules
 *
 * 1. **No pairing is invented.** Only the (figure kind, element) pairs listed in
 *    {@link FIGURE_ELEMENT_SUPPORT} are adapted; anything else throws
 *    `UNSUPPORTED_PAIRING` naming what the figure *can* drive. There is no
 *    "closest match" — an amortization schedule shoved into a `Checklist` would
 *    render a plausible-looking wrong frame.
 * 2. **No unit is guessed.** A bare `ChartSeries` carries points and labels and
 *    nothing that says whether `0.41` is 41 %, $0.41 or a ratio. Currency is not
 *    assumed for it: the beat must state the unit with `[format: …]` or the plan
 *    fails (`MISSING_VALUE_FORMAT`). Every other figure kind's unit is known
 *    from its contract type, so it is derived, not asked for.
 * 3. **No verdict is re-derived.** `meetsThreshold` / `meetsRequirement` are
 *    carried straight through to tone and copy. Re-comparing a rounded display
 *    value flips `1.249` into a pass.
 * 4. **Render-side limits are enforced here.** `BarChart` refuses more than
 *    eight bars and `StatGrid` more than four columns; both throw at render.
 *    Checking at plan time turns a wasted render into a build failure.
 *
 * ## Currency
 *
 * Every programme this format covers (SBA 7(a), SBA 504, EB-5) is a United
 * States programme and finance-kit's money contracts carry no currency field, so
 * money is drawn as USD. That is a stated property of the format, not a
 * fallback: a non-USD programme needs a currency on the finance contract first.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Every way adapting a figure to element props can fail. */
export type ElementAdapterErrorCode =
  | "UNSUPPORTED_PAIRING"
  | "MISSING_VALUE_FORMAT"
  | "UNEXPECTED_VALUE_FORMAT"
  | "INVALID_VALUE_FORMAT"
  | "FIGURE_TOO_LARGE_FOR_ELEMENT"
  | "INVALID_DOCUMENT";

/**
 * An adaptation failure. Carries the machine-readable
 * {@link ElementAdapterErrorCode} so the planner can map it onto its own error
 * vocabulary with an exhaustive switch rather than by string matching.
 */
export class ElementAdapterError extends Error {
  readonly code: ElementAdapterErrorCode;

  constructor(code: ElementAdapterErrorCode, message: string) {
    super(message);
    this.name = "ElementAdapterError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance figures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One computed figure from `@repo/finance-kit` (task F1), tagged with its kind
 * so the planner can pick an element and a pointing target without inspecting
 * duck-typed shapes. The `value` types are the contracts in
 * `@repo/contracts/schemas/business-hub-finance` — nothing here constructs one,
 * it only routes what finance-kit computed.
 *
 * Declared in this module rather than in `planner.ts` because the adapter is the
 * lower layer: the planner imports the adapter, so the shared type has to live
 * on the adapter side or the two files import each other. `planner.ts`
 * re-exports it, which is the name every existing caller already uses.
 */
export type FinanceFigure =
  | { readonly kind: "amortization"; readonly value: AmortizationSchedule }
  | { readonly kind: "dscr"; readonly value: DscrResult }
  | { readonly kind: "break-even"; readonly value: BreakEvenResult }
  | { readonly kind: "projection"; readonly value: Projection }
  | { readonly kind: "sba-fees"; readonly value: SbaFeeResult }
  | { readonly kind: "eb5-jobs"; readonly value: Eb5JobsResult }
  | { readonly kind: "series"; readonly value: ChartSeries };

/** The discriminant of {@link FinanceFigure}. */
export type FinanceFigureKind = FinanceFigure["kind"];

/**
 * Everything finance-kit computed for this topic, keyed by the id a script beat
 * cites in `[fig: id]`. A `[fig:]` naming a key that is not in here throws in
 * the planner — a number is never invented to fill a chart.
 */
export type FinanceFigureSet = Readonly<Record<string, FinanceFigure>>;

// ─────────────────────────────────────────────────────────────────────────────
// Value formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a number is drawn, mirroring `ValueFormat` in
 * `apps/worker-render/src/remotion/business-hub/elements/format.ts`.
 *
 * Duplicated rather than imported because `apps/worker-render` is an app, not a
 * package: the orchestrator has no way to import from it. The renderer re-reads
 * every field of this object out of `scene.data` (`reqValueFormat`) and throws
 * on an unknown `kind`, a missing `currency` or non-integer `decimals`, so a
 * drift between the two shows up as a named render failure rather than a wrong
 * frame. `element-adapter.test.ts` pins the two kind lists together.
 */
export type ValueFormat =
  | {
      readonly kind: "currency";
      /** ISO 4217 code. Always `"USD"` here — see the module doc. */
      readonly currency: string;
      readonly decimals: number;
      readonly compact?: boolean;
    }
  | {
      readonly kind: "percent";
      /** Input is a FRACTION (`0.075` → `7.5%`), matching the finance contracts. */
      readonly decimals: number;
    }
  | {
      readonly kind: "ratio";
      readonly decimals: number;
      readonly suffix?: string;
    }
  | {
      readonly kind: "number";
      readonly decimals: number;
      readonly suffix?: string;
    };

/** The `kind` discriminants the renderer's `reqValueFormat` accepts. */
export const VALUE_FORMAT_KINDS = [
  "currency",
  "percent",
  "ratio",
  "number",
] as const;
export type ValueFormatKind = (typeof VALUE_FORMAT_KINDS)[number];

/** The only currency this format draws. See the module doc. */
export const PLAN_CURRENCY = "USD";

/** Whole dollars. Plans quote round money; cents are noise at 1080p. */
const USD: ValueFormat = {
  kind: "currency",
  currency: PLAN_CURRENCY,
  decimals: 0,
};

/**
 * Display precision for a count of discrete things (units, jobs, investors).
 *
 * An integer count draws as an integer. A fractional one keeps a decimal,
 * because an economic model producing 119.4 jobs against a 120-job requirement
 * FAILS, and rounding it to 119 — or worse, to 120 — is exactly the error this
 * format exists to make visible.
 */
const countDecimals = (value: number): number =>
  Number.isInteger(value) ? 0 : 1;

/** Default decimals per format kind, used when `[format: …]` omits them. */
const DEFAULT_FORMAT_DECIMALS: Readonly<Record<ValueFormatKind, number>> = {
  currency: 0,
  percent: 1,
  ratio: 2,
  number: 0,
};

/**
 * Parses the `[format: …]` directive value.
 *
 * Grammar: `<kind>` or `<kind> <decimals>`, where `<kind>` is one of
 * {@link VALUE_FORMAT_KINDS}. `currency` is always {@link PLAN_CURRENCY}; the
 * directive does not take a currency code, because the finance contracts carry
 * no currency and letting a script assert one would put a `€` on numbers
 * computed as dollars.
 *
 * `percent` means the points ARE fractions: `0.41` draws as `41%`.
 *
 * @throws {@link ElementAdapterError} `INVALID_VALUE_FORMAT` on an unknown kind,
 * a non-integer or out-of-range decimals count, or extra tokens. It never falls
 * back to a default kind: a mis-typed unit is a silently wrong video.
 */
export function parseValueFormatDirective(raw: string): ValueFormat {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new ElementAdapterError(
      "INVALID_VALUE_FORMAT",
      `"[format: ]" is empty. Write one of ${VALUE_FORMAT_KINDS.join(", ")}, ` +
        `optionally followed by a decimal count, e.g. "[format: percent 1]".`,
    );
  }
  const kindToken: string = tokens[0];
  if (tokens.length > 2) {
    throw new ElementAdapterError(
      "INVALID_VALUE_FORMAT",
      `"[format: ${raw}]" has ${tokens.length} tokens. The grammar is ` +
        `"[format: <${VALUE_FORMAT_KINDS.join("|")}> [decimals]]".`,
    );
  }

  const kind = VALUE_FORMAT_KINDS.find((k) => k === kindToken.toLowerCase());
  if (kind === undefined) {
    throw new ElementAdapterError(
      "INVALID_VALUE_FORMAT",
      `"[format: ${raw}]" names unit "${kindToken}", which is not one of ` +
        `${VALUE_FORMAT_KINDS.join(", ")}. The unit decides whether 0.41 draws ` +
        `as "41%", "$0" or "0.41x"; it is never guessed.`,
    );
  }

  const decimalsToken: string | undefined =
    tokens.length > 1 ? tokens[1] : undefined;
  const decimals = parseDecimalsToken(decimalsToken, raw, kind);

  switch (kind) {
    case "currency":
      return { kind, currency: PLAN_CURRENCY, decimals };
    case "percent":
      return { kind, decimals };
    case "ratio":
      return { kind, decimals };
    case "number":
      return { kind, decimals };
    default: {
      const never: never = kind;
      throw new ElementAdapterError(
        "INVALID_VALUE_FORMAT",
        `unhandled value format kind ${JSON.stringify(never)}`,
      );
    }
  }
}

function parseDecimalsToken(
  token: string | undefined,
  raw: string,
  kind: ValueFormatKind,
): number {
  if (token === undefined) return DEFAULT_FORMAT_DECIMALS[kind];
  const decimals = Number(token);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new ElementAdapterError(
      "INVALID_VALUE_FORMAT",
      `"[format: ${raw}]" gives decimals "${token}"; it must be an integer ` +
        `between 0 and 6 (the renderer's own limit).`,
    );
  }
  return decimals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Which elements can draw which figure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every element each figure kind can be drawn by, most-appropriate first.
 *
 * The head of each list is the planner's default (`FIGURE_ELEMENT`); the rest
 * are what `[element: X]` may legally select. A pair that is absent has no
 * adaptation and throws — see rule 1 in the module doc.
 *
 * Typed against `BusinessHubMgElementName`, so renaming an element in
 * `@repo/contracts` (and therefore in the renderer's registry) breaks this
 * build rather than a render three stages later.
 */
export const FIGURE_ELEMENT_SUPPORT: Readonly<
  Record<FinanceFigureKind, readonly BusinessHubMgElementName[]>
> = {
  // A schedule is a shape over time — a balance falling while interest
  // accumulates — and a term can be 300 periods, far past BarChart's eight.
  amortization: ["LineChart", "BarChart", "StatGrid"],
  // The format's signature: the ratio built one term at a time (design §4.4).
  dscr: ["FormulaReveal", "StatCallout"],
  // The claim of a break-even is the unit count, not a curve.
  "break-even": ["StatCallout", "PercentageBar"],
  projection: ["LineChart", "BarChart", "StatGrid"],
  // Fees are four unrelated dollar figures, not a series: cards, not an axis.
  "sba-fees": ["StatGrid", "PercentageBar", "StatCallout"],
  "eb5-jobs": ["StatGrid", "StatCallout"],
  series: ["LineChart", "BarChart", "StatGrid"],
};

/** The elements `[element: X]` may name on a beat citing this figure kind. */
export function supportedElementsFor(
  kind: FinanceFigureKind,
): readonly BusinessHubMgElementName[] {
  return FIGURE_ELEMENT_SUPPORT[kind];
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An element's props as they land on `scene.data`: a plain JSON object.
 *
 * `unknown` values rather than a JSON union because each element's props are
 * genuinely different and the renderer re-reads every field anyway. What matters
 * here is that the object is plain and carries no `undefined` members — the
 * cache key's canonical serialiser rejects both.
 */
export type ElementProps = Record<string, unknown>;

/** Drops keys whose value is `undefined` so the cache key stays canonical. */
function props(entries: Record<string, unknown>): ElementProps {
  const out: ElementProps = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** `BarChart` throws past this; checked here so it fails before a render. */
const MAX_BARS = 8;
/** `StatGrid` throws past this. */
const MAX_STAT_GRID_COLUMNS = 4;

export interface AdaptFigureArgs {
  /** The element chosen by the planner, already narrowed to a real component. */
  readonly element: BusinessHubMgElementName;
  readonly figure: FinanceFigure;
  /** The beat slug, for diagnostics. */
  readonly beat: string;
  /**
   * The `[format: …]` directive, parsed. Required for a `series` figure (its
   * unit is unknowable) and rejected for every other kind (their unit is known
   * from the contract type, and a directive that silently did nothing would be
   * worse than one that throws).
   */
  readonly valueFormat: ValueFormat | undefined;
}

/**
 * Converts one finance figure into the exact props its element declares.
 *
 * @throws {@link ElementAdapterError} `UNSUPPORTED_PAIRING` when the element
 * cannot draw this figure kind, `MISSING_VALUE_FORMAT` / `UNEXPECTED_VALUE_FORMAT`
 * when the `[format:]` directive is absent where it is required or present where
 * it is not, and `FIGURE_TOO_LARGE_FOR_ELEMENT` when the data exceeds a limit the
 * renderer would throw on. It never substitutes an element, a unit or a value.
 */
export function adaptFigureToElementProps(args: AdaptFigureArgs): ElementProps {
  const { element, figure, beat } = args;

  if (!supportedElementsFor(figure.kind).includes(element)) {
    throw new ElementAdapterError(
      "UNSUPPORTED_PAIRING",
      `beat "${beat}" draws a "${figure.kind}" figure with element "${element}", ` +
        `for which there is no prop adaptation. A "${figure.kind}" figure can be ` +
        `drawn by: ${supportedElementsFor(figure.kind).join(", ")}. ` +
        `Adapting it to "${element}" by guesswork would render a plausible-looking ` +
        `wrong frame, so either pick one of those elements or add the pairing to ` +
        `FIGURE_ELEMENT_SUPPORT together with its adaptation.`,
    );
  }

  const valueFormat = resolveValueFormat(args);

  switch (figure.kind) {
    case "amortization":
      return amortizationProps(element, figure.value, beat);
    case "dscr":
      return dscrProps(element, figure.value, beat);
    case "break-even":
      return breakEvenProps(element, figure.value, beat);
    case "projection":
      return projectionProps(element, figure.value, beat);
    case "sba-fees":
      return sbaFeeProps(element, figure.value, beat);
    case "eb5-jobs":
      return eb5JobsProps(element, figure.value, beat);
    case "series":
      return seriesProps(element, figure.value, valueFormat, beat);
    default: {
      const never: never = figure;
      throw new ElementAdapterError(
        "UNSUPPORTED_PAIRING",
        `unhandled figure kind ${JSON.stringify(never)}`,
      );
    }
  }
}

/**
 * Applies rule 2: the unit comes from the contract type where one exists, and
 * from the script where it does not.
 *
 * @throws {@link ElementAdapterError} `MISSING_VALUE_FORMAT` /
 * `UNEXPECTED_VALUE_FORMAT`.
 */
function resolveValueFormat(args: AdaptFigureArgs): ValueFormat {
  const { figure, beat, valueFormat } = args;
  if (figure.kind === "series") {
    if (valueFormat === undefined) {
      throw new ElementAdapterError(
        "MISSING_VALUE_FORMAT",
        `beat "${beat}" plots a bare chart series, which carries points and ` +
          `labels and nothing that says what the points ARE. 0.41 draws as ` +
          `"41%", "$0" or "0.41x" depending on the unit, and picking one here ` +
          `would publish a confidently wrong chart. Add "[format: percent]", ` +
          `"[format: currency]", "[format: ratio]" or "[format: number]" to the ` +
          `beat (an optional decimal count follows the unit).`,
      );
    }
    return valueFormat;
  }
  if (valueFormat !== undefined) {
    throw new ElementAdapterError(
      "UNEXPECTED_VALUE_FORMAT",
      `beat "${beat}" sets "[format: …]" on a "${figure.kind}" figure, whose ` +
        `unit is already fixed by its finance-kit contract. The directive would ` +
        `silently do nothing, so it is rejected — drop it, or convert the figure ` +
        `to a series if you really need a different unit.`,
    );
  }
  return USD;
}

// ── amortization ────────────────────────────────────────────────────────────

function amortizationProps(
  element: BusinessHubMgElementName,
  schedule: AmortizationSchedule,
  beat: string,
): ElementProps {
  switch (element) {
    case "LineChart":
      // The money shot of an amortization beat: the balance falling while the
      // interest already paid climbs, on one shared period axis.
      return props({
        series: amortizationBalanceSeries(schedule.rows),
        format: USD,
        seriesLabel: "Balance remaining",
        compare: {
          series: amortizationCumulativeInterestSeries(schedule.rows),
          label: "Interest paid to date",
        },
        xAxisLabel: "PAYMENT PERIOD",
      });

    case "BarChart":
      assertBarCount(schedule.rows.length, beat, "amortization periods");
      return props({
        series: amortizationBalanceSeries(schedule.rows),
        format: USD,
      });

    case "StatGrid":
      return props({
        series: {
          points: [
            schedule.principal,
            schedule.monthlyPayment,
            schedule.totalInterest,
            schedule.totalPaid,
          ],
          labels: [
            "Amount borrowed",
            "Monthly payment",
            "Total interest",
            "Total repaid",
          ],
        },
        format: USD,
        columns: 2,
        // Interest and the total repaid are what the loan COSTS, not what it
        // provides.
        negativeIndices: [2],
      });

    default:
      throw unsupported(element, "amortization", beat);
  }
}

// ── dscr ────────────────────────────────────────────────────────────────────

function dscrProps(
  element: BusinessHubMgElementName,
  result: DscrResult,
  beat: string,
): ElementProps {
  switch (element) {
    case "FormulaReveal":
      return props({ steps: buildDscrSteps(result) });

    case "StatCallout":
      return props({
        value: result.dscr,
        format: { kind: "ratio", decimals: 2 },
        label: "Debt service coverage ratio",
        // The verdict is finance-kit's, carried through. Re-comparing the
        // rounded display value turns 1.249 into a pass.
        context: result.meetsThreshold
          ? `Clears the ${formatRatio(result.threshold)} minimum the programme sets.`
          : `Falls short of the ${formatRatio(result.threshold)} minimum the programme sets.`,
        tone: result.meetsThreshold ? "neutral" : "negative",
      });

    default:
      throw unsupported(element, "dscr", beat);
  }
}

// ── break-even ──────────────────────────────────────────────────────────────

function breakEvenProps(
  element: BusinessHubMgElementName,
  result: BreakEvenResult,
  beat: string,
): ElementProps {
  switch (element) {
    case "StatCallout":
      return props({
        value: result.breakEvenUnits,
        format: {
          kind: "number",
          decimals: countDecimals(result.breakEvenUnits),
          suffix: " units",
        },
        // 31 characters. The `statLabel` budget in validate.ts is 40, and this
        // string used to be 53 — so every break-even StatCallout scene was
        // rejected by this format's own render gate for overflowing a slot it
        // could never fit. The detail that was cut ("before the business
        // covers") is already carried, in full, by `context` below.
        label: "Units sold to cover fixed costs",
        context:
          `${formatUsd(result.fixedCosts)} of fixed cost divided by a ` +
          `${formatUsd(result.contributionMargin, 2)} contribution margin per unit ` +
          `— ${formatUsd(result.breakEvenRevenue)} of revenue.`,
      });

    case "PercentageBar":
      return props({
        label: "Contribution margin per unit",
        fraction: result.contributionMarginRatio,
        decimals: 1,
        comparison:
          `Every ${formatUsd(result.pricePerUnit, 2)} of sales leaves ` +
          `${formatUsd(result.contributionMargin, 2)} against ` +
          `${formatUsd(result.fixedCosts)} of fixed cost.`,
      });

    default:
      throw unsupported(element, "break-even", beat);
  }
}

// ── projection ──────────────────────────────────────────────────────────────

function projectionProps(
  element: BusinessHubMgElementName,
  projectionResult: Projection,
  beat: string,
): ElementProps {
  const years = projectionResult.years;
  switch (element) {
    case "LineChart":
      // Revenue against what is actually left of it. Both series come off the
      // same year list, so they share an x-axis by construction — the thing
      // LineChart refuses to pad for.
      return props({
        series: projectionSeries(years, "revenue"),
        format: USD,
        seriesLabel: "Revenue",
        compare: {
          series: projectionSeries(years, "netIncome"),
          label: "Net income",
        },
        xAxisLabel: "PROJECTION YEAR",
      });

    case "BarChart":
      assertBarCount(years.length, beat, "projection years");
      // Net income rather than revenue: BarChart draws negatives left of zero
      // in clay, which is how a year-one loss is supposed to read.
      return props({
        series: projectionSeries(years, "netIncome"),
        format: USD,
      });

    case "StatGrid":
      return props({
        series: projectionSeries(years, "revenue"),
        format: USD,
        columns: Math.min(years.length, 3),
      });

    default:
      throw unsupported(element, "projection", beat);
  }
}

// ── sba fees ────────────────────────────────────────────────────────────────

function sbaFeeProps(
  element: BusinessHubMgElementName,
  result: SbaFeeResult,
  beat: string,
): ElementProps {
  switch (element) {
    case "StatGrid":
      return props({
        series: {
          points: [
            result.loanAmount,
            result.guaranteedAmount,
            result.guarantyFee,
            result.annualServiceFee,
          ],
          labels: [
            "Loan amount",
            "SBA guaranty",
            "Guaranty fee",
            "Annual service fee",
          ],
        },
        format: USD,
        columns: 2,
        // The two fees are what the borrower pays out, not what they receive.
        negativeIndices: [2, 3],
      });

    case "PercentageBar":
      return props({
        label: `SBA guaranty on a ${formatUsd(result.loanAmount)} loan`,
        fraction: result.guarantyPercent,
        decimals: 0,
        comparison:
          `The lender carries the remaining ` +
          `${formatPercent(1 - result.guarantyPercent, 0)} itself. That share is ` +
          `why your projections get read line by line.`,
      });

    case "StatCallout":
      return props({
        value: result.totalUpfrontFees,
        format: USD,
        label: "Total upfront fees at close",
        context:
          `Charged on the ${formatUsd(result.guaranteedAmount)} the SBA guarantees, ` +
          `not on the ${formatUsd(result.loanAmount)} you borrow.`,
      });

    default:
      throw unsupported(element, "sba-fees", beat);
  }
}

// ── eb5 jobs ────────────────────────────────────────────────────────────────

function eb5JobsProps(
  element: BusinessHubMgElementName,
  result: Eb5JobsResult,
  beat: string,
): ElementProps {
  // One precision for both cards: 119.4 next to a required "120" has to read as
  // a shortfall, and a grid that rounded one card and not the other would read
  // as a tie.
  const decimals = Math.max(
    countDecimals(result.jobsCreated),
    countDecimals(result.jobsRequired),
  );

  switch (element) {
    case "StatGrid":
      return props({
        series: {
          points: [result.jobsRequired, result.jobsCreated],
          labels: ["Jobs required", "Jobs this plan creates"],
        },
        format: { kind: "number", decimals },
        columns: 2,
        // finance-kit's own verdict — which is the headcount test AND the
        // two-year sustainment test, neither of which is re-derived here.
        negativeIndices: result.meetsRequirement ? undefined : [1],
      });

    case "StatCallout":
      return props({
        value: result.jobsCreated,
        format: { kind: "number", decimals, suffix: " jobs" },
        label: "Jobs this plan creates",
        context:
          `${formatCount(result.jobsRequired, decimals)} are required for ` +
          `${formatCount(result.investorCount, 0)} investors at ` +
          `${formatCount(result.jobsPerInvestor, 0)} each.`,
        tone: result.meetsRequirement ? "neutral" : "negative",
      });

    default:
      throw unsupported(element, "eb5-jobs", beat);
  }
}

// ── bare series ─────────────────────────────────────────────────────────────

function seriesProps(
  element: BusinessHubMgElementName,
  series: ChartSeries,
  format: ValueFormat,
  beat: string,
): ElementProps {
  switch (element) {
    case "LineChart":
      return props({ series, format });

    case "BarChart":
      assertBarCount(series.points.length, beat, "series points");
      return props({ series, format });

    case "StatGrid":
      if (series.points.length > MAX_STAT_GRID_COLUMNS * 2) {
        throw new ElementAdapterError(
          "FIGURE_TOO_LARGE_FOR_ELEMENT",
          `beat "${beat}" puts ${series.points.length} series points on a StatGrid. ` +
            `Past ${MAX_STAT_GRID_COLUMNS * 2} cards the card type falls under the ` +
            `18px legibility floor at 1080p. Split the beat, or draw it as a LineChart.`,
        );
      }
      return props({
        series,
        format,
        columns: Math.min(series.points.length, 3),
      });

    default:
      throw unsupported(element, "series", beat);
  }
}

// ── shared guards ───────────────────────────────────────────────────────────

/**
 * `BarChart` throws past {@link MAX_BARS}; this raises the same objection at
 * plan time, where it costs nothing.
 */
function assertBarCount(count: number, beat: string, what: string): void {
  if (count <= MAX_BARS) return;
  throw new ElementAdapterError(
    "FIGURE_TOO_LARGE_FOR_ELEMENT",
    `beat "${beat}" asks BarChart to draw ${count} ${what}; it refuses past ` +
      `${MAX_BARS} because the rows fall below the legibility floor at 1080p. ` +
      `Use "[element: LineChart]", or aggregate the figure in finance-kit.`,
  );
}

/**
 * The `default` arm of each per-figure switch. `FIGURE_ELEMENT_SUPPORT` is
 * checked before dispatch, so reaching one of these means the support table and
 * the adaptation disagree — a bug in this file, not bad input.
 */
function unsupported(
  element: BusinessHubMgElementName,
  kind: FinanceFigureKind,
  beat: string,
): ElementAdapterError {
  return new ElementAdapterError(
    "UNSUPPORTED_PAIRING",
    `beat "${beat}": FIGURE_ELEMENT_SUPPORT lists "${element}" for a "${kind}" ` +
      `figure but this module has no adaptation for that pair. This is an ` +
      `element-adapter bug, not a data problem.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Document clippings
// ─────────────────────────────────────────────────────────────────────────────

/** The separator between a `[doc:]` directive's fields. */
export const DOCUMENT_FIELD_SEPARATOR = "|";

/**
 * Builds `PaperClipping` props from a `[doc: …]` directive.
 *
 * Grammar: `[doc: <headline> | <publication> | <date> [| <excerpt>]]`.
 *
 * All three of headline, publication and date are required because
 * `PaperClipping` draws all three and the renderer throws on a missing one.
 * They are not derivable: the citation's host is where the document is *hosted*,
 * not who published it, and no part of the pipeline knows a document's date.
 * Inventing either would put a fabricated masthead on a screenshot of a federal
 * document, which is the single worst thing this format could ship.
 *
 * @throws {@link ElementAdapterError} `INVALID_DOCUMENT` when a field is missing
 * or blank, naming the beat and the expected grammar.
 */
export function adaptDocumentToElementProps(
  raw: string,
  beat: string,
): ElementProps {
  const parts = raw.split(DOCUMENT_FIELD_SEPARATOR).map((p) => p.trim());
  const field = (index: number): string =>
    index < parts.length ? parts[index] : "";
  const headlineText = field(0);
  const publication = field(1);
  const dateText = field(2);
  const excerpt = field(3);

  if (
    headlineText.length === 0 ||
    publication.length === 0 ||
    dateText.length === 0
  ) {
    throw new ElementAdapterError(
      "INVALID_DOCUMENT",
      `beat "${beat}" has "[doc: ${raw}]", but a document clipping draws a ` +
        `headline, a publication and a date, and the renderer throws on a ` +
        `missing one. Write ` +
        `"[doc: <headline> ${DOCUMENT_FIELD_SEPARATOR} <publication> ` +
        `${DOCUMENT_FIELD_SEPARATOR} <date> ` +
        `[${DOCUMENT_FIELD_SEPARATOR} <excerpt>]]". None of the three can be ` +
        `derived — the citation host is where the document is served, not who ` +
        `published it — and a fabricated masthead on a federal document is not ` +
        `something this format ships.`,
    );
  }
  if (parts.length > 4) {
    throw new ElementAdapterError(
      "INVALID_DOCUMENT",
      `beat "${beat}" has "[doc: ${raw}]" with ${parts.length} ` +
        `"${DOCUMENT_FIELD_SEPARATOR}"-separated fields; a clipping takes at ` +
        `most four (headline, publication, date, excerpt).`,
    );
  }

  return props({
    headlineText,
    publication,
    dateText,
    excerpt: excerpt.length === 0 ? undefined : excerpt,
  });
}

/** The headline a `[doc:]` beat shows on screen — its first field. */
export function documentHeadline(raw: string, beat: string): string {
  const first = raw.split(DOCUMENT_FIELD_SEPARATOR)[0].trim();
  if (first.length === 0) {
    throw new ElementAdapterError(
      "INVALID_DOCUMENT",
      `beat "${beat}" has "[doc: ${raw}]" with no document name before the ` +
        `first "${DOCUMENT_FIELD_SEPARATOR}".`,
    );
  }
  return first;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The formatters below mirror
 * `apps/worker-render/src/remotion/business-hub/formula/format.ts`.
 *
 * `Intl.NumberFormat` is deliberately not used, for the reason M4 states: it
 * depends on the ICU build of whatever runtime is running, so a locale
 * difference between the dev box and a render node would change a thousands
 * separator inside a cached segment — and the cache key would not know.
 */

function assertFinite(value: number, context: string): number {
  if (!Number.isFinite(value)) {
    throw new ElementAdapterError(
      "INVALID_VALUE_FORMAT",
      `${context}: expected a finite number, got ${String(value)}. A figure that ` +
        `could not be computed must fail here, never render as a placeholder.`,
    );
  }
  return value;
}

/** Round half away from zero, so -0.5 and 0.5 round symmetrically. */
function roundHalfAwayFromZero(value: number, decimals: number): number {
  assertFinite(value, "roundHalfAwayFromZero");
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const nudged = scaled + scaled * 1e-12;
  return Math.sign(value) * (Math.round(nudged) / factor);
}

function groupThousands(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

interface NumberTextOptions {
  readonly decimals?: number;
  readonly group?: boolean;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Formats a number for a term or a caption. @throws on a non-finite value. */
function formatNumberText(
  value: number,
  options: NumberTextOptions = {},
): string {
  assertFinite(value, "formatNumberText");
  const decimals = options.decimals ?? 0;
  const group = options.group ?? true;

  const rounded = roundHalfAwayFromZero(value, decimals);
  const negative = rounded < 0;
  const magnitude = Math.abs(rounded);

  const scaled = Math.round(magnitude * 10 ** decimals + 1e-6).toString();
  const padded = scaled.padStart(decimals + 1, "0");
  const wholeDigits = padded.slice(0, padded.length - decimals) || "0";
  const fractionDigits =
    decimals > 0 ? padded.slice(padded.length - decimals) : "";

  const whole = group ? groupThousands(wholeDigits) : wholeDigits;
  const body = decimals > 0 ? `${whole}.${fractionDigits}` : whole;

  // U+2212, not a hyphen: a hyphen next to "$" at 64px reads as a typo.
  return `${negative ? "−" : ""}${options.prefix ?? ""}${body}${options.suffix ?? ""}`;
}

/** US dollars, whole units by default. */
export function formatUsd(value: number, decimals = 0): string {
  return formatNumberText(value, { decimals, prefix: "$" });
}

/** A ratio such as a DSCR: two decimals, ungrouped. */
export function formatRatio(value: number, decimals = 2): string {
  return formatNumberText(value, { decimals, group: false });
}

/** A count of things. */
export function formatCount(value: number, decimals = 0): string {
  return formatNumberText(value, { decimals });
}

/** A fraction drawn as a percentage: `0.075` → `"7.5%"`. */
export function formatPercent(fraction: number, decimals = 1): string {
  assertFinite(fraction, "formatPercent");
  return formatNumberText(fraction * 100, {
    decimals,
    group: false,
    suffix: "%",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FormulaReveal steps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `FormulaReveal` beat-list shape, mirroring M4's
 * `apps/worker-render/src/remotion/business-hub/formula/types.ts`.
 *
 * Structural duplicates rather than imports, again because `apps/worker-render`
 * is an app: the orchestrator cannot import from it. The renderer re-reads every
 * field out of `scene.data` (`reqFormulaSteps`) and then runs M4's
 * `validateSteps` over the result, so a drift between these declarations and
 * M4's is a named render failure, not a wrong frame. `element-adapter.test.ts`
 * runs the steps this module produces through M4's real `validateSteps`, which
 * is dependency-free, so the duplication is checked rather than trusted.
 */
export type FormulaTermRole =
  | "value"
  | "label"
  | "operator"
  | "relation"
  | "paren-open"
  | "paren-close"
  | "unit";

interface FormulaNodeBase {
  readonly id: string;
  readonly replaces?: readonly string[];
  readonly emphasis?: "muted" | "normal" | "strong";
  readonly tone?: "neutral" | "positive" | "negative";
  readonly scale?: number;
}

export interface FormulaTermNode extends FormulaNodeBase {
  readonly type: "term";
  readonly text: string;
  readonly role: FormulaTermRole;
}

export interface FormulaFractionNode extends FormulaNodeBase {
  readonly type: "fraction";
  readonly numerator: readonly FormulaNode[];
  readonly denominator: readonly FormulaNode[];
}

export type FormulaNode = FormulaTermNode | FormulaFractionNode;

export interface FormulaAnnotation {
  readonly spanIds: readonly string[];
  readonly caption: string;
  readonly style?: "brace" | "rule";
}

export interface FormulaResult {
  readonly value: string;
  readonly status: "pass" | "fail" | "neutral";
  readonly label?: string;
  readonly caption?: string;
}

interface FormulaStepBase {
  readonly terms: readonly FormulaNode[];
  readonly label?: string;
  readonly highlightIds?: readonly string[];
}

export type FormulaStep =
  | (FormulaStepBase & { readonly kind: "introduce" })
  | (FormulaStepBase & { readonly kind: "substitute" })
  | (FormulaStepBase & { readonly kind: "simplify" })
  | (FormulaStepBase & {
      readonly kind: "annotate";
      readonly annotation?: FormulaAnnotation;
    })
  | (FormulaStepBase & {
      readonly kind: "result";
      readonly result: FormulaResult;
    });

/**
 * The "why 1.25 DSCR" derivation: six beats — the ratio's shape, what sits under
 * the line, this plan's own figures, the division, the programme minimum, and
 * the landing.
 *
 * It FORMATS; it does not calculate. Every number is read straight off the
 * finance-kit result, including the verdict (`meetsThreshold`), because the
 * component must never re-derive eligibility from a rounded display string:
 * `1.249` prints as `1.25` and would flip a rejection into an approval.
 *
 * Kept byte-compatible with `buildDscrSteps` in M4's `formula/presets.ts` — that
 * copy previews the composition in Remotion Studio, this one feeds the render —
 * and pinned to M4's `validateSteps` by a test.
 *
 * @throws {@link ElementAdapterError} when a figure on the result is not finite.
 */
export function buildDscrSteps(result: DscrResult): FormulaStep[] {
  const dscrLabel: FormulaTermNode = {
    type: "term",
    id: "dscr-label",
    text: "DSCR",
    role: "label",
    emphasis: "strong",
  };
  const equals: FormulaTermNode = {
    type: "term",
    id: "equals",
    text: "=",
    role: "relation",
  };
  const noiLabel: FormulaTermNode = {
    type: "term",
    id: "noi-label",
    text: "Net operating income",
    role: "label",
  };
  const debtLabel: FormulaTermNode = {
    type: "term",
    id: "debt-label",
    text: "Annual debt service",
    role: "label",
  };
  const noiValue: FormulaTermNode = {
    type: "term",
    id: "noi-value",
    text: formatUsd(result.netOperatingIncome),
    role: "value",
    replaces: ["noi-label"],
  };
  const debtValue: FormulaTermNode = {
    type: "term",
    id: "debt-value",
    text: formatUsd(result.annualDebtService),
    role: "value",
    replaces: ["debt-label"],
  };
  const ratio: FormulaTermNode = {
    type: "term",
    id: "ratio",
    text: formatRatio(result.dscr),
    role: "value",
    replaces: ["fraction", "noi-value", "debt-value"],
  };
  const comparison: FormulaTermNode = {
    type: "term",
    id: "comparison",
    // The verdict finance-kit already made; never re-compared here.
    text: result.meetsThreshold ? "≥" : "<",
    role: "relation",
  };
  const threshold: FormulaTermNode = {
    type: "term",
    id: "threshold",
    text: formatRatio(result.threshold),
    role: "value",
    emphasis: "muted",
  };

  const labelledFraction: FormulaNode = {
    type: "fraction",
    id: "fraction",
    numerator: [noiLabel],
    denominator: [debtLabel],
  };
  const numericFraction: FormulaNode = {
    type: "fraction",
    id: "fraction",
    numerator: [noiValue],
    denominator: [debtValue],
  };

  const shape: readonly FormulaNode[] = [dscrLabel, equals, labelledFraction];
  const collapsed: readonly FormulaNode[] = [dscrLabel, equals, ratio];
  const compared: readonly FormulaNode[] = [
    dscrLabel,
    equals,
    { ...ratio, replaces: [] },
    comparison,
    threshold,
  ];

  return [
    {
      kind: "introduce",
      label: "the ratio every lender starts with",
      terms: shape,
    },
    {
      kind: "annotate",
      label: "what sits under the line",
      terms: shape,
      highlightIds: ["debt-label"],
      annotation: {
        spanIds: ["debt-label"],
        caption:
          "what the lender divides by — twelve months of principal and interest",
        style: "brace",
      },
    },
    {
      kind: "substitute",
      label: "this plan's own figures",
      terms: [dscrLabel, equals, numericFraction],
    },
    {
      kind: "simplify",
      label: "divide",
      terms: collapsed,
    },
    {
      kind: "introduce",
      label: "against the programme minimum",
      terms: compared,
    },
    {
      kind: "result",
      terms: compared,
      result: {
        value: formatRatio(result.dscr),
        status: result.meetsThreshold ? "pass" : "fail",
        caption: result.meetsThreshold
          ? `Clears the ${formatRatio(result.threshold)} minimum`
          : `Falls short of the ${formatRatio(result.threshold)} minimum`,
      },
    },
  ];
}

/**
 * Re-exported so the planner's element registries can be typed against the same
 * union the renderer dispatches on, without importing two modules.
 */
export { isBusinessHubMgElementName };
export type { BusinessHubMgElementName };
