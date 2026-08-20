export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setDefaultVoice } from "@repo/db/repositories";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const voice = await setDefaultVoice(db, id);

    if (!voice) {
      return NextResponse.json({ error: "Voice not found" }, { status: 404 });
    }

    return NextResponse.json(voice);
  } catch (error) {
    console.error("Failed to set default voice:", error);
    return NextResponse.json(
      { error: "Failed to set default voice" },
      { status: 500 },
    );
  }
}
