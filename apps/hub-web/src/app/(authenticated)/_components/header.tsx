"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { WORKSPACE_NAVIGATION } from "./workspace-navigation";
import { useState, useEffect } from "react";
import { CommandPalette } from "./command-palette";
import { paletteShortcut } from "./command-palette-model";
import { useSSE } from "@/hooks/use-sse";
import { ThemeModeToggle } from "./theme-mode-toggle";
import type { JWTPayload } from "@/lib/auth/jwt";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  jobs: "Jobs",
  create: "Create",
  templates: "Templates",
  "system-health": "System Health",
  team: "Team",
  settings: "Settings",
  "tutorial-studio": "Tutorial Studio",
  thumbnails: "Thumbnail Studio",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatSegment(s: string): string {
  if (UUID_RE.test(s)) return s.slice(0, 8) + "\u2026";
  return SEGMENT_LABELS[s] ?? s;
}

interface Props {
  session: JWTPayload;
}

export function AppHeader({ session }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = paletteShortcut(event);
      if (!action) return;
      event.preventDefault();
      setPaletteOpen(current => action === "toggle" ? !current : false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map(formatSegment);
  if (pathname === "/tutorial-studio") {
    const entry = WORKSPACE_NAVIGATION.find(item => item.href === `/tutorial-studio?tab=${searchParams.get("tab") || "dashboard"}`);
    if (entry) crumbs.push(entry.label);
  }

  return (
    <>
      <header
        className="studio-header sticky top-0 z-40 flex items-center justify-between"
        style={{
          height: 64,
          backgroundColor: "var(--v2-surface-1)",
          borderBottom: "1px solid var(--v2-border-1)",
        }}
      >
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-2"
          style={{ fontSize: 12, fontWeight: 500 }}
        >
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14, color: "var(--v2-text-3)" }}
                >
                  chevron_right
                </span>
              )}
              <span
                style={{
                  color:
                    i === crumbs.length - 1
                      ? "var(--v2-text-1)"
                      : "var(--v2-text-2)",
                  fontWeight: i === crumbs.length - 1 ? 700 : 500,
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>

        {/* Search trigger */}
        <div className="studio-header-search flex-1 max-w-sm mx-6">
          <button
            type="button"
            aria-label="Search or jump to a page"
            aria-haspopup="dialog"
            aria-expanded={paletteOpen}
            onClick={() => setPaletteOpen(true)}
            className="v2-glow w-full flex items-center gap-3 px-4 py-2 rounded-full text-left"
            style={{
              backgroundColor: "var(--v2-surface-2)",
              border: "1px solid var(--v2-border-1)",
              color: "var(--v2-text-3)",
              fontSize: 12,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              search
            </span>
            <span>Search or jump to...</span>
            <span className="ml-auto flex items-center gap-1">
              <kbd
                style={{
                  background: "var(--v2-surface-3)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 9,
                  fontFamily: "monospace",
                }}
              >
                Ctrl / ⌘
              </kbd>
              <kbd
                style={{
                  background: "var(--v2-surface-3)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 9,
                  fontFamily: "monospace",
                }}
              >
                K
              </kbd>
            </span>
          </button>
        </div>

        {/* Right: SSE status + user avatar */}
        <div className="flex items-center gap-4">
          <ThemeModeToggle />
          <SseIndicator />
          <div style={{ width: 1, height: 20, backgroundColor: "#4b4455" }} />
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{
              background:
                "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            }}
          >
            {session.email[0].toUpperCase()}
          </div>
        </div>
      </header>

      <CommandPalette
        session={session}
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}

// SSE status indicator — uses the existing useSSE hook from @/hooks/use-sse
function SseIndicator() {
  const { isConnected } = useSSE();
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: isConnected ? "var(--v2-success)" : "var(--v2-error)",
        }}
      />
      <span
        style={{
          color: "var(--v2-text-2)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {isConnected ? "Live" : "Offline"}
      </span>
    </div>
  );
}
