import type { NextRequest } from "next/server";
import { formats as cfFormats } from "@repo/cf-api";
import { withApiAuth } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    return { formats: cfFormats.listFormats() };
  });
}
