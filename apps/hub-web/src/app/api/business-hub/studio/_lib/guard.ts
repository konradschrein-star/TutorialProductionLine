/**
 * Auth guard + error translation for the Presenter Studio API.
 *
 * `/api/business-hub/*` must be added to `API_ROUTES` in `src/middleware.ts`
 * (that file belongs to task INT — see `docs/superpowers/handoff/U1.md`). That
 * list is an auth BYPASS, not a grant: everything it matches skips the
 * deny-by-default `canAccessRoute()` gate and MUST authenticate itself. This
 * module is that self-authentication, applied by every route under
 * `/api/business-hub/studio/`.
 *
 * Permission model matches the other global config studios (`/subtitles`,
 * `/format-styles`): reading needs `create:job` or `view:settings`; writing —
 * which mutates a shared, version-controlled-adjacent asset every render
 * depends on — needs `edit:settings`.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { PresenterStoreError } from "./presenter-store";

export type StudioAccess = "read" | "write";

/**
 * Assert the caller may use the Studio API at `access` level.
 *
 * @returns `null` when allowed, or the `NextResponse` to return when not.
 */
export async function guardStudio(
  access: StudioAccess,
): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed =
    access === "write"
      ? hasPermission(session, "edit:settings")
      : hasPermission(session, "create:job") ||
        hasPermission(session, "view:settings");

  if (!allowed) {
    return NextResponse.json(
      {
        error:
          access === "write"
            ? "Forbidden — writing the presenter pose library needs edit:settings."
            : "Forbidden — the Presenter Studio needs create:job or view:settings.",
      },
      { status: 403 },
    );
  }

  return null;
}

/**
 * Translate a thrown error into a JSON response.
 *
 * {@link PresenterStoreError} carries its own status and a diagnostic written
 * for the operator, so it is surfaced verbatim. Anything else is a bug: it is
 * logged in full and returned as a 500 with its message, because a Studio that
 * says "something went wrong" is a Studio nobody can fix a pose in.
 */
export function studioErrorResponse(
  error: unknown,
  context: string,
): NextResponse {
  if (error instanceof PresenterStoreError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: "error",
      message: "[business-hub-studio] unhandled error",
      context,
      detail: message,
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  return NextResponse.json(
    { error: `${context}: ${message}` },
    { status: 500 },
  );
}
