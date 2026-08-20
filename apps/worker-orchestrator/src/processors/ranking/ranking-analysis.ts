import { RankingPlanSchema, type RankingPlan } from "@repo/contracts";

const JSON_FENCE = /```json\s*([\s\S]*?)```/i;

/**
 * Every fenced block, not just the JSON one. Used to STRIP fences from the
 * narration.
 *
 * The old code stripped with the non-global JSON_FENCE above, which removes
 * exactly one block. Anything else fenced — a model that re-states the plan, a
 * stray ``` it never closed properly, a bare ``` on its own line — survived
 * into `scriptText` and was handed verbatim to Fish Audio, which reads
 * backticks and JSON out loud. Ranking output is JSON-plus-prose by design, so
 * this is the format most likely to emit a second block.
 */
const ANY_FENCE = /```[\s\S]*?```/g;
/** A fence opener the model never closed — everything after it is not prose. */
const UNCLOSED_FENCE = /```[\s\S]*$/;

/**
 * Parse a RANKING LLM response into a validated RankingPlan.
 *
 * Expected response shape:
 *   ```json
 *   { "placements": [...], "targetRuntimeSeconds": N, "items"?: [...] }
 *   ```
 *   <narration script here>
 *
 * Two modes, keyed on `knownItemIds`:
 *   - NON-EMPTY (operator gave explicit items): every placement.itemId MUST be
 *     one of the known ids.
 *   - EMPTY (freeform brief): the LLM chose the items itself and emitted them
 *     in the JSON `items` array; the id-space is derived from that array, and
 *     every placement must reference one of the LLM's own item ids.
 *
 * Throws (with diagnostic) if the JSON block is missing, malformed, references
 * unknown items, has empty placements, or (freeform mode) omits the items
 * array. NEVER falls back to estimated values — silent fallbacks produce garbage.
 */
export function parseRankingScript(
  llmResponse: string,
  knownItemIds: string[],
): RankingPlan {
  const match = llmResponse.match(JSON_FENCE);
  if (!match) {
    throw new Error(
      "ranking-analysis: no ```json block found in LLM response — prompt may have drifted",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ranking-analysis: JSON block did not parse: ${msg}`);
  }

  const scriptText = llmResponse
    .replace(ANY_FENCE, "")
    .replace(UNCLOSED_FENCE, "")
    .trim();
  if (!scriptText) {
    throw new Error(
      "ranking-analysis: empty narration script after JSON block",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `ranking-analysis: JSON block must be an object, got ${parsed === null ? "null" : typeof parsed}`,
    );
  }

  const candidate = { ...parsed, scriptText };

  // Pre-Zod placements check for a clearer error than Zod's generic min(1) message.
  const maybePlacements = (parsed as { placements?: unknown }).placements;
  if (!Array.isArray(maybePlacements) || maybePlacements.length === 0) {
    throw new Error("ranking-analysis: at least one placement required");
  }

  const result = RankingPlanSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `ranking-analysis: RankingPlan schema rejected: ${result.error.message}`,
    );
  }

  // Determine the valid id-space. Freeform mode (no known ids) derives it from
  // the LLM's own emitted items; otherwise the operator's ids are authoritative.
  let known: Set<string>;
  if (knownItemIds.length > 0) {
    known = new Set(knownItemIds);
  } else {
    const emitted = result.data.items ?? [];
    if (emitted.length < 2) {
      throw new Error(
        "ranking-analysis: freeform mode (no operator items) requires the LLM to emit an `items` array with at least 2 items in the JSON block, but it was missing or too short",
      );
    }
    known = new Set(emitted.map((i) => i.id));
  }

  for (const p of result.data.placements) {
    if (!known.has(p.itemId)) {
      throw new Error(
        `ranking-analysis: unknown itemId "${p.itemId}" in placement (known: ${[...known].join(", ")})`,
      );
    }
  }

  assertEveryItemIsNamedInNarration(result.data, knownItemIds, scriptText);

  return result.data;
}

/**
 * Replace em/en dashes with punctuation a voice engine reads correctly.
 *
 * The prompt hard-bans em dashes, and the model still emitted three in the
 * first production script ("...tuned by someone who only tested on a white
 * noise machine—deep rumbles get squashed..."). Written that way, glued to the
 * words on both sides, a TTS engine has no space to break on and either runs
 * the two words together or produces an odd clipped join mid-sentence.
 *
 * This only ever swaps a dash for standard punctuation — it never adds,
 * removes or reorders spoken words, so it cannot paper over a bad script. A
 * dash between words becomes a comma (the pause the author meant); a dash used
 * as a range or left dangling becomes a plain space.
 */
export function normalizeDashesForSpeech(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, (match) => (match.includes("\n") ? " " : ", "))
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",");
}

/**
 * Fail NOW on an item the narration never names.
 *
 * RANKING syncs footage to audio by locating each item's spoken name in the
 * Whisper word stream (see narration-anchoring.ts). Anchoring is
 * all-or-nothing: one unlocatable item and asset-collection throws. That throw
 * currently lands AFTER the pipeline has paid for TTS, run Whisper, and fetched
 * B-roll for every item. The same defect is detectable here, for free, before
 * any of that spend.
 *
 * Deliberately narrow. Anchoring's matcher is fuzzy (idf-weighted windows,
 * model-number tolerance, substring matching), so this check only rejects the
 * one case that is unambiguous: NONE of an item's word-tokens appears anywhere
 * in the narration. Anchoring cannot possibly locate that item, so this can
 * never reject a job that would otherwise have succeeded. Partial matches are
 * left to the real matcher rather than second-guessed with a looser heuristic
 * here, which would risk failing good scripts.
 */
function assertEveryItemIsNamedInNarration(
  plan: RankingPlan,
  knownItemIds: string[],
  scriptText: string,
): void {
  // Only the freeform path exposes names here; when the operator supplied the
  // items, this module never sees their names (it gets ids only), so there is
  // nothing to check and anchoring remains the gate.
  const names =
    knownItemIds.length > 0
      ? []
      : (plan.items ?? []).map((i) => ({ id: i.id, name: i.name }));
  if (names.length === 0) return;

  const haystack = scriptText.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const missing: string[] = [];

  for (const { name } of names) {
    const tokens = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    const anyPresent = tokens.some((t) => haystack.includes(t));
    if (!anyPresent) missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(
      `ranking-analysis: the narration never says ${missing.length === 1 ? "this item's name" : "these item names"} out loud: ` +
        `${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `RANKING anchors each item's on-screen footage to the moment its name is ` +
        `spoken, and anchoring is all-or-nothing — an item that is never named ` +
        `cannot be located, so the job would fail later at ASSET_COLLECTION after ` +
        `already paying for TTS, Whisper and B-roll fetching. Failing here instead. ` +
        `Fix: the script must say each item's name exactly as written in the JSON ` +
        `"items" array, once, at the start of that item's own passage. Retry SCRIPTING.`,
    );
  }
}
