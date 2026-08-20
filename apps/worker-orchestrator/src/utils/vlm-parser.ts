import { z } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("vlm-parser");

// ── VlmLabel schema ──────────────────────────────────────────────────────────
// Must match what vlm-sidecar returns AND what we store in DB.

const SHOT_SCALE_VALUES = [
  "extreme_close",
  "close",
  "medium",
  "wide",
  "extreme_wide",
  "over_shoulder",
  "pov",
  "aerial",
  "unknown",
] as const;

const VlmLabelSchema = z.object({
  description: z.string(),
  shot_scale: z.enum(SHOT_SCALE_VALUES),
  dominant_mood: z.string(),
  tags_characters: z.array(z.string()),
  tags_mood: z.array(z.string()),
  tags_location: z.array(z.string()),
  tags_action: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type VlmLabel = z.infer<typeof VlmLabelSchema>;

// ── 4-pass JSON cascade ──────────────────────────────────────────────────────

/**
 * Attempt 1: direct JSON.parse on trimmed input.
 */
function pass1(raw: string): unknown {
  return JSON.parse(raw.trim());
}

/**
 * Attempt 2: extract the largest balanced-brace block by tracking nesting depth.
 * Handles VLMs that wrap JSON in prose ("Here is the analysis:\n{...}").
 */
function pass2(raw: string): unknown {
  let depth = 0;
  let start = -1;
  let end = -1;

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (start === -1 || end === -1) {
    throw new Error("pass2: no balanced brace block found");
  }

  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Attempt 3: regex extraction of anything that looks like a JSON object.
 * Less precise than pass2 but handles edge cases where brace tracking fails.
 */
function pass3(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("pass3: regex found no JSON object");
  }
  return JSON.parse(match[0]);
}

/**
 * Coerce a raw parsed object to a VlmLabel.
 *
 * The ONE allowed coercion: if shot_scale is not a valid enum value, replace
 * it with "unknown" rather than failing the whole parse. This is sanitization,
 * not a silent fallback — we log a warning and the caller gets a valid object.
 *
 * If confidence is outside [0, 1], clamp it.
 *
 * All other Zod validation failures throw VlmValidationError.
 */
function coerceAndValidate(parsed: unknown, raw: string): VlmLabel {
  // Pre-sanitise before Zod sees it
  if (typeof parsed === "object" && parsed !== null && "shot_scale" in parsed) {
    const obj = parsed as Record<string, unknown>;

    if (
      !SHOT_SCALE_VALUES.includes(
        obj["shot_scale"] as (typeof SHOT_SCALE_VALUES)[number],
      )
    ) {
      logger.warn(
        { shot_scale: obj["shot_scale"] },
        "vlm-parser: shot_scale not in enum — coercing to 'unknown'",
      );
      obj["shot_scale"] = "unknown";
    }

    if (typeof obj["confidence"] === "number") {
      const clamped = Math.min(1, Math.max(0, obj["confidence"]));
      if (clamped !== obj["confidence"]) {
        logger.warn(
          { original: obj["confidence"], clamped },
          "vlm-parser: confidence out of [0,1] — clamping",
        );
        obj["confidence"] = clamped;
      }
    }
  }

  const result = VlmLabelSchema.safeParse(parsed);
  if (!result.success) {
    throw new VlmValidationError(result.error, raw);
  }

  return result.data;
}

// ── Public errors ────────────────────────────────────────────────────────────

export class VlmValidationError extends Error {
  constructor(
    public readonly zodError: z.ZodError,
    public readonly rawText: string,
  ) {
    super(
      `VlmValidationError: Zod schema validation failed. ` +
        `issues=${JSON.stringify(zodError.issues)} ` +
        `raw_preview=${rawText.slice(0, 200)}`,
    );
    this.name = "VlmValidationError";
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse raw VLM JSON output (from Ollama) into a validated VlmLabel.
 *
 * Implements the Frank Sherlock 4-pass cascade:
 *   Pass 1 — Direct JSON.parse
 *   Pass 2 — Extract largest balanced-brace block
 *   Pass 3 — Regex extraction
 *   Pass 4 — Throw with diagnostics (never silently degrade)
 *
 * After a successful parse, the result is validated with Zod.
 * - shot_scale outside the enum is coerced to "unknown" (sanitization)
 * - confidence outside [0,1] is clamped
 * - All other validation failures throw VlmValidationError
 *
 * @throws {Error} VlmParseError if all 4 passes fail
 * @throws {VlmValidationError} if parsed JSON fails Zod validation
 */
export function parseVlmOutput(raw: string): VlmLabel {
  const passes: Array<[string, () => unknown]> = [
    ["pass1 (direct JSON.parse)", () => pass1(raw)],
    ["pass2 (balanced brace extraction)", () => pass2(raw)],
    ["pass3 (regex extraction)", () => pass3(raw)],
  ];

  const errors: string[] = [];

  for (const [name, attempt] of passes) {
    try {
      const parsed = attempt();
      logger.debug({ pass: name }, "vlm-parser: JSON extraction succeeded");
      return coerceAndValidate(parsed, raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug({ pass: name, error: msg }, "vlm-parser: pass failed");
      errors.push(`${name}: ${msg}`);
    }
  }

  // Pass 4: throw — NEVER use a silent fallback
  throw new Error(
    `VlmParseError: all 4 JSON extraction passes failed. ` +
      `raw_length=${raw.length} raw_preview=${raw.slice(0, 200)} ` +
      `errors=${JSON.stringify(errors)}`,
  );
}
