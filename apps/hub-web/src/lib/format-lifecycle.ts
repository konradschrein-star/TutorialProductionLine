import {
  getFormatLifecycle,
  type FormatLifecycle,
} from "@repo/contracts";

/**
 * Operator-facing lifecycle gate.
 *
 * `@repo/contracts` owns the canonical `FORMAT_LIFECYCLE` map (ACTIVE / IDLE /
 * RETIRED). This module is the single place that decides whether hub-web
 * *offers* a format to an operator, because that decision needs one thing
 * contracts must not have: environment.
 *
 * An IDLE format (POLITICAL_COMMENTARY, BUNDESTAG) is parked, not deleted. Its
 * code is retained and expected to come back, so it must stay reachable — but
 * deliberately, never by accident. Set `CF_ENABLE_IDLE_FORMATS` to a
 * comma-separated list of format ids to re-enable them:
 *
 *   CF_ENABLE_IDLE_FORMATS=BUNDESTAG
 *   CF_ENABLE_IDLE_FORMATS=BUNDESTAG,POLITICAL_COMMENTARY
 *   CF_ENABLE_IDLE_FORMATS=*        # all idle formats
 *
 * Server-side only — read `process.env` here, never in a client component.
 * RETIRED formats are never offered; the env var cannot resurrect them.
 *
 * Caveat: the env var re-opens the *gate*, it does not rebuild a pipeline.
 * Today it genuinely restores BUNDESTAG (form + workers + renderer all intact).
 * For POLITICAL_COMMENTARY the create form and seed template were deleted in
 * commit `031771d7`, so enabling it is necessary but not sufficient — see
 * docs/FORMAT_REGISTRIES.md.
 */

function enabledIdleFormats(): Set<string> {
  const raw = process.env.CF_ENABLE_IDLE_FORMATS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

/** True if `CF_ENABLE_IDLE_FORMATS` deliberately re-enables this idle format. */
export function isIdleFormatEnabled(format: string): boolean {
  const enabled = enabledIdleFormats();
  return enabled.has("*") || enabled.has(format.toUpperCase());
}

/**
 * Should this format be offered as a choice when creating a job?
 *
 * ACTIVE  → always.
 * IDLE    → only when explicitly enabled via `CF_ENABLE_IDLE_FORMATS`.
 * RETIRED → never.
 */
export function isFormatOfferedToOperators(format: string): boolean {
  const lifecycle = getFormatLifecycle(format);
  if (lifecycle === "ACTIVE") return true;
  if (lifecycle === "IDLE") return isIdleFormatEnabled(format);
  return false;
}

/**
 * UI status for a format card. `IDLE` renders as a distinct, honest badge —
 * not "Coming Soon" (it already exists) and not "Retired" (it is coming back).
 */
export type FormatCardStatus = "ACTIVE" | "IDLE" | "RETIRED";

export function getFormatCardStatus(format: string): FormatCardStatus {
  const lifecycle: FormatLifecycle = getFormatLifecycle(format);
  if (lifecycle === "IDLE" && isIdleFormatEnabled(format)) return "ACTIVE";
  return lifecycle;
}
