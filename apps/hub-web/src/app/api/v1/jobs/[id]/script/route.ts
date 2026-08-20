import { NextResponse, type NextRequest } from "next/server";
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
    const script = await cfJobs.getJobScript(getV1Runtime(), id);
    return new NextResponse(script, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async () => {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { script?: string };
    return cfJobs.setJobScript(getV1Runtime(), id, body.script ?? "");
  });
}
