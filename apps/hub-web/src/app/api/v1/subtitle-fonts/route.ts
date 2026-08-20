import { NextResponse, type NextRequest } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { subtitleFonts, type SubtitleFontWeight } from "@repo/db";
import { asc } from "drizzle-orm";
import { withApiAuth } from "../_lib/auth";
import { getHubConfig } from "@/lib/config";
import { extractFontMetadata } from "@/lib/font-metadata";

export const dynamic = "force-dynamic";

const ALLOWED_FORMATS = ["ttf", "otf", "woff2"] as const;
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

export async function GET() {
  const rows = await db
    .select()
    .from(subtitleFonts)
    .orderBy(asc(subtitleFonts.name));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;

    if (!file || !name) {
      return NextResponse.json(
        { error: "file and name required" },
        { status: 400 },
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_FORMATS.includes(ext as AllowedFormat)) {
      return NextResponse.json(
        { error: "Only TTF, OTF, WOFF2 allowed" },
        { status: 400 },
      );
    }

    const cfg = getHubConfig();
    const fontsDir = join(cfg.LOCAL_MEDIA_ROOT, "fonts");
    await mkdir(fontsDir, { recursive: true });

    const fileName = `${randomUUID()}.${ext}`;
    const filePath = join(fontsDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Parse the font with fontkit to extract its real family name + available
    // weights (spec §7a). Family + weights are what the editor and BOTH
    // renderers key off of, so a bad/unreadable font is a hard 400 (no silent
    // fallback that would produce mis-rendered captions).
    let family: string;
    let weights: SubtitleFontWeight[];
    try {
      const meta = extractFontMetadata(buffer, filePath, name);
      family = meta.family;
      weights = meta.weights;
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not parse font file: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      );
    }

    const [row] = await db
      .insert(subtitleFonts)
      .values({
        name,
        file_name: fileName,
        file_path: filePath,
        format: ext,
        family,
        weights,
        source: "upload",
        is_builtin: false,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  });
}
