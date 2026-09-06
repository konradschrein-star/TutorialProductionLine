import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSecret, setSecret } from "@repo/db";
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

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function finish(request: NextRequest, status: string) {
  const response = NextResponse.redirect(
    new URL(
      `/settings?drive_oauth=${encodeURIComponent(status)}#connections`,
      request.url,
    ),
  );
  response.cookies.set("drive_oauth_state", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:credentials"))
    return finish(request, "forbidden");
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get("drive_oauth_state")?.value ?? "";
  if (!code || !state || !expectedState || !same(state, expectedState))
    return finish(request, "invalid_state");
  const [clientId, clientSecret] = await Promise.all([
    getSecret(db, "GOOGLE_DRIVE_CLIENT_ID").catch(() => ""),
    getSecret(db, "GOOGLE_DRIVE_CLIENT_SECRET").catch(() => ""),
  ]);
  if (!clientId || !clientSecret)
    return finish(request, "missing_client_credentials");
  const redirectUri = new URL(
    "/api/storage/drive/oauth/callback",
    publicOrigin(request),
  ).toString();
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const token = (await tokenResponse.json()) as {
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenResponse.ok || !token.refresh_token)
      return finish(
        request,
        token.error_description ?? token.error ?? "missing_refresh_token",
      );
    await setSecret(db, {
      name: "GOOGLE_DRIVE_REFRESH_TOKEN",
      value: token.refresh_token,
      userId: session.userId,
      description: "Created through the Settings Google Drive OAuth flow",
    });
    return finish(request, "connected");
  } catch (error) {
    return finish(
      request,
      error instanceof Error ? error.message : "exchange_failed",
    );
  }
}
