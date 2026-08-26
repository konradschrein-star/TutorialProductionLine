import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { canAccessRoute } from "./lib/auth/rbac";

/**
 * Next.js Middleware
 *
 * Handles authentication and RBAC for all routes.
 * Runs on every request before the page is rendered.
 *
 * NOTE: The middleware runs in the Edge Runtime. We intentionally
 * verify JWTs using process.env.JWT_SECRET directly (via jose) rather
 * than going through the full getHubConfig() / Zod config chain.
 * The config chain caches state in module-level singletons which can
 * behave unexpectedly across Edge Runtime isolates; on a cache miss it
 * falls back to a mock JWT secret, causing valid tokens to fail
 * verification and the session cookie to be silently deleted.
 */

// Public routes that don't require authentication
const PUBLIC_ROUTES = ["/login"];

// API routes excluded from the deny-by-default route gate — they authenticate
// themselves inside the handler. This is an auth BYPASS list, not a grant:
// every handler under a listed prefix MUST still call getSession() /
// hasPermission() itself. Trimmed to the single-tenant Tutorial Studio surface.
const API_ROUTES = [
  "/api/health",
  "/api/events",
  // Tutorial Production Engine API — each handler does its own
  // getSession() + hasPermission("view:production") check.
  "/api/production",
  // Thumbnail Studio API — each handler does its own getSession() +
  // hasPermission("view:settings").
  "/api/thumbnails",
  // Keyword Tool SSO landing: verifies a KT-minted handoff token and issues a
  // hub_session. The inbound request has no hub_session yet, so it must bypass
  // the deny-by-default gate (it self-authenticates via the ?t= token).
  "/api/auth/kt-sso",
  // Machine (bearer) API surface. Inbound calls carry Authorization: Bearer
  // ${CF_API_TOKEN} and no hub_session cookie, so without this bypass the
  // deny-by-default gate would redirect them to /login. Every handler under
  // /api/v1/** self-authenticates via resolvePrincipal() (see _lib/auth.ts) —
  // e.g. /api/v1/tutorial/jobs (KT "Produce"), which REQUIRES kind==="machine".
  "/api/v1",
  // Create form + Studio pickers. Each handler self-authenticates.
  "/api/tts-voices",
  "/api/voices",
  "/api/channels",
  "/api/characters",
  "/api/narrators",
  // System Health cards (provider ops, credentials, storage). Each handler
  // still calls its own guard (session + view:system-health / view:settings).
  "/api/providers",
  "/api/credentials",
  "/api/storage",
  // Prometheus scrape target — public by design (no session cookie).
  "/api/metrics",
];

/**
 * True when `pathname` is exactly a listed bypass prefix, or a descendant of
 * one. Anchored on segment boundaries so "/api/jobsFOO" does NOT match the
 * "/api/jobs" entry — only "/api/jobs" itself and "/api/jobs/...".
 */
function isBypassedApiRoute(pathname: string): boolean {
  return API_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

async function verifyJWT(
  token: string,
): Promise<{ userId: string; role: string; email: string }> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as { userId: string; role: string; email: string };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect legacy /v2/* URLs to root equivalents (for cached bookmarks)
  // Can be removed after grace period (30-60 days)
  if (pathname.startsWith("/v2/")) {
    const newPath = pathname.replace(/^\/v2/, "") || "/dashboard";
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  // Tutorial Studio was renamed from /production to /tutorial-studio. The VAs
  // use it daily and have it bookmarked, and older links (e.g. the KT SSO
  // landing) point at the old path — so this is a permanent redirect, not a
  // grace-period one. NOTE: /api/production/* is a DIFFERENT namespace and is
  // deliberately NOT renamed — it does not match this check (it starts with
  // "/api/"), so worker and external callers are unaffected.
  if (pathname === "/production" || pathname.startsWith("/production/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/production/, "/tutorial-studio");
    return NextResponse.redirect(url, 308);
  }

  // Allow public routes
  if (PUBLIC_ROUTES.includes(pathname)) {
    // If user is already logged in, redirect to dashboard
    const token = request.cookies.get("hub_session")?.value;
    if (token) {
      try {
        const payload = await verifyJWT(token);
        // Admin lands on the dashboard; VAs (who lack view:dashboard) land on
        // the Tutorial Studio — their whole app.
        const landing = canAccessRoute(payload as any, "/dashboard")
          ? "/dashboard"
          : "/tutorial-studio";
        return NextResponse.redirect(new URL(landing, request.url));
      } catch {
        // Token invalid — allow access to login page
      }
    }
    return NextResponse.next();
  }

  // Allow API routes (they handle their own auth).
  //
  // API_ROUTES is an auth-BYPASS list: anything matched here skips the
  // deny-by-default canAccessRoute() gate below and MUST self-authenticate in
  // its handler. Matching is segment-anchored, not a bare prefix — a bare
  // startsWith() meant "/api/jobs" also matched "/api/jobsFOO", so any future
  // route whose name merely began with a listed prefix would silently inherit
  // the bypass. Match the prefix exactly, or the prefix followed by a separator.
  if (isBypassedApiRoute(pathname)) {
    return NextResponse.next();
  }

  // Check authentication
  const token = request.cookies.get("hub_session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Verify token
  let session: { userId: string; role: string; email: string };
  try {
    session = await verifyJWT(token);
  } catch {
    // Token is invalid or expired — redirect to login.
    // Do NOT delete the cookie here: if this fails on a background prefetch
    // (Next.js prefetches sidebar links), it would silently delete the cookie
    // before the user even clicks, logging them out. The login page handles
    // re-authentication correctly regardless of whether the cookie exists.
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Check RBAC permissions for the route
  if (!canAccessRoute(session as any, pathname)) {
    // A VA denied a route (they lack view:dashboard, so "/" is out) is bounced
    // to their home — the Tutorial Studio — rather than shown a 404.
    if (
      !canAccessRoute(session as any, "/dashboard") &&
      pathname !== "/tutorial-studio" &&
      canAccessRoute(session as any, "/tutorial-studio")
    ) {
      return NextResponse.redirect(new URL("/tutorial-studio", request.url));
    }
    // For everyone else, render a real 404 (URL preserved) instead of silently
    // redirecting to the dashboard. A missing route rule — e.g. a newly added
    // page whose path was never added to canAccessRoute() — then shows as
    // "Page Not Found" rather than masquerading as a dashboard redirect, which
    // is impossible to tell apart from a genuine permission denial. Rewrite (not
    // redirect) to a non-existent path so Next serves the app's not-found page
    // with a 404 status while keeping the address bar on the attempted route.
    return NextResponse.rewrite(new URL("/route-not-found", request.url), {
      status: 404,
    });
  }

  // Allow request to proceed
  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder (images and videos)
     *
     * SECURITY NOTE (audit 2026-07-29) — the extension exclusions below are
     * DELIBERATE and load-bearing, not an oversight. `/api/media/[...key]`
     * serves .mp4/.png/etc and is NOT on API_ROUTES; without this exclusion the
     * deny-by-default canAccessRoute() gate would 404 every media URL. It
     * compensates by calling getSession() itself (see
     * app/api/media/[...key]/route.ts). Same for `api/upload`, which is on
     * API_ROUTES anyway, so excluding it here is redundant rather than harmful.
     *
     * The residual risk is that this is a SECOND, implicit bypass surface: any
     * future /api route whose URL happens to end in one of these extensions
     * silently skips the middleware. New file-serving routes must therefore
     * self-authenticate exactly like the API_ROUTES entries do. Left as-is
     * deliberately — narrowing it would break media/asset streaming.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|mov|html)$).*)",
  ],
};
