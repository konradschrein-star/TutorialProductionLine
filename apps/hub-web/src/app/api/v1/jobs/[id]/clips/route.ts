import type { NextRequest } from "next/server";
import { jobs as cfJobs } from "@repo/cf-api";
import { withApiAuth } from "../../../_lib/auth";
import { getV1Runtime } from "../../../_lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async () => {
    const { id } = await params;
    return cfJobs.listJobClips(getV1Runtime(), id);
  });
}
