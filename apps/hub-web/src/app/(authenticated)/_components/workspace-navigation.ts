import { canAccessRoute, hasPermission } from "@/lib/auth/rbac";
import type { JWTPayload } from "@/lib/auth/jwt";

export const WORKSPACE_NAVIGATION = [
  { group: "Workspace", label: "My work", href: "/tutorial-studio?tab=dashboard", icon: "home", producer: true },
  { group: "Workspace", label: "All tutorials", href: "/tutorial-studio?tab=library", icon: "table_rows", producer: true },
  { group: "Production", label: "Software & topics", href: "/tutorial-studio?tab=keywords", icon: "search", producer: true },
  { group: "Production", label: "Prepare scripts", href: "/tutorial-studio?tab=create", icon: "description", producer: true },
  { group: "Production", label: "Record", href: "/tutorial-studio?tab=studio", icon: "videocam", producer: true },
  { group: "Production", label: "Thumbnails", href: "/thumbnails", icon: "image", producer: false },
  { group: "Production", label: "Languages", href: "/tutorial-studio?tab=localize", icon: "translate", producer: true },
  { group: "Production", label: "Final review", href: "/tutorial-studio?tab=review", icon: "fact_check", producer: true },
  { group: "Production", label: "Delivery & Uploads", href: "/tutorial-studio?tab=uploads", icon: "cloud_upload", producer: false },
  { group: "Production", label: "Content calendar", href: "/tutorial-studio?tab=calendar", icon: "calendar_month", producer: true },
  { group: "Management", label: "Team activity", href: "/tutorial-studio?tab=activity", icon: "monitoring", producer: true, admin: true },
  { group: "Management", label: "Channels", href: "/channels", icon: "subscriptions", producer: false },
  { group: "Management", label: "Accounts", href: "/team", icon: "group", producer: false },
  { group: "Management", label: "My & workflow settings", href: "/tutorial-studio?tab=settings", icon: "tune", producer: true, admin: true },
  { group: "Management", label: "System Health", href: "/system-health", icon: "health_and_safety", producer: false },
  { group: "Management", label: "Settings", href: "/settings", icon: "settings", producer: false },
] as const;

export function getWorkspaceNavigation(session: JWTPayload) {
  return WORKSPACE_NAVIGATION.filter(item => canAccessRoute(session, item.href)
    && (!item.producer || hasPermission(session, "view:production"))
    && (!item.producer || ["/tutorial-studio?tab=dashboard", "/tutorial-studio?tab=library"].includes(item.href) || hasPermission(session, "create:tutorial-job"))
    && (item.href !== "/tutorial-studio?tab=uploads" || hasPermission(session, "upload:youtube-video") || (hasPermission(session, "view:production") && hasPermission(session, "create:tutorial-job")))
    && (!("admin" in item && item.admin) || session.role === "ADMIN"));
}

export function activeWorkspaceHref(pathname: string, tab: string | null, producer: boolean) {
  if (pathname === "/dashboard") return "/tutorial-studio?tab=dashboard";
  if (pathname === "/tutorial-studio") return `/tutorial-studio?tab=${tab || (producer ? "dashboard" : "uploads")}`;
  return pathname;
}
