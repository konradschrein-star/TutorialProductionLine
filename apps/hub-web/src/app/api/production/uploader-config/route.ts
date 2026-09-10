import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSecret } from "@repo/db";
import { getUploaderSettings } from "@/lib/uploader/settings";
import { UPLOADER_DISCOVERY_HOLD } from "@/lib/uploader/discovery-safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorized(request: NextRequest): Promise<boolean> {
  const expected = await getSecret(db, "UPLOADER_CALLBACK_SECRET").catch(
    () => "",
  );
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read-only configuration contract for the separate uploader process. It never
 * returns secrets and never claims or starts work. A worker must independently
 * honor enabled=false, dry_run and requireManualRelease.
 */
export async function GET(request: NextRequest) {
  if (!(await authorized(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getUploaderSettings();
  return NextResponse.json({
    version: 1,
    fetchedAt: new Date().toISOString(),
    safety: {
      mayExecute: false,
      inspectionOnly: true,
      reason: UPLOADER_DISCOVERY_HOLD,
      dryRun: settings.executionMode === "dry_run",
      requireManualRelease: settings.requireManualRelease,
    },
    transport: settings.transport,
    publishing: {
      defaultVisibility: settings.defaultVisibility,
      timezone: settings.timezone,
      scheduleLeadMinutes: settings.scheduleLeadMinutes,
    },
    limits: {
      maxConcurrentUploads: settings.maxConcurrentUploads,
      minMinutesBetweenStarts: settings.minMinutesBetweenStarts,
      maxUploadsPerDay: settings.maxUploadsPerDay,
      retryMaxAttempts: settings.retryMaxAttempts,
    },
    callbackUrl: settings.callbackPublicUrl ?? null,
  });
}
