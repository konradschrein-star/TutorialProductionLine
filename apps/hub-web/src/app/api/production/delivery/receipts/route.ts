import { NextRequest, NextResponse } from "next/server";
import { authorizeDeliveryConnector, DeliveryError, ingestScheduledReceipt } from "@/lib/uploader/scheduled-delivery";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!await authorizeDeliveryConnector(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await ingestScheduledReceipt(await request.json().catch(() => null))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Receipt failed" }, { status: error instanceof DeliveryError ? error.status : 500 }); }
}
