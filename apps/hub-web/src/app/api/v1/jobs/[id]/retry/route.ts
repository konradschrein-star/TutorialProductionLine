import type { NextRequest } from "next/server";
import { jobs as cfJobs } from "@repo/cf-api";
import { withApiAuth } from "../../../_lib/auth";
import { getV1Runtime } from "../../../_lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async (principal) => {
    const { id } = await params;
    const actor =
      principal.kind === "user"
        ? principal.userId
        : `machine:${principal.tokenLabel}`;
    return cfJobs.retryJob(getV1Runtime(), id, actor);
  });
}
