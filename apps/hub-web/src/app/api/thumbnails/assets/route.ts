export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { thumbnailLibraryAssets, thumbnailAssetPreferences } from "@repo/db";
import { and, desc, eq, ilike, lt, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

import sharp from "sharp";
import { assetPreferenceSchema } from "@/lib/thumbnails/asset-preferences";

const CATEGORIES = new Set(["PERSONAS", "LOGOS", "SYMBOLS", "BGS"]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "view:settings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const category = request.nextUrl.searchParams.get("category");
  const preferences = await db.select().from(thumbnailAssetPreferences).where(eq(thumbnailAssetPreferences.user_id, session.userId));
  const preferenceMap = Object.fromEntries(preferences.map((item) => [item.asset_key, { hidden: item.hidden, includeInRotation: item.include_in_rotation }]));
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 36)));
  const conditions: SQL[] = [];
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length > 160 || (cursor && Number.isNaN(Date.parse(cursor))) || !Number.isFinite(limit)) return NextResponse.json({ error: "Invalid search or cursor" }, { status: 400 });
  if (query) conditions.push(ilike(thumbnailLibraryAssets.name, `%${query.replace(/[\\%_]/g, "\\$&")}%`));
  if (category && CATEGORIES.has(category)) conditions.push(eq(thumbnailLibraryAssets.category, category));
  if (cursor) conditions.push(lt(thumbnailLibraryAssets.created_at, new Date(cursor)));
  const rows = await db.select().from(thumbnailLibraryAssets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(thumbnailLibraryAssets.created_at)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const assets = rows.slice(0, limit).map((row) => ({ id: row.id, name: row.name, category: row.category, url: `/api/media/thumbnail-library/${row.file_name}`, createdAt: row.created_at.toISOString(), includeInRotation: row.include_in_rotation }));
  return NextResponse.json({ assets, preferences: preferenceMap, hasMore, nextCursor: hasMore ? assets.at(-1)?.createdAt : null });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const category = String(form?.get("category") || "");
  if (!(file instanceof File) || !file.type.startsWith("image/") || !CATEGORIES.has(category)) return NextResponse.json({ error: "Valid image and category required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image exceeds 20 MB" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return NextResponse.json({ error: "Image must be between 1 byte and 20 MB" }, { status: 400 });
  let normalized: Buffer;
  try { normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer(); }
  catch { return NextResponse.json({ error: "This image could not be decoded. Upload a valid PNG, JPEG, WebP or SVG image." }, { status: 400 }); }
  if (normalized.length > MAX_BYTES) return NextResponse.json({ error: "Decoded image exceeds 20 MB. Resize it before uploading." }, { status: 400 });
  const fileName = `${randomUUID()}.png`;
  const root = process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  const dir = join(root, "thumbnail-library");
  const path = join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(path, normalized, { flag: "wx" });
  const name = String(form?.get("name") || file.name.replace(/\.[^.]+$/, "")).trim().slice(0, 160);
  const [row] = await db.insert(thumbnailLibraryAssets).values({ name, category, file_path: path, file_name: fileName, created_by: session.userId }).returning();
  return NextResponse.json({ asset: { id: row!.id, name: row!.name, category: row!.category, url: `/api/media/thumbnail-library/${row!.file_name}`, createdAt: row!.created_at.toISOString(), includeInRotation: row!.include_in_rotation } }, { status: 201 });
}

/** Compatibility: DELETE now hides from this user's collection; shared bytes are retained. */
export async function DELETE(request: NextRequest) {
  return updatePreference(request, { assetKey: request.nextUrl.searchParams.get("id"), hidden: true });
}
export async function PATCH(request: NextRequest) {
  return updatePreference(request, await request.json().catch(() => null));
}
async function updatePreference(_request: NextRequest, input: unknown) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = assetPreferenceSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Invalid asset preference" }, { status: 400 });
  const value = parsed.data;
  const patch = { ...(value.hidden !== undefined ? { hidden: value.hidden } : {}), ...(value.includeInRotation !== undefined ? { include_in_rotation: value.includeInRotation } : {}), updated_at: new Date() };
  await db.insert(thumbnailAssetPreferences).values({ user_id: session.userId, asset_key: value.assetKey, ...patch }).onConflictDoUpdate({ target: [thumbnailAssetPreferences.user_id, thumbnailAssetPreferences.asset_key], set: patch });
  return NextResponse.json({ saved: true, sharedAssetDeleted: false });
}
