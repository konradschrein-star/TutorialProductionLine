import type { NextRequest } from "next/server";
import { jobs as cfJobs, CfApiError } from "@repo/cf-api";
import { withApiAuth } from "../../../_lib/auth";
import { getV1Runtime } from "../../../_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/formats/:format/jobs
 *
 * Format-typed creator URL. Use this from typed clients (cf-mcp-server,
 * cli-admin) when the format is known at compile time. Same result as
 * POST /api/v1/jobs with { format, payload } — just a nicer URL shape.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ format: string }> },
) {
  return withApiAuth(req, async () => {
    const { format } = await params;
    const payload = await req.json().catch(() => ({}));
    const rt = getV1Runtime();
    switch (format) {
      case "LONG_FORM_DRAMA":
        return { jobs: await cfJobs.createDramaJob(rt, payload) };
      case "CASUALLY_EXPLAINED":
        return { jobs: await cfJobs.createCasuallyExplainedJob(rt, payload) };
      case "RANKING":
        return { jobs: await cfJobs.createRankingJob(rt, payload) };
      default:
        throw new CfApiError(
          "BAD_REQUEST",
          `Format ${format} is not creatable via /api/v1 yet`,
        );
    }
  });
}
