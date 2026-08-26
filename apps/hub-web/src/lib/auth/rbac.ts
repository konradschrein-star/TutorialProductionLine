import type { JWTPayload } from "./jwt";

/**
 * Role-Based Access Control (RBAC) System — single-tenant Tutorial Studio.
 *
 * Collapsed from the multi-format ContentForge hub to three roles:
 * - ADMIN: owner/admin. Full access to everything.
 * - PRODUCTION_VA: creates and produces tutorials + fixes thumbnails.
 * - UPLOADER_VA: fixes/selects thumbnails on finished videos, nothing else.
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
  // Narrower than manage:tutorial-settings: edit the WORKFLOW settings a
  // producer VA tunes for their own output — voice defaults, playback speed,
  // record hotkey, prompt library. Granted to PRODUCTION_VA. Deliberately does
  // NOT carry the broad powers manage:tutorial-settings also gates (seeing
  // every VA's review queue, editing anyone's job, credentials, storage,
  // alerts) — those stay admin-only.
  | "edit:tutorial-workflow"
  // Thumbnails-only grant: view a finished job's thumbnails, regenerate them,
  // and choose which one ships. Deliberately NARROWER than edit:job (no state
  // changes, no script/asset access) and narrower than view:settings (no
  // archetype/branding/credential editing, no Thumbnail Studio route).
  | "manage:thumbnails"
  // ADMIN-only. Editing the ONE secrets area (Settings -> Credentials). Tighter
  // than edit:settings. VAs never handle keys.
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
    "edit:tutorial-workflow",
    "manage:thumbnails",
    "manage:credentials",
  ],
  // Tutorial producer. Reaches the Tutorial Studio (view:production), can spend
  // budget to create tutorial jobs, and can fix/select thumbnails on finished
  // videos. No settings/credentials/team access.
  PRODUCTION_VA: [
    // The producing VA gets the full sidebar EXCEPT Channels and the sensitive
    // System items (Settings→credentials, Accounts→user management), which stay
    // admin-only. Dashboard + System Health are read-only overviews; Thumbnails
    // (Thumbnail Studio) opens via manage:thumbnails, not view:settings, so the
    // VA never reaches the credentials area.
    "view:dashboard",
    "view:production",
    "create:tutorial-job",
    "manage:thumbnails",
    "view:system-health",
    // Tune their own production defaults (voice, speed, hotkey, prompts). Not
    // credentials/storage/alerts — those need view:settings, which they lack.
    "edit:tutorial-workflow",
  ],
  // Uploader. Fixes a bad thumbnail before publishing and selects which one
  // ships — and nothing else. The Tutorial Studio route opens for the
  // Thumbnails tab only; every production API still checks view:production.
  UPLOADER_VA: ["manage:thumbnails"],
};

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
 * Check if a user can access a specific route.
 *
 * Single-tenant surface: tutorial-studio, thumbnails, channels, settings,
 * team, system-health, dashboard (+ login, which is public anyway). Everything
 * else is deny-by-default.
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

  if (effectivePath === "/login") {
    return true;
  }

  // Tutorial Studio. Formerly /production — the route was renamed; the
  // `view:production` permission name and the /api/production/* namespace were
  // deliberately left alone. `manage:thumbnails` also opens this route, but
  // ONLY the Thumbnails tab (enforced in page-client + every /api/production/*
  // route). An UPLOADER_VA landing here sees a thumbnail fixer and nothing else.
  if (effectivePath.startsWith("/tutorial-studio")) {
    return (
      hasPermission(session, "view:production") ||
      hasPermission(session, "manage:thumbnails")
    );
  }

  // Thumbnail Studio: config surface for archetypes + channel persona/branding.
  // Opened by admins (view:settings) AND producing VAs (manage:thumbnails) —
  // the VA gets the full thumbnail surface WITHOUT the credentials area, which
  // lives behind /settings on its own view:settings gate below.
  if (effectivePath.startsWith("/thumbnails")) {
    return (
      hasPermission(session, "view:settings") ||
      hasPermission(session, "manage:thumbnails")
    );
  }

  if (effectivePath.startsWith("/channels")) {
    return hasPermission(session, "view:channels");
  }

  if (effectivePath.startsWith("/settings")) {
    return hasPermission(session, "view:settings");
  }

  if (effectivePath.startsWith("/team")) {
    return hasPermission(session, "view:team");
  }

  if (effectivePath.startsWith("/system-health")) {
    return hasPermission(session, "view:system-health");
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
