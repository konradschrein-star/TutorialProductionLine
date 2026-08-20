import { NextResponse, type NextRequest } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { jobs as cfJobs } from "@repo/cf-api";
import { withApiAuth } from "../../../../_lib/auth";
import { getV1Runtime } from "../../../../_lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return withApiAuth(req, async () => {
    const { id, kind } = await params;
    const res = await cfJobs.resolveJobArtifact(
      getV1Runtime(),
      id,
      kind as never,
    );
    const s = await stat(res.path);
    const nodeStream = createReadStream(res.path);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": res.contentType,
        "Content-Length": String(s.size),
        "Cache-Control": "no-store",
      },
    });
  });
}
