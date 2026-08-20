import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  canAccessRoute,
  isTutorialScopedRole,
  isVisitorRole,
  isVisitorAllowedApi,
  isReadOnlyRole,
  isReadOnlyAllowedApiWrite,
} from "./lib/auth/rbac";

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

// API routes that should be excluded from auth checks (they handle auth themselves)
const API_ROUTES = [
  "/api/health",
  "/api/events",
  "/api/upload",
  "/api/assets",
  "/api/jobs",
  // /api/v1 — AIOS interface; each handler does its own withApiAuth
  // (session cookie OR Authorization: Bearer ${CF_API_TOKEN}).
  "/api/v1",
  "/api/knowledge",
  "/api/style-collections",
  "/api/video-stitch",
  "/api/clip-library",
  // Tutorial Production Engine API — each handler does its own
  // getSession() + hasPermission() check. Without this exemption the
  // deny-by-default canAccessRoute() would redirect every /api/production/*
  // fetch to /dashboard, breaking the tool.
  "/api/production",
  // Long-form-drama format routes: each handler does its own
  // cookies() + verifyToken() check. Without this exemption, the
  // middleware's deny-by-default canAccessRoute() redirects every
  // /api/drama/* fetch to /dashboard, breaking the create form's
  // reference-script picker and the clip-library/music-library APIs.
  "/api/drama",
  // Music library streamer/listing — same reason.
  "/api/music-library",
  // On-demand AI33 sound-effect generation — handler does its own getSession().
  "/api/sound-effect",
  // Thumbnail Studio API — every handler does its own getSession() +
  // hasPermission("view:settings"). Without this exemption the deny-by-default
  // canAccessRoute() 404s every /api/thumbnails/* request (library listing and
  // all archetype reference images), which is exactly what broke the Studio.
  "/api/thumbnails",
  // Keyword Tool SSO landing: verifies a KT-minted handoff token and issues a
  // hub_session. The inbound request has no hub_session yet, so it must bypass
  // the deny-by-default gate (it self-authenticates via the ?t= token).
  "/api/auth/kt-sso",
  // ---------------------------------------------------------------------------
  // Route-access sweep (2026-07-29): every prefix below is fetched from the
  // browser but was NOT exempted, so the deny-by-default canAccessRoute() gate
  // 404'd it (same class of bug that broke /api/thumbnails). Each handler
  // self-authenticates via getSession()/hasPermission() (a guard was added to
  // any that previously did not), so exempting them is safe. This unblocked the
  // CE create form (voices/channels/narration), the timeline editor, System
  // Health provider/drive/credentials cards, and the character/narrator/
  // environment/archetype pickers.
  "/api/tts-voices",
  "/api/channels",
  "/api/narration-upload",
  "/api/timeline",
  "/api/format-styles",
  // Covers nested routes by prefix, including /api/providers/[key]/ops (the
  // System Health double-click detail view). This list is an auth BYPASS, not
  // a grant — every handler under it must still call guardProviders()
  // (session + view:system-health) itself.
  "/api/providers",
  "/api/environments",
  "/api/characters",
  "/api/narrators",
  "/api/archetypes",
  "/api/credentials",
  "/api/storage",
  "/api/vlm-daemon",
  "/api/ai33",
  "/api/dispatch-jobs",
  "/api/voices",
  // Prometheus scrape target — public by design (no session cookie).
  "/api/metrics",
  // VM clipboard helper — reached from the VM browser with no hub cookie.
  "/api/vm-clip",
  // BUSINESS_PLAN_HUB Presenter Studio — pose manifest, pose images, sample
  // narration, RMS envelope, head-mark raster. Every handler self-authenticates
  // via guardStudio() (session + create:job|view:settings to read,
  // edit:settings to write). Without this the deny-by-default gate 404s every
  // JSON and audio route of the Studio.
  "/api/business-hub",
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
        const landing = isTutorialScopedRole(payload.role)
          ? "/tutorial-studio"
          : "/dashboard";
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
  // its handler. Matching is therefore segment-anchored, not a bare prefix —
  // a bare startsWith() meant "/api/jobs" also matched "/api/jobsFOO", so any
  // future route whose name merely began with a listed prefix would silently
  // inherit the bypass. Match the prefix exactly, or the prefix followed by a
  // path separator.
  // VISITOR GATE — must come BEFORE the bypass below, not after.
  //
  // API_ROUTES is an auth-BYPASS list: everything it matches skips the
  // deny-by-default canAccessRoute() gate and authenticates itself inside the
  // handler. That is fine for staff roles, but it means there is no central
  // place where an untrusted session is stopped — each of the ~25 endpoints
  // Tutorial Studio calls would have to remember to check. The sales-demo role
  // is handed to people outside the company, so it gets a chokepoint instead:
  // one allowlist, consulted before any handler is reached.
  //
  // Only fires for a valid session cookie carrying the visitor role. Worker and
  // external callers authenticate with bearer tokens and no cookie, so they
  // never enter this branch; every other role falls straight through.
  if (pathname.startsWith("/api/")) {
    const sessionToken = request.cookies.get("hub_session")?.value;
    if (sessionToken) {
      try {
        const visitor = await verifyJWT(sessionToken);
        if (
          isVisitorRole(visitor.role) &&
          !isVisitorAllowedApi(pathname, request.method)
        ) {
          return NextResponse.json(
            { error: "Not available in the demo account." },
            { status: 403 },
          );
        }
        // READ-ONLY GATE — same reasoning, one step wider.
        //
        // A VIEWER (the investor / outside-stakeholder login) is allowed to
        // read the real hub, so it cannot use the visitor allowlist. What it
        // must never do is write, and the per-route checks cannot promise
        // that: most handlers under the API_ROUTES bypass authenticate with
        // getSession() alone, so any logged-in role can POST to them. Refuse
        // the verb here instead — before any handler is reached — and the
        // guarantee holds for routes added later too.
        if (
          isReadOnlyRole(visitor.role) &&
          !isReadOnlyAllowedApiWrite(pathname, request.method)
        ) {
          return NextResponse.json(
            { error: "This account has read-only access." },
            { status: 403 },
          );
        }
      } catch {
        // Unverifiable token — fall through to the normal path, which will
        // bounce it to /login. Never fail open INTO the visitor branch.
      }
    }
  }

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
    // Scoped roles have a dedicated home (their whole app is one section), so
    // bounce them there — a redirect is the right UX for deliberate scoping.
    if (isTutorialScopedRole(session.role)) {
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
