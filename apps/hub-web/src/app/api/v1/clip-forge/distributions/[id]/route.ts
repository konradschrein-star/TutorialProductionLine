import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { withApiAuth } from "../../../_lib/auth";
import { db } from "@/lib/db";
import { cfDistributions } from "@repo/db";

export const dynamic = "force-dynamic";

interface PatchBody {
  /** QC verdict from the review queue. */
  qc?: "pass" | "fail";
  /** Free-form reviewer note stored alongside the verdict. */
  note?: string;
}

/**
 * PATCH /api/v1/clip-forge/distributions/:id
 *
 * Records a human QC verdict. The QC screen shipped with
 * "approve → qc_pass" and "reject → qc_fail" buttons whose handlers only
 * wrote to a React `useState` map — the verdict was lost on unmount and the
 * database never saw it, despite the button labels naming the exact DB
 * states they claimed to set.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    if (body.qc !== "pass" && body.qc !== "fail") {
      return new Response(
        JSON.stringify({ error: "qc must be 'pass' or 'fail'" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const [existing] = await db
      .select()
      .from(cfDistributions)
      .where(eq(cfDistributions.id, id))
      .limit(1);
    if (!existing) {
      return new Response(JSON.stringify({ error: "distribution not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Preserve whatever an automated pass wrote; append the human verdict.
    const prior =
      existing.qc_report && typeof existing.qc_report === "object"
        ? (existing.qc_report as Record<string, unknown>)
        : {};

    const [row] = await db
      .update(cfDistributions)
      .set({
        status: body.qc === "pass" ? "qc_pass" : "qc_fail",
        qc_result: body.qc,
        qc_report: {
          ...prior,
          human_review: {
            verdict: body.qc,
            note: body.note ?? null,
            at: new Date().toISOString(),
          },
        },
      })
      .where(eq(cfDistributions.id, id))
      .returning();

    return { distribution: row };
  });
}
