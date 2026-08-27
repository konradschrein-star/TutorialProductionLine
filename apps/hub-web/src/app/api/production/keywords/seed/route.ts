import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import seedData from "@/lib/tutorial/seed-37-keywords.json";
import { VERIFIED_37_SOFTWARES } from "@/lib/tutorial/seed-softwares";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["NEW", "IN_PROGRESS", "DONE"] as const;

let seededChecked = false;

export async function ensure37KeywordsSeeded(force = false) {
  if (seededChecked && !force) return;
  try {
    const checkResult = await db.execute<{ total_count: number }>(sql`
      SELECT COUNT(*)::int AS total_count FROM seed_keywords
    `);

    const rows = Array.isArray(checkResult)
      ? checkResult
      : Array.isArray((checkResult as any)?.rows)
        ? ((checkResult as any).rows as Array<{ total_count: number }>)
        : [];

    const totalCount = Number(rows[0]?.total_count ?? 0);

    if (totalCount === 0 || force) {
      console.log(
        `[SeedKeywords] Seeding ${seedData.length} business software keywords...`,
      );
      await db.execute(sql`TRUNCATE TABLE seed_keywords;`);

      const chunkSize = 50;
      for (let i = 0; i < seedData.length; i += chunkSize) {
        const chunk = seedData.slice(i, i + chunkSize);
        const values = chunk.map(
          (k: any) =>
            sql`(${k.id}, ${k.title}, ${k.software}, ${k.content_type || "Tutorial"}, ${k.length_class || "<3min"}, ${k.duration_sec || 140}, 'NEW', now())`,
        );
        await db.execute(sql`
          INSERT INTO seed_keywords (id, title, software, content_type, length_class, duration_sec, status, created_at)
          VALUES ${sql.join(values, sql`, `)}
          ON CONFLICT (id) DO NOTHING;
        `);
      }
      console.log(
        `[SeedKeywords] Successfully seeded ${seedData.length} business software keywords.`,
      );
    }
    seededChecked = true;
  } catch (err) {
    console.error("[SeedKeywords] Auto-reseed check failed:", err);
  }
}


export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Ensure DB contains strictly the 37 business software keywords and zero phone/gaming items
  await ensure37KeywordsSeeded();

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const software = (url.searchParams.get("software") ?? "").trim();
  const under3 = url.searchParams.get("under3") === "1";
  const lengths = (url.searchParams.get("length") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is (typeof VALID_STATUSES)[number] =>
      (VALID_STATUSES as readonly string[]).includes(s),
    );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 40),
  );

  const baseConds = [sql`sk.deleted_at IS NULL`];
  if (search) {
    const like = `%${search}%`;
    baseConds.push(sql`(sk.title ILIKE ${like} OR sk.software ILIKE ${like})`);
  }
  if (software) {
    baseConds.push(sql`sk.software = ${software}`);
  }
  if (under3) {
    baseConds.push(sql`sk.duration_sec < 180`);
  }
  if (lengths.length > 0) {
    baseConds.push(
      sql`sk.length_class IN (${sql.join(
        lengths.map((l) => sql`${l}`),
        sql`, `,
      )})`,
    );
  }
  const baseWhere = sql.join(baseConds, sql` AND `);

  const countRows = (await db.execute<{ status: string; n: number }>(
    sql`SELECT sk.status AS status, COUNT(*)::int AS n
        FROM seed_keywords sk WHERE ${baseWhere} GROUP BY sk.status`,
  )) as unknown as Array<{ status: string; n: number }>;
  const counts: Record<string, number> = { NEW: 0, IN_PROGRESS: 0, DONE: 0 };
  let all = 0;
  for (const r of countRows) {
    counts[r.status] = Number(r.n);
    all += Number(r.n);
  }

  const listWhere =
    statuses.length > 0
      ? sql`${baseWhere} AND sk.status IN (${sql.join(
          statuses.map((s) => sql`${s}`),
          sql`, `,
        )})`
      : baseWhere;

  const total =
    statuses.length > 0
      ? statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0)
      : all;

  const rows = (await db.execute<{
    id: number;
    title: string;
    software: string | null;
    content_type: string | null;
    length_class: string | null;
    duration_sec: number | null;
    video_id: string | null;
    status: string;
  }>(
    sql`
      SELECT sk.id, sk.title, sk.software, sk.content_type, sk.length_class,
             sk.duration_sec, sk.video_id, sk.status
      FROM seed_keywords sk
      WHERE ${listWhere}
      ORDER BY (sk.duration_sec IS NULL), sk.duration_sec ASC, sk.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
  )) as unknown as Array<{
    id: number;
    title: string;
    software: string | null;
    content_type: string | null;
    length_class: string | null;
    duration_sec: number | null;
    video_id: string | null;
    status: string;
  }>;

  const keywords = rows.map((r) => ({
    id: r.id,
    title: r.title,
    software: r.software,
    contentType: r.content_type,
    lengthClass: r.length_class,
    durationSec: r.duration_sec,
    referenceUrl: r.video_id
      ? `https://www.youtube.com/watch?v=${r.video_id}`
      : null,
    status: r.status,
  }));

  return NextResponse.json({
    total,
    offset,
    limit,
    hasMore: offset + keywords.length < total,
    counts: { ...counts, ALL: all },
    keywords,
  });
}

/**
 * POST /api/production/keywords/seed
 * Force re-seed database with the 37 verified business software keywords.
 */
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensure37KeywordsSeeded(true);

  return NextResponse.json({
    success: true,
    totalSeeded: seedData.length,
    softwares: VERIFIED_37_SOFTWARES.length,
  });
}
