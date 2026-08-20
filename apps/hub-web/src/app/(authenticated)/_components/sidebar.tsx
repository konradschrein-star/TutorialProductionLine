"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRegisterKeybind } from "../_lib/keybinds";
import { logoutAction } from "@/app/actions/auth";
import type { JWTPayload } from "@/lib/auth/jwt";
import { canAccessRoute } from "@/lib/auth/rbac";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  external?: boolean;
}

interface NavSection {
  /** Small uppercase header above the group. `null` = no header (top block). */
  title: string | null;
  items: NavItem[];
}

/**
 * Sidebar navigation, grouped.
 *
 * OVERVIEW   — where you look to know what the system is doing.
 * PRODUCTION — the tutorial tools + the channels they publish to.
 * SYSTEM     — configuration, health, people.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    title: "Production",
    items: [
      {
        href: "/tutorial-studio",
        label: "Tutorial Studio",
        icon: "smart_display",
      },
      { href: "/thumbnails", label: "Thumbnails", icon: "image" },
      { href: "/channels", label: "Channels", icon: "subscriptions" },
    ],
  },
  {
    title: "System",
    items: [
      {
        href: "/system-health",
        label: "System Health",
        icon: "health_and_safety",
      },
      { href: "/team", label: "Team", icon: "group" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

interface Props {
  session: JWTPayload;
}

export function AppSidebar({ session }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  useRegisterKeybind(
    { key: "g+d", description: "Go to Dashboard", category: "Navigation" },
    () => router.push("/dashboard"),
    [],
  );
  useRegisterKeybind(
    { key: "g+c", description: "Go to Channels", category: "Navigation" },
    () => router.push("/channels"),
    [],
  );
  useRegisterKeybind(
    {
      key: "g+p",
      description: "Go to Tutorial Studio",
      category: "Navigation",
    },
    () => router.push("/tutorial-studio"),
    [],
  );
  useRegisterKeybind(
    { key: "g+h", description: "Go to System Health", category: "Navigation" },
    () => router.push("/system-health"),
    [],
  );
  useRegisterKeybind(
    { key: "g+m", description: "Go to Team", category: "Navigation" },
    () => router.push("/team"),
    [],
  );

  const userInitial = session.email[0].toUpperCase();
  // Each role gets exactly the links it can actually open. Filtering on
  // canAccessRoute (the same function the middleware gates with) means the
  // sidebar cannot drift out of step with what is reachable.
  const visibleSections: NavSection[] = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (i) => i.external || canAccessRoute(session, i.href),
    ),
  })).filter((section) => section.items.length > 0);

  // Exactly one item is active: the longest internal href that prefixes the
  // current path. Without the longest-match rule /settings would light up on
  // /settings/music, and /tutorial-studio on /tutorial-studio/video-stitcher.
  const activeHref = visibleSections
    .flatMap((s) => s.items)
    .filter((i) => !i.external)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside
      className="fixed left-0 top-0 h-full z-50 flex flex-col py-8"
      style={{
        width: 256,
        backgroundColor: "#000",
        borderRight: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
      }}
    >
      {/* Logo */}
      <div className="px-6 mb-10">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              boxShadow: "0 0 15px rgba(var(--v2-accent-rgb), 0.4)",
            }}
          >
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
            >
              bolt
            </span>
          </div>
          <div>
            <h2
              style={{
                color: "#e5e2e1",
                fontSize: 17,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              Pulse Console
            </h2>
            <p
              style={{
                color: "rgba(var(--v2-accent-rgb), 0.6)",
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                marginTop: 3,
              }}
            >
              Content Forge
            </p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 overflow-y-auto min-h-0">
        {visibleSections.map((section, sectionIndex) => (
          <div
            key={section.title ?? `section-${sectionIndex}`}
            style={{ marginBottom: 14 }}
          >
            {section.title && (
              <div
                style={{
                  padding: "0 16px",
                  marginBottom: 6,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: "rgba(229,226,225,0.22)",
                }}
              >
                {section.title}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon, external }) => {
                const isActive = !external && href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noopener noreferrer" : undefined}
                    className={`v2-nav-item flex items-center px-4 py-2.5${isActive ? " v2-nav-active" : ""}`}
                    style={
                      isActive
                        ? {
                            background:
                              "linear-gradient(to right, rgba(var(--v2-accent-rgb), 0.20), transparent)",
                            borderLeft: "4px solid var(--v2-accent)",
                            color: "var(--v2-accent)",
                            boxShadow:
                              "0 0 15px rgba(var(--v2-accent-rgb), 0.15)",
                          }
                        : {
                            color: "rgba(229,226,225,0.4)",
                            borderLeft: "4px solid transparent",
                          }
                    }
                  >
                    <span
                      className="material-symbols-outlined mr-3"
                      style={{
                        fontSize: 20,
                        color: isActive
                          ? "var(--v2-accent)"
                          : "rgba(229,226,225,0.4)",
                      }}
                    >
                      {icon}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: isActive
                          ? "var(--v2-accent)"
                          : "rgba(229,226,225,0.4)",
                      }}
                    >
                      {label}
                    </span>
                    {external && (
                      <span
                        className="material-symbols-outlined ml-auto"
                        style={{ fontSize: 12, color: "rgba(229,226,225,0.3)" }}
                      >
                        open_in_new
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user info */}
      <div className="px-6 mt-auto space-y-4">
        <div
          className="pt-4"
          style={{ borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.10)" }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              }}
            >
              {userInitial}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  color: "#e5e2e1",
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {session.email}
              </div>
              <div
                style={{
                  color: "#cdc3d7",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {session.role.replace(/_/g, " ")}
              </div>
            </div>
          </div>
          <form
            action={logoutAction as unknown as string}
            style={{ width: "100%" }}
          >
            <button
              type="submit"
              className="v2-btn"
              style={{
                width: "100%",
                justifyContent: "flex-start",
                padding: "7px 10px",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                logout
              </span>
              <span>Logout</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
