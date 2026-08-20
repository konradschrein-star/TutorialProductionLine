export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAvailableFormats } from "@/app/actions/formats";

export async function GET() {
  const formats = await getAvailableFormats();
  return NextResponse.json({
    success: true,
    count: formats.length,
    formats,
  });
}
