/**
 * Seed the built-in subtitle presets under the v2 config schema.
 *
 * Every preset below is a VALID `RemotionSubtitleConfig` / `FFmpegSubtitleConfig`
 * (schemaVersion 2). Configs are built from `defaultRemotionConfig` /
 * `defaultFfmpegConfig` and override only the fields that give each preset its
 * distinct look — so new schema fields inherit sensible defaults automatically.
 *
 * Re-runnable: upserts by unique `name`.
 *
 * The preset DEFINITIONS are exported (`BUILTIN_SUBTITLE_PRESETS`) with no side
 * effects so tests can validate them without a DB connection. The actual
 * seeding only runs when this file is executed directly.
 *
 * NOTE: this does NOT create any assignments. Presets exist but are UNASSIGNED
 * until a user wires them up via the assignment matrix (/subtitles/assignments).
 * A format with no assignment renders WITHOUT captions.
 */

import { pathToFileURL } from "node:url";
import {
  RemotionConfigSchema,
  FfmpegConfigSchema,
  defaultRemotionConfig,
  defaultFfmpegConfig,
  type RemotionSubtitleConfig,
  type FFmpegSubtitleConfig,
} from "./subtitles/config-schema.js";

// ---------------------------------------------------------------------------
// Merge helpers — override only the fields that matter, inherit the rest.
// ---------------------------------------------------------------------------

type RemotionOverride = Partial<
  Omit<
    RemotionSubtitleConfig,
    "stroke" | "shadow" | "keyword" | "animation" | "background" | "oneWordMode"
  >
> & {
  stroke?: Partial<RemotionSubtitleConfig["stroke"]>;
  shadow?: Partial<RemotionSubtitleConfig["shadow"]>;
  keyword?: Partial<RemotionSubtitleConfig["keyword"]>;
  animation?: Partial<RemotionSubtitleConfig["animation"]>;
  background?: Partial<RemotionSubtitleConfig["background"]>;
  oneWordMode?: Partial<RemotionSubtitleConfig["oneWordMode"]>;
};

function rc(over: RemotionOverride): RemotionSubtitleConfig {
  const {
    stroke,
    shadow,
    keyword,
    animation,
    background,
    oneWordMode,
    ...rest
  } = over;
  return {
    ...defaultRemotionConfig,
    ...rest,
    stroke: { ...defaultRemotionConfig.stroke, ...stroke },
    shadow: { ...defaultRemotionConfig.shadow, ...shadow },
    keyword: { ...defaultRemotionConfig.keyword, ...keyword },
    animation: { ...defaultRemotionConfig.animation, ...animation },
    background: { ...defaultRemotionConfig.background, ...background },
    oneWordMode: { ...defaultRemotionConfig.oneWordMode, ...oneWordMode },
  };
}

/**
 * FFmpeg presets now use the identical canonical style, so this is `rc` under
 * another name. It is kept so each preset definition still states which engine
 * its numbers were authored for.
 */
function fc(over: RemotionOverride): FFmpegSubtitleConfig {
  return rc(over);
}

// ---------------------------------------------------------------------------
// Built-in preset definitions
// ---------------------------------------------------------------------------

export interface BuiltinSubtitlePreset {
  name: string;
  description: string;
  engine: "remotion" | "ffmpeg";
  config: RemotionSubtitleConfig | FFmpegSubtitleConfig;
  tags: string[];
  sortOrder: number;
}

export const BUILTIN_SUBTITLE_PRESETS: BuiltinSubtitlePreset[] = [
  {
    name: "Broadcast",
    description:
      "White text, black outline, no motion. The safe default for long-form 16:9.",
    engine: "remotion",
    tags: ["default", "clean", "long-form"],
    sortOrder: 10,
    config: rc({
      fontFamily: "Montserrat",
      fontWeight: 700,
      // 58 design px = 5.4% of frame height at every resolution and aspect.
      fontSize: 58,
      fontColor: "#FFFFFF",
      textCase: "asIs",
      wordsPerChunk: 5,
      maxWidthPercent: 82,
      safeMarginPercent: 10,
      // CSS centred stroke of 8 => 4px of VISIBLE outline, the 3-4px that
      // caption practice settles on for a ~5% type size.
      stroke: { color: "#000000", width: 8 },
      // A tight, low-opacity shadow under the outline. The outline alone
      // disappears where footage is both bright and high-frequency; the shadow
      // separates the glyph from that texture without reading as a glow.
      shadow: {
        color: "#000000",
        blur: 6,
        strength: 0.5,
        size: 0,
        offsetX: 0,
        offsetY: 2,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        // 3 frames @30fps = 100ms. Long enough not to snap, short enough that
        // the caption is fully legible for effectively its whole life.
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: null,
      },
    }),
  },
  {
    name: "Broadcast Box",
    description:
      "White text on a semi-opaque black plate. For bright or busy footage where an outline is not enough.",
    engine: "remotion",
    tags: ["clean", "high-contrast", "long-form"],
    sortOrder: 20,
    config: rc({
      fontFamily: "Montserrat",
      fontWeight: 600,
      fontSize: 54,
      fontColor: "#FFFFFF",
      textCase: "asIs",
      wordsPerChunk: 5,
      maxWidthPercent: 80,
      safeMarginPercent: 10,
      // The plate provides the contrast; a stroke on top of it only muddies the
      // letterforms.
      stroke: { color: "#000000", width: 0 },
      shadow: {
        color: "#000000",
        blur: 0,
        strength: 0,
        size: 0,
        offsetX: 0,
        offsetY: 0,
        curve: "linear",
      },
      background: {
        enabled: true,
        // 70% black is the plate opacity broadcast captions use: it guarantees
        // contrast without fully blanking the picture behind it.
        color: "#000000B3",
        radius: 6,
        paddingX: 20,
        paddingY: 10,
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: null,
      },
    }),
  },
  {
    name: "Highlight",
    description:
      "White text with the spoken word in yellow. Colour only - nothing moves or resizes.",
    engine: "remotion",
    tags: ["karaoke", "highlight", "default"],
    sortOrder: 30,
    config: rc({
      fontFamily: "Montserrat",
      fontWeight: 700,
      fontSize: 58,
      fontColor: "#FFFFFF",
      textCase: "asIs",
      // 5 words keeps the whole phrase on screen while the highlight moves
      // through it. Reading research is clear that the harm in word-by-word
      // captions comes from REPLACING the surrounding words (which removes
      // parafoveal preview and the ability to re-read); highlighting a word
      // inside a phrase that is already fully visible does not.
      wordsPerChunk: 5,
      maxWidthPercent: 82,
      safeMarginPercent: 10,
      stroke: { color: "#000000", width: 8 },
      shadow: {
        color: "#000000",
        blur: 6,
        strength: 0.5,
        size: 0,
        offsetX: 0,
        offsetY: 2,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        // Explicitly 1. A per-word scale pop is the single clearest "amateur
        // caption" tell, and at 200-500ms per word the pop occupies most of the
        // word's readable life.
        activeWordScale: 1,
        activeWordColor: "#FFE000",
      },
    }),
  },
  {
    name: "Yellow",
    description:
      "All-yellow text with a black outline - the classic high-contrast subtitle.",
    engine: "remotion",
    tags: ["yellow", "high-contrast"],
    sortOrder: 40,
    config: rc({
      fontFamily: "Montserrat",
      fontWeight: 700,
      fontSize: 58,
      // Slightly warm rather than pure #FFFF00: pure yellow clips in chroma
      // subsampling and fringes on the outline after h.264 encoding.
      fontColor: "#FFE000",
      textCase: "asIs",
      wordsPerChunk: 5,
      maxWidthPercent: 82,
      safeMarginPercent: 10,
      stroke: { color: "#000000", width: 8 },
      shadow: {
        color: "#000000",
        blur: 6,
        strength: 0.5,
        size: 0,
        offsetX: 0,
        offsetY: 2,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: null,
      },
    }),
  },
  {
    name: "Shorts",
    description:
      "Vertical-video preset: bold uppercase, heavy outline, yellow spoken word, lifted clear of platform UI.",
    engine: "remotion",
    tags: ["shorts", "vertical", "bold"],
    sortOrder: 50,
    config: rc({
      fontFamily: "Montserrat",
      fontWeight: 900,
      // 52 design px => ~92px on a 1080x1920 canvas. That reads LARGER than the
      // 58px long-form presets despite the smaller number, because this preset
      // is uppercase in a Black weight: cap height is ~0.72em against a ~0.52em
      // x-height, so the visible letters are taller and much heavier.
      //
      // It is also the largest size that FITS. A 9:16 frame gives a caption
      // roughly a third of the line width a 16:9 frame does; at 68px a single
      // word like "CHARACTERS" already overflowed the safe area, which forced
      // the renderers to wrap it themselves — and Chrome and libass then broke
      // it at different words.
      fontSize: 52,
      fontColor: "#FFFFFF",
      textCase: "upper",
      // 3 words is the short-form convention and keeps an uppercase line inside
      // the safe width at this type size.
      wordsPerChunk: 3,
      maxWidthPercent: 88,
      // Vertical platforms overlay their own UI across the bottom of the frame;
      // 20% clears it. This is why the number is per-preset rather than guessed
      // from the aspect ratio.
      safeMarginPercent: 20,
      // 10 centred => 5 design px visible => ~9px on a 1080x1920 canvas.
      stroke: { color: "#000000", width: 10 },
      shadow: {
        color: "#000000",
        blur: 8,
        strength: 0.55,
        size: 0,
        offsetX: 0,
        offsetY: 3,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: "#FFE000",
      },
    }),
  },
  {
    name: "Broadcast (FFmpeg)",
    description:
      "The Broadcast look rendered by libass instead of Remotion - much cheaper on long videos.",
    engine: "ffmpeg",
    tags: ["ffmpeg", "long-form", "fast", "default"],
    sortOrder: 60,
    config: fc({
      fontFamily: "Montserrat",
      fontWeight: 700,
      fontSize: 58,
      fontColor: "#FFFFFF",
      textCase: "asIs",
      wordsPerChunk: 5,
      maxWidthPercent: 82,
      safeMarginPercent: 10,
      stroke: { color: "#000000", width: 8 },
      shadow: {
        color: "#000000",
        blur: 6,
        strength: 0.5,
        size: 0,
        offsetX: 0,
        offsetY: 2,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: null,
      },
    }),
  },
  {
    name: "Highlight (FFmpeg)",
    description:
      "The Highlight look rendered by libass - white text, yellow spoken word, no motion.",
    engine: "ffmpeg",
    tags: ["ffmpeg", "karaoke", "highlight"],
    sortOrder: 70,
    config: fc({
      fontFamily: "Montserrat",
      fontWeight: 700,
      fontSize: 58,
      fontColor: "#FFFFFF",
      textCase: "asIs",
      wordsPerChunk: 5,
      maxWidthPercent: 82,
      safeMarginPercent: 10,
      stroke: { color: "#000000", width: 8 },
      shadow: {
        color: "#000000",
        blur: 6,
        strength: 0.5,
        size: 0,
        offsetX: 0,
        offsetY: 2,
        curve: "easeOut",
      },
      animation: {
        enabled: true,
        caption: "fade",
        word: "none",
        variants: false,
        durationFrames: 3,
        activeWordScale: 1,
        activeWordColor: "#FFE000",
      },
    }),
  },
];

/**
 * Built-ins this file used to define and no longer does.
 *
 * They are NOT deleted: deleting a preset row cascades its assignments away and
 * would silently turn captions off for whatever format pointed at it. The seed
 * deactivates them and re-points their assignments at the closest surviving
 * preset, so an operator who had captions keeps captions.
 */
export const RETIRED_BUILTIN_PRESETS: Record<string, string> = {
  Classic: "Broadcast",
  TikTok: "Shorts",
  Duolingo: "Broadcast Box",
  Horror: "Broadcast",
  Minimal: "Broadcast",
  "Noun Rainbow": "Broadcast",
  Modern: "Broadcast Box",
  Karaoke: "Highlight",
  "Long-form Fast": "Broadcast (FFmpeg)",
};

// ---------------------------------------------------------------------------
// Seeding (side-effecting; runs only when executed directly)
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  // Import DB deps lazily so merely importing this module (e.g. in tests)
  // never opens a connection.
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("./schema/index.js");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log("Seeding built-in subtitle presets (v2 schema)...");
  for (const preset of BUILTIN_SUBTITLE_PRESETS) {
    // Fail fast if a definition drifts out of schema.
    const parsed =
      preset.engine === "ffmpeg"
        ? FfmpegConfigSchema.parse(preset.config)
        : RemotionConfigSchema.parse(preset.config);

    await db
      .insert(schema.subtitlePresets)
      .values({
        name: preset.name,
        description: preset.description,
        engine: preset.engine,
        config: parsed,
        schema_version: 2,
        sort_order: preset.sortOrder,
        tags: preset.tags,
        is_built_in: true,
        is_active: true,
        // Built-ins ship LOCKED so the unlock / "clone to customize" flow is
        // real on a fresh install — an unlocked built-in never shows the lock
        // banner. Only set on INSERT (below in .set() it is intentionally
        // OMITTED) so a preset the operator has deliberately unlocked stays
        // unlocked across a re-seed. Do not "fix" this by adding is_locked to
        // the update set.
        is_locked: true,
      })
      .onConflictDoUpdate({
        target: schema.subtitlePresets.name,
        set: {
          description: preset.description,
          engine: preset.engine,
          config: parsed,
          schema_version: 2,
          sort_order: preset.sortOrder,
          tags: preset.tags,
          is_built_in: true,
          is_active: true,
          // is_locked intentionally NOT updated — see the insert comment above.
          updated_at: new Date(),
        },
      });
    console.log(`  ✓ ${preset.name} (${preset.engine})`);
  }
  // --- Retire the superseded built-ins ------------------------------------
  // Deactivate, and re-point any assignment that used them at the closest
  // survivor, so a format that had captions keeps captions instead of silently
  // losing them.
  const { eq } = await import("drizzle-orm");
  for (const [oldName, newName] of Object.entries(RETIRED_BUILTIN_PRESETS)) {
    const [old] = await db
      .select()
      .from(schema.subtitlePresets)
      .where(eq(schema.subtitlePresets.name, oldName))
      .limit(1);
    if (!old) continue;

    const [replacement] = await db
      .select()
      .from(schema.subtitlePresets)
      .where(eq(schema.subtitlePresets.name, newName))
      .limit(1);
    if (!replacement) {
      throw new Error(
        `Retirement target "${newName}" for "${oldName}" was not seeded — ` +
          `refusing to deactivate a preset with nowhere to send its assignments.`,
      );
    }

    const moved = await db
      .update(schema.subtitlePresetAssignments)
      .set({ preset_id: replacement.id })
      .where(eq(schema.subtitlePresetAssignments.preset_id, old.id))
      .returning({ id: schema.subtitlePresetAssignments.id });

    await db
      .update(schema.subtitlePresets)
      .set({ is_active: false, is_built_in: true, updated_at: new Date() })
      .where(eq(schema.subtitlePresets.id, old.id));

    console.log(
      `  · retired ${oldName} → ${newName}` +
        (moved.length > 0 ? ` (${moved.length} assignment(s) moved)` : ""),
    );
  }

  console.log(
    `Done. ${BUILTIN_SUBTITLE_PRESETS.length} presets seeded. ` +
      "New presets are UNASSIGNED — wire them to formats/channels at /subtitles/assignments.",
  );
  await pool.end();
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
