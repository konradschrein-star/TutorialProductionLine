/**
 * Clip Forge — presentational lookups.
 *
 * Colours and initials only. Nothing here produces data.
 *
 * This file was `synth.ts`: 486 lines whose bulk was `genCfData()`, a seeded-RNG
 * generator that fabricated sources, clips, accounts, distributions, errors,
 * presets and caption pools for the prototype. The console has loaded real rows
 * from `/api/v1/clip-forge/console` for a long time and `genCfData` had zero
 * importers, but it stayed in the tree next to the live helpers and lent the
 * word "synth" to imports in six real screens. Deleted 2026-07-28, along with
 * `spark()` (whose only caller drew a sine wave labelled "View trend · 16d")
 * and `fmtClock()` (unused; the shell inlines its own).
 */

const STATUS_COLORS: Record<string, string> = {
  // Sources
  ingested: "#7b93d4",
  extracting: "#cf9e68",
  extracted: "#57a578",
  duplicate: "#b388c9",
  failed: "#cf7468",
  // Clips
  classified: "#7b93d4",
  finishing: "#cf9e68",
  pooled: "#57a578",
  depooled: "#7b848e",
  // Distributions
  assigned: "#7b93d4",
  rendered: "#7b93d4",
  qc_pass: "#57a578",
  qc_flag: "#b388c9",
  qc_fail: "#cf7468",
  queued: "#cf9e68",
  live: "#57a578",
  skipped: "#7b848e",
};

/**
 * Colour + label for a status pill. Unknown statuses get a neutral grey rather
 * than throwing — this is decoration, and a new enum value should not blank a
 * screen.
 */
export function statusMeta(s: string) {
  const color = STATUS_COLORS[s] ?? "#7b848e";
  // `bg` is the same hue at ~13% alpha — the pill tint used across the console.
  return { color, bg: color + "22", label: s };
}

const PERSONA_META: Record<string, { initials: string; color: string }> = {
  "Marck Gebauer": { initials: "MG", color: "#b388c9" },
};

/**
 * Initials + colour for a persona chip. Falls back to the first two initials
 * of the name, then to a neutral placeholder.
 */
export function personaMeta(name: string) {
  const known = PERSONA_META[name];
  if (known) return { ...known, bg: known.color + "22" };
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "··";
  return { initials, color: "#6b727b", bg: "#6b727b22" };
}
