/**
 * /api/v1 auth middleware.
 *
 * Accepts EITHER:
 *   - A hub-web session cookie (browser flows — same as the existing UI).
 *   - Authorization: Bearer ${CF_API_TOKEN} (machine flows — cf-mcp-server,
 *     external callers, the AIOS, internal scripts, smoke tests).
 *
 * Returns a typed principal so routes can audit / log who did what.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";

export type ApiPrincipal =
  | {
      kind: "user";
      userId: string;
      role: string;
    }
  | {
      kind: "machine";
      tokenLabel: string;
    };

export class ApiAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve a principal from the incoming request.
 * Throws ApiAuthError when neither auth mechanism succeeds.
 *
 * Bearer comparison uses a constant-time check so we don't leak length /
 * prefix info under timing-attack pressure.
 */
export async function resolvePrincipal(
  req: NextRequest,
): Promise<ApiPrincipal> {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    const expected = process.env["CF_API_TOKEN"] ?? "";
    if (!expected) {
      throw new ApiAuthError("CF_API_TOKEN not configured on the server", 503);
    }
    if (!constantTimeEqual(token, expected)) {
      throw new ApiAuthError("Invalid bearer token", 401);
    }
    return {
      kind: "machine",
      tokenLabel: process.env["CF_API_TOKEN_LABEL"] ?? "default",
    };
  }

  const session = await getSession();
  if (session?.userId) {
    return {
      kind: "user",
      userId: session.userId,
      role: (session.role as string | undefined) ?? "user",
    };
  }
  throw new ApiAuthError(
    "Provide a session cookie or Authorization: Bearer header",
    401,
  );
}

/**
 * Wrap a route handler with auth + structured error mapping.
 * Inside the handler you get a typed principal and can throw CfApiError
 * (it's translated to status via errorCodeToHttpStatus).
 */
export async function withApiAuth<T>(
  req: NextRequest,
  handler: (principal: ApiPrincipal) => Promise<T>,
): Promise<NextResponse> {
  let principal: ApiPrincipal;
  try {
    principal = await resolvePrincipal(req);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Auth failure" }, { status: 500 });
  }

  try {
    const result = await handler(principal);
    if (result instanceof NextResponse) {
      return result as NextResponse;
    }
    return NextResponse.json(result);
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(err: unknown): NextResponse {
  // Avoid importing CfApiError at the top so this file stays leaf-level.
  // Duck-typed: anything with `code` matching our known set + a string `message`.
  const known: Record<string, number> = {
    BAD_REQUEST: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    FAILED_PRECONDITION: 412,
    INTERNAL: 500,
  };
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    known[(err as { code: string }).code] !== undefined
  ) {
    const e = err as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
    return NextResponse.json(
      { error: e.message, code: e.code, details: e.details },
      { status: known[e.code] },
    );
  }
  console.error("v1 route error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
