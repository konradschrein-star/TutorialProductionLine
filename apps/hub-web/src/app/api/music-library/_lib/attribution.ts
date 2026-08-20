/**
 * Credits / attribution rendering for music tracks.
 *
 * The point of storing `creator`, `license`, `source_url` and
 * `attribution_required` is this module: once operations industrialise, the
 * credit block under a video should be generated, not hand-written.
 *
 * Design rule: this never guesses. A track whose creator is unknown is
 * reported as unknown so it can be fixed, rather than being quietly dropped
 * from the credits or attributed to the wrong artist.
 */

export interface AttributableTrack {
  id: string;
  name: string;
  creator: string | null;
  source: string;
  license: string | null;
  source_url: string | null;
  attribution_required: boolean;
  attribution_text: string | null;
}

export interface CreditLine {
  trackId: string;
  /** The rendered credit line. */
  text: string;
  /** True when the licence obliges us to publish this line. */
  required: boolean;
}

export interface AttributionReport {
  /** One line per track that has something creditable, de-duplicated. */
  lines: CreditLine[];
  /**
   * Tracks that legally require attribution but lack the data to produce it.
   * These are a publishing blocker, not a warning to be swallowed.
   */
  unattributable: Array<{ trackId: string; name: string; reason: string }>;
  /** Tracks intentionally excluded (self-generated, no credit owed). */
  skipped: Array<{ trackId: string; name: string; reason: string }>;
}

/**
 * Sources that are ours — generated on our own subscription. No third party to
 * credit, so they are skipped unless the operator has explicitly set an
 * attribution_text.
 */
const SELF_GENERATED_SOURCES = new Set(["suno_ai33", "minimax_ai33"]);

/**
 * Render one credit line for a track.
 *
 * Precedence:
 *   1. An explicit `attribution_text` always wins — some licences dictate
 *      exact wording, and we must not paraphrase it.
 *   2. Otherwise compose "<name> by <creator>" plus licence and URL when known.
 */
export function renderCreditLine(track: AttributableTrack): string | null {
  if (track.attribution_text && track.attribution_text.trim()) {
    return track.attribution_text.trim();
  }

  const creator = track.creator?.trim();
  if (!creator) return null;

  let line = `"${track.name.trim()}" by ${creator}`;

  const license = track.license?.trim();
  if (license) line += ` (${license})`;

  const url = track.source_url?.trim();
  if (url) line += ` — ${url}`;

  return line;
}

/**
 * Build the full attribution report for a set of tracks.
 *
 * De-duplicates identical credit lines: a video that reuses four tracks by the
 * same artist under the same licence should not print four identical lines.
 */
export function buildAttributionReport(
  tracks: AttributableTrack[],
): AttributionReport {
  const lines: CreditLine[] = [];
  const unattributable: AttributionReport["unattributable"] = [];
  const skipped: AttributionReport["skipped"] = [];
  const seen = new Map<string, number>();

  for (const track of tracks) {
    const explicit =
      track.attribution_text !== null &&
      track.attribution_text.trim().length > 0;

    if (
      SELF_GENERATED_SOURCES.has(track.source) &&
      !explicit &&
      !track.attribution_required
    ) {
      skipped.push({
        trackId: track.id,
        name: track.name,
        reason: "self-generated — no third-party credit owed",
      });
      continue;
    }

    const text = renderCreditLine(track);

    if (!text) {
      if (track.attribution_required) {
        unattributable.push({
          trackId: track.id,
          name: track.name,
          reason: "attribution is required but no creator is recorded",
        });
      } else {
        skipped.push({
          trackId: track.id,
          name: track.name,
          reason: "no creator recorded and attribution is not required",
        });
      }
      continue;
    }

    const existingIdx = seen.get(text);
    if (existingIdx !== undefined) {
      // Keep the strictest requirement across duplicates.
      const existing = lines[existingIdx];
      if (existing && track.attribution_required) existing.required = true;
      continue;
    }

    seen.set(text, lines.length);
    lines.push({
      trackId: track.id,
      text,
      required: track.attribution_required,
    });
  }

  return { lines, unattributable, skipped };
}

/**
 * Render the report as a plain-text credit block, ready to paste into a
 * YouTube description.
 */
export function renderCreditsBlock(
  report: AttributionReport,
  opts: { heading?: string } = {},
): string {
  const heading = opts.heading ?? "Music";
  if (report.lines.length === 0) return "";
  return [heading, ...report.lines.map((l) => `· ${l.text}`)].join("\n");
}

/**
 * True when the set cannot be published as-is: something legally requires a
 * credit we are unable to produce. Callers should surface this, not ignore it.
 */
export function hasBlockingAttributionGaps(report: AttributionReport): boolean {
  return report.unattributable.length > 0;
}
