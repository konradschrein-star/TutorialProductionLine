/**
 * provision-fonts — register the Global Subtitle System's built-in starter font
 * set (spec Task 7b).
 *
 * Fetches OFL font files (woff2) from the Fontsource jsDelivr CDN into the
 * shared, renderer-readable fonts directory (`${LOCAL_MEDIA_ROOT}/fonts`, the
 * same directory uploads land in — served by hub-web's /api/media/fonts/* and
 * read directly by the render workers) and upserts one `subtitle_fonts` row per
 * family with `is_builtin=true`, its real family name, and per-weight files.
 *
 * Idempotent:
 *  - a weight file already on disk is not re-downloaded,
 *  - a family row already present (matched by name) is updated in place (its id
 *    is preserved so presets that reference it keep working).
 *
 * Network is required AT RUN TIME. A font whose files cannot be fetched (e.g.
 * the two non-OFL display faces with no CDN, when not pre-installed on the host)
 * is skipped with a warning — it never aborts the whole run.
 *
 * Run: pnpm --filter @repo/db provision:fonts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { mkdir, writeFile, access, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { eq } from "drizzle-orm";
// This script lives in packages/db/scripts (outside src/, so it is NOT part of
// the tsc build) and is run via tsx, which resolves the TS source directly.
import * as schema from "../src/schema/index.js";
const { subtitleFonts } = schema;

interface WeightSpec {
  weight: number;
  label: string;
  /** Fontsource file id, e.g. "inter-latin-400-normal" (→ .woff2). */
  fontsourceFile?: string;
}

interface FontSpec {
  /** Display name shown in the picker (what the editor writes to config.fontFamily). */
  name: string;
  /** Real embedded family name (ASS Fontname / fontsdir key). Usually === name. */
  family: string;
  /** Fontsource package id, e.g. "inter". Omit for host-only display faces. */
  fontsourceId?: string;
  weights: WeightSpec[];
  /**
   * Fallback: candidate absolute paths of a pre-installed host font file to copy
   * when there is no CDN source (Komika Axis, THE BOLD — installed on the VPS at
   * /usr/local/share/fonts per project memory).
   */
  hostPaths?: string[];
}

const CDN = "https://cdn.jsdelivr.net/npm/@fontsource";
const SUBSET = "latin";

function fsFile(id: string, weight: number): string {
  return `${id}-${SUBSET}-${weight}-normal`;
}

function w(weight: number, label: string): WeightSpec {
  return { weight, label };
}

const STARTER_SET: FontSpec[] = [
  {
    name: "Inter",
    family: "Inter",
    fontsourceId: "inter",
    weights: [
      w(400, "Regular"),
      w(600, "SemiBold"),
      w(700, "Bold"),
      w(900, "Black"),
    ],
  },
  // Arial → Arimo, the metric-compatible OFL substitute. Display name "Arial";
  // family is the REAL embedded name ("Arimo") so libass fontsdir + the Remotion
  // @font-face both resolve to the actual file.
  {
    name: "Arial",
    family: "Arimo",
    fontsourceId: "arimo",
    weights: [w(400, "Regular"), w(700, "Bold")],
  },
  {
    name: "Montserrat",
    family: "Montserrat",
    fontsourceId: "montserrat",
    weights: [w(400, "Regular"), w(700, "Bold"), w(900, "Black")],
  },
  {
    name: "Poppins",
    family: "Poppins",
    fontsourceId: "poppins",
    weights: [w(400, "Regular"), w(600, "SemiBold"), w(700, "Bold")],
  },
  {
    name: "Roboto",
    family: "Roboto",
    fontsourceId: "roboto",
    weights: [w(400, "Regular"), w(700, "Bold"), w(900, "Black")],
  },
  {
    name: "Nunito",
    family: "Nunito",
    fontsourceId: "nunito",
    weights: [w(400, "Regular"), w(700, "Bold"), w(900, "Black")],
  },
  {
    name: "Raleway",
    family: "Raleway",
    fontsourceId: "raleway",
    weights: [w(400, "Regular"), w(700, "Bold"), w(900, "Black")],
  },
  {
    name: "Anton",
    family: "Anton",
    fontsourceId: "anton",
    weights: [w(400, "Regular")],
  },
  // Display faces with no OFL CDN — copied from the host install if present,
  // otherwise skipped with a warning (never fatal).
  {
    name: "Komika Axis",
    family: "Komika Axis",
    weights: [w(400, "Regular")],
    hostPaths: [
      "/usr/local/share/fonts/KOMIKAX_.ttf",
      "/usr/local/share/fonts/komika-axis.ttf",
      "/usr/local/share/fonts/KomikaAxis.ttf",
    ],
  },
  {
    name: "THE BOLD",
    family: "THEBOLDFont",
    weights: [w(700, "Bold")],
    hostPaths: [
      "/usr/local/share/fonts/THEBOLDFont.ttf",
      "/usr/local/share/fonts/the-bold-font.ttf",
      "/usr/local/share/fonts/TheBoldFont.ttf",
    ],
  },
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Empty body for ${url}`);
  await writeFile(dest, buf);
}

async function main(): Promise<void> {
  const mediaRoot = process.env.LOCAL_MEDIA_ROOT;
  if (!mediaRoot) {
    throw new Error("LOCAL_MEDIA_ROOT env var is required");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL env var is required");
  }

  const fontsDir = join(mediaRoot, "fonts");
  await mkdir(fontsDir, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log(
    `Provisioning ${STARTER_SET.length} built-in fonts into ${fontsDir}`,
  );

  for (const font of STARTER_SET) {
    try {
      const resolvedWeights: Array<{
        weight: number;
        label: string;
        file_path: string;
      }> = [];

      for (const wt of font.weights) {
        const ext = font.fontsourceId ? "woff2" : "ttf";
        const fileName = `builtin-${slug(font.name)}-${wt.weight}.${ext}`;
        const dest = join(fontsDir, fileName);

        if (await fileExists(dest)) {
          // Idempotent: already present.
          resolvedWeights.push({
            weight: wt.weight,
            label: wt.label,
            file_path: dest,
          });
          continue;
        }

        if (font.fontsourceId) {
          const url = `${CDN}/${font.fontsourceId}/files/${fsFile(font.fontsourceId, wt.weight)}.woff2`;
          await fetchToFile(url, dest);
          console.log(`  ↓ ${font.name} ${wt.weight} ← ${url}`);
        } else {
          // Host-install fallback.
          const src = await firstExisting(font.hostPaths ?? []);
          if (!src) {
            throw new Error(
              `no CDN source and no host font found in [${(font.hostPaths ?? []).join(", ")}]`,
            );
          }
          await copyFile(src, dest);
          console.log(
            `  ⟿ ${font.name} ${wt.weight} ← host ${src} (${basename(dest)})`,
          );
        }
        resolvedWeights.push({
          weight: wt.weight,
          label: wt.label,
          file_path: dest,
        });
      }

      if (resolvedWeights.length === 0) {
        console.warn(`  ⚠ ${font.name}: no weights resolved — skipping`);
        continue;
      }

      const primary = resolvedWeights[0]!;
      const ext = font.fontsourceId ? "woff2" : "ttf";
      const values = {
        name: font.name,
        family: font.family,
        file_name: basename(primary.file_path),
        file_path: primary.file_path,
        format: ext,
        weights: resolvedWeights,
        is_builtin: true,
        source: "vps" as const,
        preview_text: null,
      };

      const [existing] = await db
        .select({ id: subtitleFonts.id })
        .from(subtitleFonts)
        .where(eq(subtitleFonts.name, font.name))
        .limit(1);

      if (existing) {
        await db
          .update(subtitleFonts)
          .set(values)
          .where(eq(subtitleFonts.id, existing.id));
        console.log(
          `  ✓ ${font.name} (updated, ${resolvedWeights.length} weights)`,
        );
      } else {
        await db.insert(subtitleFonts).values(values);
        console.log(
          `  ✓ ${font.name} (inserted, ${resolvedWeights.length} weights)`,
        );
      }
    } catch (err) {
      console.warn(
        `  ⚠ ${font.name}: ${err instanceof Error ? err.message : String(err)} — skipping`,
      );
    }
  }

  await pool.end();
  console.log("Done.");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await fileExists(p)) return p;
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
