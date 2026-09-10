import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { keywordIntegrationState } from "@/lib/keyword-tool/workflow";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/keywords/embed-url
 *
 * SSO bridge for the embedded "Keywords" tab (Video ERP). Mints a short-lived
 * HS256 handoff token (email + CF role) signed with the shared KT_EMBED_SECRET
 * and returns the Keyword Tool embed URL with it. The Keyword Tool verifies the
 * token and issues its own scoped session (role mapped per spec §4.1).
 *
 * Requires a hub session with view:production. Env: KT_EMBED_URL, KT_EMBED_SECRET.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const base = process.env.KT_EMBED_URL;
  const secret = process.env.KT_EMBED_SECRET;
  const integration = keywordIntegrationState(process.env);
  if (integration !== "configured")
    return NextResponse.json({ integration, url: null });
  if (!base || !secret) {
    return NextResponse.json(
      {
        error:
          "Keyword Tool embed is not configured (KT_EMBED_URL / KT_EMBED_SECRET)",
      },
      { status: 503 },
    );
  }

  const token = await new SignJWT({ email: session.email, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));

  const normalizedBase = base.replace(/\/$/, "");
  const url = `${normalizedBase}/embed/board?t=${encodeURIComponent(token)}`;
  const canAdmin = hasPermission(session, "manage:tutorial-settings");
  return NextResponse.json({
    url,
    boardUrl: `${normalizedBase}/embed/board`,
    // Do not disclose or render the privileged destination to producer VAs.
    // The Keyword Tool must still enforce its own authorization as the final
    // boundary; this keeps the Studio shell honest and prevents accidental
    // navigation into an admin-only surface.
    adminUrl: canAdmin ? `${normalizedBase}/admin` : null,
    canAdmin,
  });
}
