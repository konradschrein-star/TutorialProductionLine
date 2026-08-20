import { z } from "zod";

/**
 * BUSINESS_PLAN_HUB — presenter pose hitbox contracts.
 *
 * Implements the hitbox model in section 6.2 of
 * `docs/superpowers/specs/2026-08-15-business-plan-hub-format-design.md`, plus
 * the on-disk shape of `media/style-assets/presenter/poses/poses.json` as it
 * actually exists today (read 2026-08-15: 16 entries, every one of them
 * `head_anchor: null` / `anchor_status: "needs-calibration"`).
 *
 * ALL hitbox geometry is normalised to 0..1 against the pose PNG's own pixel
 * size, so every consumer is resolution- and scale-independent. The Presenter
 * Studio (task U1) authors these values; **nothing may invent them** — a pose
 * missing a required hitbox fails the build (design §8 rule 2).
 *
 * Dependency-free beyond zod: this file is bundled into the Remotion browser
 * build.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Normalised primitives
// ─────────────────────────────────────────────────────────────────────────────

/** A 0..1 fraction of the pose image's width or height. */
const unitScalar = () => z.number().min(0).max(1).finite();

/** A point in normalised pose-image space. `(0,0)` is top-left. */
export const NormPointSchema = z.object({
  x: unitScalar(),
  y: unitScalar(),
});
export type NormPoint = z.infer<typeof NormPointSchema>;

/**
 * A direction in normalised pose-image space. Components run -1..1 (a vector
 * may point up/left), and the zero vector is rejected: "points nowhere" is not
 * a direction, and a layout that rotated to it would silently pick 0°.
 */
export const NormVectorSchema = z
  .object({
    x: z.number().min(-1).max(1).finite(),
    y: z.number().min(-1).max(1).finite(),
  })
  .superRefine((v, ctx) => {
    if (Math.hypot(v.x, v.y) < 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "pointDirection is the zero vector — a pose that points at nothing cannot drive object rotation. Re-author it in the Presenter Studio.",
      });
    }
  });
export type NormVector = z.infer<typeof NormVectorSchema>;

/**
 * An axis-aligned rectangle in normalised pose-image space, given as
 * top-left + size. The rect must stay inside the image: a safe region or crop
 * that runs off the edge would silently clamp at render time.
 */
export const NormRectSchema = z
  .object({
    x: unitScalar(),
    y: unitScalar(),
    w: z.number().gt(0).max(1).finite(),
    h: z.number().gt(0).max(1).finite(),
  })
  .superRefine((r, ctx) => {
    if (r.x + r.w > 1 + 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["w"],
        message: `rect extends past the right edge (x + w = ${r.x + r.w}, must be <= 1)`,
      });
    }
    if (r.y + r.h > 1 + 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["h"],
        message: `rect extends past the bottom edge (y + h = ${r.y + r.h}, must be <= 1)`,
      });
    }
  });
export type NormRect = z.infer<typeof NormRectSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Hitboxes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where the flat circular head mark sits, and how big it is. `radius` is a
 * fraction of the pose image's WIDTH (one axis, so the mark stays circular).
 * Consumed by head placement and the narration-RMS scale pump.
 */
export const HeadHitboxSchema = z.object({
  center: NormPointSchema,
  radius: z.number().gt(0).max(1).finite(),
});
export type HeadHitbox = z.infer<typeof HeadHitboxSchema>;

/**
 * Collar width as a fraction of the pose image width. This is the
 * apparent-scale normaliser: the poses were matted from crops ranging from
 * 424x1088 to 2752x1442 (~6x swing), and cutting between them without
 * normalising makes the presenter teleport. Every pose is scaled so its collar
 * subtends the same on-screen width.
 */
export const CollarHitboxSchema = z.object({
  width: z.number().gt(0).max(1).finite(),
});
export type CollarHitbox = z.infer<typeof CollarHitboxSchema>;

/**
 * The complete hitbox set for one pose. Every member is REQUIRED — this type
 * only exists in its calibrated form. A partially-authored pose is represented
 * by the ABSENCE of `hitboxes` on {@link PoseSchema}, never by a half-filled
 * object with guessed members.
 */
export const PoseHitboxesSchema = z.object({
  /** Head mark placement + volume pump. */
  head: HeadHitboxSchema,
  /** Apparent-scale normalisation across poses. */
  collar: CollarHitboxSchema,
  /** Start of the pointing vector — the hand. */
  pointOrigin: NormPointSchema,
  /** Object rotation in `framed-chart`; layout side selection. */
  pointDirection: NormVectorSchema,
  /** Where a layout may place objects without occluding the figure. */
  safeRegion: NormRectSchema,
  /**
   * Per-pose framing rect used when a layout crops the figure.
   * NOTE: normalised 0..1 — distinct from {@link PoseSchema}'s `crop`, which is
   * the PIXEL rect the PNG was matted from out of the source JPEG.
   */
  crop: NormRectSchema,
});
export type PoseHitboxes = z.infer<typeof PoseHitboxesSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// poses.json
// ─────────────────────────────────────────────────────────────────────────────

/** `[width, height]` in pixels. */
export const PixelSizeSchema = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
]);
export type PixelSize = z.infer<typeof PixelSizeSchema>;

/** `[x, y, width, height]` in pixels of the SOURCE image. */
export const PixelRectSchema = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().positive(),
  z.number().int().positive(),
]);
export type PixelRect = z.infer<typeof PixelRectSchema>;

/**
 * Calibration state of a pose entry.
 * - `needs-calibration`: automatic collar detection failed (it locked onto the
 *   white shirt, and onto the tablet in `holding-tablet`), so no anchor was
 *   written. This is the state of all 16 poses on disk today.
 * - `calibrated`: the Presenter Studio wrote real hitboxes.
 */
export const AnchorStatusSchema = z.enum(["needs-calibration", "calibrated"]);
export type AnchorStatus = z.infer<typeof AnchorStatusSchema>;

/**
 * One entry of `media/style-assets/presenter/poses/poses.json`, matching the
 * file as generated by the matting pass. Field names are snake_case because
 * that is what is on disk — do not "tidy" them without rewriting the file.
 */
export const PoseSchema = z.object({
  /** Original JPEG filename the PNG was matted from. */
  source: z.string().min(1),
  source_size: PixelSizeSchema,
  /** Pixel rect within the source JPEG that became the PNG. */
  crop: PixelRectSchema,
  /** Fraction of the crop covered by non-transparent pixels. */
  coverage: z.number().min(0).max(1).finite(),
  /** Count of partially-transparent edge pixels; a matte-quality signal. */
  soft_edge_px: z.number().int().min(0),
  /**
   * Legacy pixel head anchor from the failed automatic pass. `null` on every
   * pose on disk, and it stays null — {@link PoseHitboxesSchema} `head`
   * supersedes it. Kept so the file round-trips without data loss.
   */
  head_anchor: z
    .tuple([z.number().finite(), z.number().finite()])
    .nullable()
    .default(null),
  /** Stable slug used by `scene.presenter.pose`. */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** PNG filename inside `poses/`. */
  file: z.string().min(1),
  /** PNG pixel size — the space `hitboxes` are normalised against. */
  size: PixelSizeSchema,
  anchor_status: AnchorStatusSchema,
  /**
   * Authored in the Presenter Studio. ABSENT until calibration runs; when
   * present, complete. Render paths must use {@link CalibratedPoseSchema} so an
   * uncalibrated pose fails the build instead of being placed by guesswork.
   */
  hitboxes: PoseHitboxesSchema.optional(),
});
export type Pose = z.infer<typeof PoseSchema>;

/**
 * A pose that is actually usable in a render: `anchor_status: "calibrated"` AND
 * a complete hitbox set. Parse with this at every point that places a figure.
 */
export const CalibratedPoseSchema = PoseSchema.extend({
  anchor_status: z.literal("calibrated"),
  hitboxes: PoseHitboxesSchema,
});
export type CalibratedPose = z.infer<typeof CalibratedPoseSchema>;

/**
 * The whole `poses.json` file: a non-empty array with unique slugs and unique
 * files. Duplicate slugs would make `scene.presenter.pose` ambiguous, so they
 * are rejected rather than last-one-wins.
 */
export const PoseManifestSchema = z
  .array(PoseSchema)
  .min(1)
  .superRefine((poses, ctx) => {
    const seenSlugs = new Set<string>();
    const seenFiles = new Set<string>();
    poses.forEach((pose, index) => {
      if (seenSlugs.has(pose.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "slug"],
          message: `duplicate pose slug "${pose.slug}" — scene.presenter.pose would be ambiguous`,
        });
      }
      seenSlugs.add(pose.slug);
      if (seenFiles.has(pose.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "file"],
          message: `duplicate pose file "${pose.file}"`,
        });
      }
      seenFiles.add(pose.file);
    });
  });
export type PoseManifest = z.infer<typeof PoseManifestSchema>;

/** A `poses.json` in which every entry is render-ready. */
export const CalibratedPoseManifestSchema = z
  .array(CalibratedPoseSchema)
  .min(1);
export type CalibratedPoseManifest = z.infer<
  typeof CalibratedPoseManifestSchema
>;
