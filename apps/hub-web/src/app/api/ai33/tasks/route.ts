import { NextResponse } from "next/server";
import { getHubConfig } from "@/lib/config";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AI33_BASE_URL = "https://api.ai33.pro";

export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const config = getHubConfig();
    const apiKey = config.AI33_API_KEY;

    const body = (await request.json()) as { task_ids?: string[] };
    if (!Array.isArray(body.task_ids) || body.task_ids.length === 0) {
      return NextResponse.json(
        { error: "task_ids array required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${AI33_BASE_URL}/v1/task/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ task_ids: body.task_ids }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `AI33 delete failed: ${text}` },
        { status: response.status },
      );
    }

    const data = (await response.json()) as {
      success: boolean;
      refund_credits: number;
    };
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
