import type { NextRequest } from "next/server";
import { drama as cfDrama } from "@repo/cf-api";
import { withApiAuth } from "../../../_lib/auth";
import { getV1Runtime } from "../../../_lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiAuth(req, async () => {
    const { id } = await params;
    const rt = getV1Runtime();
    const [library, references] = await Promise.all([
      cfDrama.getClipLibrary(rt, id),
      cfDrama.listReferenceScripts(rt, id),
    ]);
    return { library, reference_scripts: references };
  });
}
