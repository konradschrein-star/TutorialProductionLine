export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { thumbnailLibraryAssets } from "@repo/db";
import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

const CATEGORIES = new Set(["PERSONAS", "LOGOS", "SYMBOLS", "BGS"]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage:thumbnails") && !hasPermission(session, "view:settings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const category = request.nextUrl.searchParams.get("category");
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 36)));
  const conditions: SQL[] = [];
  if (category && CATEGORIES.has(category)) conditions.push(eq(thumbnailLibraryAssets.category, category));
  if (cursor) conditions.push(lt(thumbnailLibraryAssets.created_at, new Date(cursor)));
  const rows = await db.select().from(thumbnailLibraryAssets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(thumbnailLibraryAssets.created_at)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const assets = rows.slice(0, limit).map((row) => ({ id: row.id, name: row.name, category: row.category, url: `/api/media/thumbnail-library/${row.file_name}`, createdAt: row.created_at.toISOString(), includeInRotation: row.include_in_rotation }));
  return NextResponse.json({ assets, hasMore, nextCursor: hasMore ? assets.at(-1)?.createdAt : null });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const category = String(form?.get("category") || "");
  if (!(file instanceof File) || !file.type.startsWith("image/") || !CATEGORIES.has(category)) return NextResponse.json({ error: "Valid image and category required" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return NextResponse.json({ error: "Image must be between 1 byte and 20 MB" }, { status: 400 });
  const ext = extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".png";
  const fileName = `${randomUUID()}${ext}`;
  const root = process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";
  const dir = join(root, "thumbnail-library");
  const path = join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes);
  const [row] = await db.insert(thumbnailLibraryAssets).values({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 160), category, file_path: path, file_name: fileName, created_by: session.userId }).returning();
  return NextResponse.json({ asset: { id: row!.id, name: row!.name, category: row!.category, url: `/api/media/thumbnail-library/${row!.file_name}`, createdAt: row!.created_at.toISOString(), includeInRotation: row!.include_in_rotation } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:thumbnails")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const [row] = await db.delete(thumbnailLibraryAssets).where(eq(thumbnailLibraryAssets.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await unlink(row.file_path).catch(() => undefined);
  return NextResponse.json({ deleted: true });
}
