import { OperatorRole } from "@repo/contracts";
import type { JWTPayload } from "./jwt";

/**
 * Role-Based Access Control (RBAC) System
 *
 * Defines permissions for the 5 operator roles:
 * - ADMIN: Full access to everything
 * - MANAGER: Operational oversight, cannot modify templates or settings
 * - PRODUCTION_VA: Can only access assigned jobs for HeyGen uploads
 * - UPLOADER_VA: Can only access approved jobs for YouTube uploads
 * - VIEWER: Read-only access, no write operations. This is the
 *   investor / outside-stakeholder login: it sees the real hub and every
 *   write is refused, at the route gate AND at the API chokepoint
 *   (isReadOnlyRole / isReadOnlyAllowedApiWrite).
 */

export type Permission =
  | "view:dashboard"
  | "view:jobs"
  | "view:job-detail"
  | "create:job"
  | "edit:job"
  | "delete:job"
  | "pause:job"
  | "resume:job"
  | "assign:job"
  | "upload:heygen-footage"
  | "upload:youtube-video"
  | "view:upload-queue"
  | "view:formats"
  | "view:analytics"
  | "view:templates"
  | "create:template"
  | "edit:template"
  | "delete:template"
  | "manage:templates"
  | "view:channels"
  | "create:channel"
  | "edit:channel"
  | "delete:channel"
  | "manage:channels"
  | "view:system-health"
  | "view:team"
  | "create:user"
  | "edit:user"
  | "delete:user"
  | "view:settings"
  | "edit:settings"
  | "review:qc"
  | "retry:job"
  | "view:knowledge"
  | "manage:knowledge"
  | "view:production"
  | "create:tutorial-job"
  | "manage:tutorial-settings"
  // Thumbnails-only grant: view a finished job's thumbnails, regenerate them,
  // and choose which one ships. Deliberately NARROWER than edit:job (no state
  // changes, no script/asset access) and narrower than view:settings (no
  // archetype/branding/credential editing, no Thumbnail Studio route). It
  // exists so an UPLOADER_VA can fix a bad thumbnail — which today is
  // impossible: they 403 on every thumbnail surface in the app.
  | "manage:thumbnails"
  // ADMIN-only. Editing the ONE secrets area (Settings -> Credentials). Tighter
  // than edit:settings (which MANAGER also holds). Users must NOT be able to
  // change credentials (§3.3 / T2). VAs never handle keys.
  | "manage:credentials";

/**
 * Permission matrix defining what each role can do
 */
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "create:job",
    "edit:job",
    "delete:job",
    "pause:job",
    "resume:job",
    "assign:job",
    "upload:heygen-footage",
    "upload:youtube-video",
    "view:upload-queue",
    "view:formats",
    "view:analytics",
    "view:templates",
    "create:template",
    "edit:template",
    "delete:template",
    "manage:templates",
    "view:channels",
    "create:channel",
    "edit:channel",
    "delete:channel",
    "manage:channels",
    "view:system-health",
    "view:team",
    "create:user",
    "edit:user",
    "delete:user",
    "view:settings",
    "edit:settings",
    "review:qc",
    "retry:job",
    "view:knowledge",
    "manage:knowledge",
    "view:production",
    "create:tutorial-job",
    "manage:tutorial-settings",
    "manage:thumbnails",
    "manage:credentials",
  ],
  MANAGER: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "create:job",
    "edit:job",
    "delete:job",
    "pause:job",
    "resume:job",
    "assign:job",
    "view:upload-queue",
    "view:formats",
    "view:analytics",
    "view:templates",
    "view:channels",
    "create:channel",
    "edit:channel",
    "delete:channel",
    "manage:channels",
    "view:system-health",
    "view:team",
    "view:settings",
    "review:qc",
    "retry:job",
    "view:knowledge",
    "view:production",
    "create:tutorial-job",
    "manage:tutorial-settings",
    "manage:thumbnails",
  ],
  PRODUCTION_VA: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "view:formats",
    "view:settings",
    "upload:heygen-footage",
    "view:knowledge",
    "view:production",
    "create:tutorial-job",
  ],
  UPLOADER_VA: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "view:formats",
    "view:upload-queue",
    "upload:youtube-video",
    "view:knowledge",
    // The uploader fixes bad thumbnails before publishing. This is the ONLY
    // write they gain: regenerate a thumbnail and select which one ships. It
    // does NOT include edit:job, view:settings or edit:settings, so job state,
    // archetype/branding config and credentials all stay out of reach.
    "manage:thumbnails",
  ],
  VIEWER: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "view:formats",
    "view:analytics",
    "view:templates",
    "view:channels",
    "view:system-health",
    "view:knowledge",
  ],
  // DRAMA_OPERATOR — scoped to LONG_FORM_DRAMA only. The jobs and
  // formats list pages filter by format server-side using
  // isDramaScopedRole(); the sidebar hides everything else.
  DRAMA_OPERATOR: [
    "view:dashboard",
    "view:jobs",
    "view:job-detail",
    "create:job",
    "view:formats",
    "review:qc",
  ],
  // TUTORIAL_VA — scoped to the Tutorial Production Engine + the
  // knowledge base. The KB list page filters per-course by `allowed_roles`,
  // so a TUTORIAL_VA only sees courses that are open (allowed_roles=[]) or
  // explicitly include TUTORIAL_VA — currently just "Recording Stuff".
  // `manage:thumbnails` is here because the tutorial VA is the person the
  // Review tab asks "is this thumbnail any good?" — and they held none of the
  // grants any thumbnail surface checks, so the Thumbnails tab was hidden from
  // them and every /api/thumbnails/* call 403'd. The grant is read + select
  // only (see its definition above): no generate, no upload, no archetype or
  // branding edits, and /thumbnails (the config studio) still needs
  // view:settings, which they do not have.
  TUTORIAL_VA: [
    "view:production",
    "create:tutorial-job",
    "view:knowledge",
    "manage:thumbnails",
  ],
  // Sales demo — ONE read permission and nothing else. Deliberately not
  // "VIEWER with less": VIEWER carries view:jobs, view:channels, view:analytics
  // and view:system-health, which on a real hub means the prospect reads every
  // job title (the whole content strategy), the real channel names (so they can
  // go find the YouTube channels), and which niches are performing. That is the
  // exact disclosure this account exists to prevent.
  //
  // view:production alone reaches the Studio list and job detail, and BOTH of
  // those filter on created_by — so this role sees only rows created under its
  // own user id. No create:tutorial-job: a visitor must never be able to spend
  // LLM, TTS, image or render budget.
  TUTORIAL_VISITOR: ["view:production"],
};

/**
 * True for roles that should only see LONG_FORM_DRAMA content
 * everywhere on the platform — list pages, sidebar, format pickers.
 */
export function isDramaScopedRole(role: string | undefined): boolean {
  return role === "DRAMA_OPERATOR";
}

/**
 * True for the tutorial VA role — scoped to ONLY the Tutorial Studio
 * (/tutorial-studio). Used to hide the rest of the sidebar and to gate
 * every other route server-side.
 */
export function isTutorialScopedRole(role: string | undefined): boolean {
  return role === "TUTORIAL_VA" || role === "TUTORIAL_VISITOR";
}

/**
 * True for the read-only sales-demo role.
 *
 * Kept separate from isTutorialScopedRole so the two questions stay distinct:
 * that one asks "which section of the app is this role confined to", this one
 * asks "is this an untrusted outsider". They are answered in different places
 * and must not drift into one flag — a future scoped role that is staff, not a
 * prospect, has to be able to write.
 */
export function isVisitorRole(role: string | undefined): boolean {
  return role === "TUTORIAL_VISITOR";
}

/**
 * API paths a visitor may GET. Everything else under /api/ is refused in
 * middleware BEFORE the API_ROUTES auth-bypass is consulted.
 *
 * ALLOWLIST, NOT A BLOCKLIST, and that is the whole design. Tutorial Studio
 * alone calls 25 distinct endpoints — thumbnails, ranking, video-stitch, the
 * music library, transcripts — and most do not filter by created_by, because
 * until now every caller was staff. Enumerating what to hide would mean
 * auditing all 25 and re-auditing on every new route; a route added next month
 * and forgotten would silently serve real data to a stranger. Listing the three
 * that are safe means anything new is unreachable until someone decides
 * otherwise.
 *
 * Each entry below is here because it filters on the session's own user id, so
 * a visitor sees only rows seeded under the demo account:
 *   - /api/production/jobs          listTutorialJobsByUser(created_by = session)
 *   - /api/production/jobs/<id>     403s unless job.created_by === session
 *   - /api/production/keywords/mine scoped to the caller by name
 */
const VISITOR_API_ALLOWLIST = [
  "/api/production/jobs",
  "/api/production/keywords/mine",
];

export function isVisitorAllowedApi(pathname: string, method: string): boolean {
  // Reads only. A visitor has no write permission anyway, but the routes
  // self-authenticate and a missed permission check in any one of them would be
  // a silent hole — so the verb is refused here too, before the handler runs.
  if (method !== "GET" && method !== "HEAD") return false;
  return VISITOR_API_ALLOWLIST.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * True for a read-only stakeholder login — VIEWER. Handed to investors and
 * outside collaborators who should be able to look at everything and change
 * nothing.
 *
 * Separate from isVisitorRole: that one marks an untrusted PROSPECT whose data
 * is substituted server-side. A VIEWER sees the real hub; the only guarantee
 * here is that it cannot write.
 */
export function isReadOnlyRole(role: string | undefined): boolean {
  return role === "VIEWER";
}

/**
 * Write endpoints a read-only role may still call. Everything else under
 * /api/ is refused in middleware for those roles when the verb is not
 * GET/HEAD.
 *
 * WHY A CHOKEPOINT AND NOT PER-ROUTE CHECKS: API_ROUTES in middleware.ts is an
 * auth BYPASS list, and ~60 write handlers under it authenticate only with
 * getSession() — any logged-in role passes. That was safe while every account
 * belonged to staff. A read-only stakeholder account changes that assumption,
 * and auditing 60 handlers (plus every one added later) is not a guarantee.
 * One rule, consulted before any handler runs, is.
 *
 * The two exceptions are per-user course-watching state — a viewer's own
 * progress marker and their own notes. Neither touches anyone else's data, and
 * without them the knowledge player silently fails to remember where they got
 * to.
 */
const READ_ONLY_WRITE_ALLOWLIST = [
  "/api/knowledge/progress",
  "/api/knowledge/notes",
];

export function isReadOnlyAllowedApiWrite(
  pathname: string,
  method: string,
): boolean {
  if (method === "GET" || method === "HEAD") return true;
  return READ_ONLY_WRITE_ALLOWLIST.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Check if a user has a specific permission
 *
 * @param session - User session with role
 * @param permission - Permission to check
 * @returns true if user has permission
 */
export function hasPermission(
  session: JWTPayload | null,
  permission: Permission,
): boolean {
  if (!session) {
    return false;
  }

  const permissions = ROLE_PERMISSIONS[session.role] || [];
  return permissions.includes(permission);
}

/**
 * Check if a user can access a specific route
 *
 * @param session - User session with role
 * @param pathname - Route pathname to check
 * @returns true if user can access route
 */
export function canAccessRoute(
  session: JWTPayload | null,
  pathname: string,
): boolean {
  if (!session) {
    return false;
  }

  const effectivePath = pathname;

  // Drama-scoped operator: allow only routes that touch the
  // LONG_FORM_DRAMA format. Everything else 403s back to the dashboard.
  if (isDramaScopedRole(session.role)) {
    const ALLOWED_PREFIXES = [
      "/",
      "/dashboard",
      "/jobs", // list filtered server-side; detail page checks job.format
      "/jobs/create/long-form-drama",
      "/jobs/batch",
      "/formats", // list filtered server-side
      "/formats/long-form-drama",
    ];
    if (
      ALLOWED_PREFIXES.some(
        (p) => effectivePath === p || effectivePath.startsWith(p + "/"),
      )
    ) {
      return true;
    }
    // Block anything else (settings, templates, channels, team, etc.).
    return false;
  }

  // Tutorial VA: the Tutorial Studio + read-only knowledge base.
  // Everything else 403s back to /tutorial-studio. The knowledge list and course
  // detail pages further enforce `allowed_roles` per-course, so a
  // TUTORIAL_VA who URL-hops to a course they shouldn't see is bounced.
  // /knowledge/manage stays blocked — they have view:knowledge, not manage.
  if (isTutorialScopedRole(session.role)) {
    // /tutorial-studio covers the studio itself AND the Video Stitcher, which
    // now lives at /tutorial-studio/video-stitcher. A tutorial VA finishes
    // their recorded long-form parts there — send-to-stitcher deep-links them
    // to /tutorial-studio/video-stitcher?job=<draftId>. The stitcher API
    // routes scope every mutation to the job's owner, so a VA can only touch
    // their own job.
    if (
      effectivePath === "/tutorial-studio" ||
      effectivePath.startsWith("/tutorial-studio/")
    ) {
      return true;
    }
    // The demo account stops at the Studio. The knowledge base is internal
    // SOPs and training material — how the operation actually runs — which is
    // the last thing to hand a prospective buyer. It has no view:knowledge
    // permission either, but this branch grants the ROUTE before any page-level
    // permission check runs, so the exclusion has to be stated here.
    if (isVisitorRole(session.role)) return false;
    if (effectivePath.startsWith("/knowledge/manage")) return false;
    if (
      effectivePath === "/knowledge" ||
      effectivePath.startsWith("/knowledge/")
    ) {
      return true;
    }
    return false;
  }

  // Route-based access control
  if (effectivePath.startsWith("/team")) {
    return hasPermission(session, "view:team");
  }

  if (effectivePath.startsWith("/settings")) {
    return hasPermission(session, "view:settings");
  }

  if (effectivePath.startsWith("/formats")) {
    return hasPermission(session, "view:formats");
  }

  if (effectivePath.startsWith("/analytics")) {
    return hasPermission(session, "view:analytics");
  }

  if (effectivePath.startsWith("/templates/create")) {
    return hasPermission(session, "create:template");
  }

  if (
    effectivePath.startsWith("/templates") &&
    effectivePath.includes("/edit")
  ) {
    return hasPermission(session, "edit:template");
  }

  if (effectivePath.startsWith("/templates")) {
    return hasPermission(session, "view:templates");
  }

  if (effectivePath.startsWith("/channels")) {
    return hasPermission(session, "view:channels");
  }

  if (effectivePath.startsWith("/system-health")) {
    return hasPermission(session, "view:system-health");
  }

  if (effectivePath.startsWith("/jobs/create")) {
    return hasPermission(session, "create:job");
  }

  if (effectivePath.startsWith("/jobs")) {
    return hasPermission(session, "view:jobs");
  }

  if (effectivePath.startsWith("/knowledge")) {
    return hasPermission(session, "view:knowledge");
  }

  if (effectivePath.startsWith("/style-library")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "view:settings")
    );
  }

  // Character Library — the channel hosts whose faces go on thumbnails, and
  // the drama cast. Same gate as the other config studios.
  //
  // This rule was MISSING, so /characters has been 404ing for every role since
  // the page was built: canAccessRoute is deny-by-default and nothing matched
  // it. Nobody noticed because the table had zero rows, which is also why the
  // persona form ended up bolted onto Thumbnail Studio instead.
  if (effectivePath.startsWith("/characters")) {
    return (
      hasPermission(session, "view:settings") ||
      hasPermission(session, "create:job")
    );
  }

  // Asset Library / asset graph — linked from archetype cards and the asset
  // graph editor. Without this rule the page 404s for every non-scoped role
  // (deny-by-default). Gate to anyone who can inspect jobs or create them.
  if (effectivePath.startsWith("/asset-library")) {
    return (
      hasPermission(session, "view:job-detail") ||
      hasPermission(session, "create:job")
    );
  }

  // Style Collections: create requires edit:settings, view requires create:job or view:settings
  if (
    effectivePath.startsWith("/style-collections/create") ||
    (effectivePath.includes("/style-collections/") &&
      effectivePath.includes("/edit"))
  ) {
    return hasPermission(session, "edit:settings");
  }

  if (effectivePath.startsWith("/style-collections")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "view:settings")
    );
  }

  // Video Stitcher — lives inside the Tutorial Studio at
  // /tutorial-studio/video-stitcher. ADMIN/MANAGER (create:job) plus tutorial
  // VAs, who hand off their recorded LONG_FORM parts here to finish/start/
  // download the stitch. The stitcher API routes scope tutorial VAs to their
  // own jobs. Checked before the /tutorial-studio rule below so the stitcher
  // keeps its own (slightly wider) gate.
  if (effectivePath.startsWith("/tutorial-studio/video-stitcher")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "create:tutorial-job")
    );
  }

  // Clip Library: accessible to users who can create jobs (ADMIN, MANAGER)
  if (effectivePath.startsWith("/clip-library")) {
    return hasPermission(session, "create:job");
  }

  // Clip Forge — 9:16 short-form clipping engine. Same gate as the long-form
  // job tools: anyone who can create jobs gets the full console.
  if (effectivePath.startsWith("/clip-forge")) {
    return hasPermission(session, "create:job");
  }

  // Production Board — live stage view of content_jobs (formerly "Dark
  // Factory"; the Hermes/HCP wiring is gone). Same gate as job creation.
  if (effectivePath.startsWith("/factory")) {
    return hasPermission(session, "create:job");
  }

  // Format Styles: accessible to users who can create jobs or manage settings
  if (effectivePath.startsWith("/format-styles")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "view:settings")
    );
  }

  // Tutorial Studio. Formerly /production — the route was renamed; the
  // `view:production` permission name and the /api/production/* namespace were
  // deliberately left alone. /production still redirects here (middleware.ts).
  // `manage:thumbnails` also opens this route, but ONLY the Thumbnails tab:
  // page-client renders the production tabs (Dashboard/Create/Studio/Keywords/
  // Settings) exclusively for view:production holders, and every production
  // API under /api/production/* still checks view:production itself. An
  // UPLOADER_VA landing here sees a thumbnail fixer and nothing else.
  if (effectivePath.startsWith("/tutorial-studio")) {
    return (
      hasPermission(session, "view:production") ||
      hasPermission(session, "manage:thumbnails")
    );
  }

  // Thumbnail Studio: config surface for archetypes + channel persona/branding.
  // Gated the same as the underlying /api/thumbnails/* routes (view:settings
  // to view, edit:settings to mutate — enforced by the server actions).
  if (effectivePath.startsWith("/thumbnails")) {
    return hasPermission(session, "view:settings");
  }

  // Global Subtitle System: preset library, editor, fonts, assignments.
  // Global config surface — gated like the other config studios: anyone who
  // can create jobs or manage settings (ADMIN, MANAGER) gets the console.
  // The /api/v1/subtitle-* routes are exempted above and do their own auth.
  if (effectivePath.startsWith("/subtitles")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "view:settings")
    );
  }

  // Presenter Studio: pose hitbox authoring for BUSINESS_PLAN_HUB. Gated like
  // the other global config studios; writing the pose library additionally
  // needs edit:settings, enforced in the API guard. page.tsx performs the same
  // check itself, so this is the outer half of a gate enforced twice.
  if (effectivePath.startsWith("/business-hub-studio")) {
    return (
      hasPermission(session, "create:job") ||
      hasPermission(session, "view:settings")
    );
  }

  // Dashboard is accessible to all authenticated users
  if (effectivePath === "/" || effectivePath === "/dashboard") {
    return hasPermission(session, "view:dashboard");
  }

  // Default: deny access for unknown routes (deny by default)
  return false;
}

/**
 * Get all permissions for a role
 *
 * @param role - Operator role
 * @returns Array of permissions
 */
export function getRolePermissions(role: string): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}
