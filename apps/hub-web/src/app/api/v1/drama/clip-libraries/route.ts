import type { NextRequest } from "next/server";
import { drama as cfDrama } from "@repo/cf-api";
import { withApiAuth } from "../../_lib/auth";
import { getV1Runtime } from "../../_lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    return { libraries: await cfDrama.listClipLibraries(getV1Runtime()) };
  });
}
