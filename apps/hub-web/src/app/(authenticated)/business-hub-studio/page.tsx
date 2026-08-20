import { notFound } from "next/navigation";

import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../_lib/v2-auth";
import { StudioClient } from "./studio-client";

/**
 * BUSINESS_PLAN_HUB Presenter Studio.
 *
 * Server shell: permission gate plus the page header. Everything below is a
 * client component, because the whole surface is pointer-driven — dragging
 * hitboxes, scrubbing narration, previewing layouts.
 *
 * ROUTE ACCESS: `canAccessRoute()` in `src/lib/auth/rbac.ts` is deny-by-default
 * and has no rule for `/business-hub-studio`, so the middleware currently 404s
 * this page for everyone. That file is not owned by task U1 — the one-rule
 * change it needs, and the matching `/api/business-hub` entry in
 * `src/middleware.ts`, are written up in `docs/superpowers/handoff/U1.md`. The
 * check below is the second half of the same gate and stands on its own.
 *
 * Gated like the other global config studios (`/subtitles`, `/format-styles`):
 * anyone who can create jobs or manage settings gets the console; mutating the
 * pose library additionally needs `edit:settings`, enforced server-side in
 * `app/api/business-hub/studio/_lib/guard.ts`.
 */
export default async function BusinessHubStudioPage() {
  const session = await getSession();
  const canView =
    hasPermission(session, "create:job") ||
    hasPermission(session, "view:settings");
  if (!canView) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "var(--v2-text-1)",
            margin: "0 0 6px 0",
          }}
        >
          Presenter Studio
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--v2-text-2)",
            margin: 0,
            maxWidth: 900,
            lineHeight: 1.6,
          }}
        >
          Author the presenter hitboxes for BUSINESS_PLAN_HUB. Every value is
          stored normalised 0–1 against the pose image, so it survives any
          output resolution. A pose is only usable by a render once all six
          hitboxes are placed and it is marked calibrated — nothing downstream
          will guess a head position, a pointing vector or a safe region.
        </p>
      </div>

      <StudioClient />
    </div>
  );
}
