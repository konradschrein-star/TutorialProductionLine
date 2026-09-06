import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSecret } from "@repo/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export const runtime = "nodejs";

function publicOrigin(request: NextRequest): string {
  if (process.env["APP_PUBLIC_URL"])
    return process.env["APP_PUBLIC_URL"].replace(/\/$/, "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:credentials"))
    return NextResponse.json(
      { error: "Administrator access required" },
      { status: 403 },
    );
  const clientId = await getSecret(db, "GOOGLE_DRIVE_CLIENT_ID").catch(
    () => "",
  );
  if (!clientId)
    return NextResponse.redirect(
      new URL(
        "/settings?drive_oauth=missing_client_id#connections",
        request.url,
      ),
    );
  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL(
    "/api/storage/drive/oauth/callback",
    publicOrigin(request),
  ).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set("drive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return response;
}
