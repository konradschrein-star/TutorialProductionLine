import type { NextRequest } from "next/server";
import { getHealth } from "@repo/cf-api";
import { withApiAuth } from "../_lib/auth";
import { getV1Runtime } from "../_lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    return getHealth(getV1Runtime());
  });
}
