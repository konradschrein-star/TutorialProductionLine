/**
 * The branding contract — what a thumbnail MUST carry before it is allowed to
 * exist at all.
 *
 * WHY THIS EXISTS
 * ---------------
 * The engine was willing to generate a thumbnail from nothing but a title. On
 * production that produced, verifiably, eight completed tutorial thumbnails
 * with `channel_id IS NULL` — no channel, therefore no host character, and in
 * one case no archetype either. They came out as unstyled stock images with an
 * invented human on them, sitting in the gallery next to properly branded ones.
 * The owner's words: "the thumbnails that they were generating were missing a
 * proper template ... they all get the correct thumbnail reference and then
 * person reference also".
 *
 * The rule is therefore: for a format whose videos ship on a branded channel
 * with a named on-camera host, a thumbnail without that channel, that template
 * and that face is NOT a degraded thumbnail — it is the wrong thumbnail, and it
 * must fail loudly rather than be produced. This is the "no synthetic
 * fallbacks" house rule applied to branding: we refuse, with diagnostics,
 * instead of substituting something plausible.
 *
 * WHY IT IS SCOPED THE WAY IT IS
 * ------------------------------
 * Two axes, and both are load-bearing:
 *
 *   FORMAT — only formats listed in BRANDED_FORMATS are contractually branded.
 *     TUTORIAL_STUDIO is the owner's three tutorial channels, which is exactly
 *     what he asked about. Widening this to every format would start failing
 *     content jobs that have legitimately never had a channel persona, which is
 *     a different (and unrequested) product decision.
 *
 *   SUBJECT — only real jobs (`content_job` / `tutorial_job`) are held to it.
 *     A `studio` or `test` render is a scratch render an operator asked for by
 *     hand; refusing those would break the Thumbnail Studio's own preview
 *     button for no benefit. Nothing ships from them.
 *
 * Pure and dependency-free so the policy can be tested without a database.
 */

/** Where a generated thumbnail is attached. Mirrors `thumbnail_subject_kind`. */
export type ThumbnailSubjectKind =
  | "content_job"
  | "tutorial_job"
  | "studio"
  | "test";

export interface BrandingContract {
  /** The subject must be attached to a channel. */
  requiresChannel: boolean;
  /** That channel must have a host character with at least one usable image. */
  requiresHostCharacter: boolean;
  /** A reference template (archetype) must have been resolved. */
  requiresArchetype: boolean;
}

/** What the engine actually managed to resolve for this request. */
export interface BrandingInputs {
  channelId: string | null;
  /** The host character's name, or null when none could be resolved. */
  hostCharacterName: string | null;
  /** The archetype id, or null when none could be resolved. */
  archetypeId: string | null;
}

const UNBRANDED: BrandingContract = {
  requiresChannel: false,
  requiresHostCharacter: false,
  requiresArchetype: false,
};

const FULLY_BRANDED: BrandingContract = {
  requiresChannel: true,
  requiresHostCharacter: true,
  requiresArchetype: true,
};

/**
 * Formats whose videos ship on a branded channel with a named on-camera host.
 *
 * Adding a format here is a product decision, not a cleanup: it will start
 * failing that format's thumbnails until every one of its channels has a host
 * character bound in the Character Library.
 */
export const BRANDED_FORMATS: ReadonlySet<string> = new Set([
  "TUTORIAL_STUDIO",
]);

/** Subjects that become a shipped video. Scratch renders are exempt. */
const SHIPPABLE_SUBJECTS: ReadonlySet<string> = new Set([
  "content_job",
  "tutorial_job",
]);

export function brandingContractFor(
  format: string,
  subjectKind: string,
): BrandingContract {
  if (!SHIPPABLE_SUBJECTS.has(subjectKind)) return UNBRANDED;
  return BRANDED_FORMATS.has(format) ? FULLY_BRANDED : UNBRANDED;
}

/**
 * Check the resolved inputs against the contract.
 *
 * Returns null when the contract is met, or an operator-actionable refusal
 * reason naming EVERY missing piece at once — reporting them one at a time
 * would mean three round trips through a failed render to learn three facts
 * that were all known at the same moment.
 */
export function checkBrandingContract(
  contract: BrandingContract,
  inputs: BrandingInputs,
  context: { format: string; subjectId: string },
): string | null {
  const missing: string[] = [];

  if (contract.requiresChannel && !inputs.channelId) {
    missing.push(
      "no channel is attached to this job (so no branding can be resolved at all) " +
        "— set the channel on the job, or on the assistant who created it",
    );
  }
  if (contract.requiresArchetype && !inputs.archetypeId) {
    missing.push(
      "no thumbnail template (archetype) could be resolved — curate archetypes " +
        "for this channel, or seed the global archetype library, in Thumbnail " +
        "Studio > Archetypes",
    );
  }
  if (contract.requiresHostCharacter && !inputs.hostCharacterName) {
    missing.push(
      inputs.channelId
        ? `channel ${inputs.channelId} has no host character with a usable image — ` +
            "bind a character with role 'host' and at least one active image in " +
            "the Character Library (/characters)"
        : "no host character could be resolved (no channel)",
    );
  }

  if (missing.length === 0) return null;

  return (
    `${context.format} thumbnails are contractually branded: they must carry ` +
    `the channel's template AND the channel's host character. Refusing to ` +
    `generate an unbranded thumbnail for ${context.subjectId}. ` +
    `Missing: ${missing.join("; ")}.`
  );
}
