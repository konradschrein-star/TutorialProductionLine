export const dynamic = "force-dynamic";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { defringePersonaRgba } from "@repo/media-core/images";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { PERSONA_ASSET_PATHS } from "@/lib/thumbnails/persona-catalog";

const renderedPersonas = new Map<string, Promise<Buffer>>();

async function renderCleanPersona(asset: string): Promise<Buffer> {
  const publicDir =
    process.env["HUB_PUBLIC_DIR"] ?? join(process.cwd(), "public");
  const source = await readFile(join(publicDir, ...asset.split("/")));
  const raw = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = defringePersonaRgba(
    raw.data,
    raw.info.width,
    raw.info.height,
  );
  return sharp(cleaned, { raw: raw.info }).png().toBuffer();
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "manage:thumbnails") &&
      !hasPermission(session, "view:settings"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const asset = request.nextUrl.searchParams.get("asset")?.replace(/^\/+/, "");
  if (!asset || !PERSONA_ASSET_PATHS.has(asset)) {
    return NextResponse.json(
      { error: "Unknown persona asset" },
      { status: 404 },
    );
  }

  let rendered = renderedPersonas.get(asset);
  if (!rendered) {
    rendered = renderCleanPersona(asset);
    renderedPersonas.set(asset, rendered);
  }
  try {
    const bytes = await rendered;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (error) {
    renderedPersonas.delete(asset);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Persona cleanup failed",
      },
      { status: 500 },
    );
  }
}
