"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { CommandPalette } from "./command-palette";
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
  const [paletteOpen, setPaletteOpen] = useState(false);

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map(formatSegment);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-8"
        style={{
          height: 64,
          backgroundColor: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
          boxShadow: "0 4px 20px rgba(var(--v2-accent-rgb), 0.06)",
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
                  style={{ fontSize: 14, color: "rgba(229,226,225,0.2)" }}
                >
                  chevron_right
                </span>
              )}
              <span
                style={{
                  color:
                    i === crumbs.length - 1
                      ? "var(--v2-accent)"
                      : "rgba(229,226,225,0.4)",
                  fontWeight: i === crumbs.length - 1 ? 700 : 500,
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>

        {/* Search trigger */}
        <div className="flex-1 max-w-sm mx-12">
          <button
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
                  background: "rgba(75,68,85,0.4)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 9,
                  fontFamily: "monospace",
                }}
              >
                \u2318
              </kbd>
              <kbd
                style={{
                  background: "rgba(75,68,85,0.4)",
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
        className={isConnected ? "animate-pulse" : ""}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: isConnected ? "#23decb" : "#ffb4ab",
          boxShadow: isConnected
            ? "0 0 8px rgba(35,222,203,0.5)"
            : "0 0 8px rgba(255,180,171,0.5)",
        }}
      />
      <span
        style={{
          color: "rgba(229,226,225,0.4)",
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
