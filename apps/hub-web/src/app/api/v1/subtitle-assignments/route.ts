import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subtitlePresets, subtitlePresetAssignments } from "@repo/db";
import { and, eq, isNull } from "drizzle-orm";
import { withApiAuth } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * Content formats that can currently be produced end-to-end. These are the
 * non-deprecated members of `content_format` (packages/db/src/schema/enums.ts)
 * — the values stored in `content_jobs.format` and matched by the subtitle
 * resolver. Deprecated/retired formats are intentionally omitted so the
 * assignment matrix stays focused on live formats.
 */
const ACTIVE_FORMATS = [
  "EXPLAINER",
  "DOCUMENTARY",
  "TECH_COMPARISON",
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  "BUNDESTAG",
  "LONG_FORM_DRAMA",
  "POLITICAL_COMMENTARY_REACTOR",
  "RANKING",
] as const;

/**
 * GET — all assignments joined with their preset's name + engine, plus the
 * list of active content formats the matrix should render as rows.
 */
export async function GET() {
  const rows = await db
    .select({
      id: subtitlePresetAssignments.id,
      preset_id: subtitlePresetAssignments.preset_id,
      format: subtitlePresetAssignments.format,
      channel_id: subtitlePresetAssignments.channel_id,
      is_active: subtitlePresetAssignments.is_active,
      preset_name: subtitlePresets.name,
      preset_engine: subtitlePresets.engine,
      preset_is_active: subtitlePresets.is_active,
    })
    .from(subtitlePresetAssignments)
    .leftJoin(
      subtitlePresets,
      eq(subtitlePresetAssignments.preset_id, subtitlePresets.id),
    );

  return NextResponse.json({ assignments: rows, formats: ACTIVE_FORMATS });
}

/**
 * PUT — upsert a single assignment keyed on (format, channel_id).
 *
 * Body: { format?: string|null, channel_id?: string|null,
 *         preset_id?: string|null, is_active?: boolean }
 *
 * - preset_id null/empty → the assignment is CLEARED (row deleted). This turns
 *   captions off for that (format, channel) since the resolver requires an
 *   active assignment.
 * - Otherwise the row is inserted or updated. We match manually (rather than
 *   relying on ON CONFLICT) because the unique index treats NULL channel_id /
 *   NULL format as distinct, so ON CONFLICT would not fire for format-level
 *   or global rows.
 */
export async function PUT(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = await req.json();
    const {
      format = null,
      channel_id = null,
      preset_id = null,
      is_active = true,
    } = body as {
      format?: string | null;
      channel_id?: string | null;
      preset_id?: string | null;
      is_active?: boolean;
    };

    const fmt = format || null;
    const chan = channel_id || null;
    const preset = preset_id || null;

    // Reject unknown/deprecated formats — the column is a bare varchar, so an
    // invalid string would insert successfully and linger invisibly (it can
    // never match a live job's format and can't be cleared from the matrix).
    if (
      fmt !== null &&
      !ACTIVE_FORMATS.includes(fmt as (typeof ACTIVE_FORMATS)[number])
    ) {
      return NextResponse.json(
        { error: `Unknown format: ${fmt}`, knownFormats: ACTIVE_FORMATS },
        { status: 400 },
      );
    }

    const match = and(
      fmt === null
        ? isNull(subtitlePresetAssignments.format)
        : eq(subtitlePresetAssignments.format, fmt),
      chan === null
        ? isNull(subtitlePresetAssignments.channel_id)
        : eq(subtitlePresetAssignments.channel_id, chan),
    );

    // Clear the assignment entirely when no preset is chosen.
    if (!preset) {
      await db.delete(subtitlePresetAssignments).where(match);
      return NextResponse.json({ ok: true, cleared: true });
    }

    // Validate the target preset exists + is active.
    const [target] = await db
      .select()
      .from(subtitlePresets)
      .where(eq(subtitlePresets.id, preset))
      .limit(1);
    if (!target || !target.is_active) {
      return NextResponse.json(
        { error: "preset_id does not reference an active preset" },
        { status: 400 },
      );
    }

    // Wrap find-then-update/insert in a transaction. Because the unique index
    // treats NULL format/channel as distinct, this manual check is the ONLY
    // thing preventing duplicate rows (e.g. two concurrent saves of the global
    // default). A transaction serialises the check + write.
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(subtitlePresetAssignments)
        .where(match)
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(subtitlePresetAssignments)
          .set({ preset_id: preset, is_active })
          .where(eq(subtitlePresetAssignments.id, existing.id))
          .returning();
        return { row: updated, status: 200 };
      }

      const [inserted] = await tx
        .insert(subtitlePresetAssignments)
        .values({ format: fmt, channel_id: chan, preset_id: preset, is_active })
        .returning();
      return { row: inserted, status: 201 };
    });

    return NextResponse.json(result.row, { status: result.status });
  });
}
