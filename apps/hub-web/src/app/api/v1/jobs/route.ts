import type { NextRequest } from "next/server";
import { jobs as cfJobs, CfApiError } from "@repo/cf-api";
import { withApiAuth } from "../_lib/auth";
import { getV1Runtime } from "../_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/jobs?status=&format=&channelId=&limit=&offset=
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const url = req.nextUrl;
    const filter = {
      status: url.searchParams.get("status") ?? undefined,
      format: url.searchParams.get("format") ?? undefined,
      channelId: url.searchParams.get("channelId") ?? undefined,
      limit: parseIntOrUndef(url.searchParams.get("limit")) ?? 100,
      offset: parseIntOrUndef(url.searchParams.get("offset")) ?? 0,
    };
    const list = await cfJobs.listJobs(getV1Runtime(), filter);
    return { jobs: list };
  });
}

/**
 * POST /api/v1/jobs
 * Body: { format: "LONG_FORM_DRAMA" | "CASUALLY_EXPLAINED" | ..., payload: <format-specific> }
 *
 * Dispatches to the right cf-api creator. Use /api/v1/formats/:format/jobs
 * if you prefer a format-typed URL.
 */
export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = await req.json().catch(() => ({}));
    const { format, payload } = body as {
      format?: string;
      payload?: unknown;
    };
    if (!format) {
      throw new CfApiError("BAD_REQUEST", "Body must include `format`");
    }
    const rt = getV1Runtime();
    switch (format) {
      case "LONG_FORM_DRAMA":
        return { jobs: await cfJobs.createDramaJob(rt, payload) };
      case "CASUALLY_EXPLAINED":
        return { jobs: await cfJobs.createCasuallyExplainedJob(rt, payload) };
      default:
        throw new CfApiError(
          "BAD_REQUEST",
          `Format ${format} is not creatable via /api/v1 yet`,
        );
    }
  });
}

function parseIntOrUndef(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}
