"use client";

import { useState, useEffect } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

// Keep this in sync with the sidebar (sidebar.tsx NAV_SECTIONS). Two navigation
// surfaces that disagree are their own lying index — the stale set here used to
// omit the Production Board and point at a non-existent /templates route.
const PAGES = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Tutorial Studio", href: "/tutorial-studio", icon: "smart_display" },
  {
    label: "Video Stitcher",
    href: "/tutorial-studio/video-stitcher",
    icon: "video_library",
  },
  { label: "Thumbnails", href: "/thumbnails", icon: "image" },
  { label: "Channels", href: "/channels", icon: "subscriptions" },
  { label: "System Health", href: "/system-health", icon: "health_and_safety" },
  { label: "Team", href: "/team", icon: "group" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  if (!isOpen) return null;

  function navigate(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl"
        style={{
          background: "rgba(19,19,19,0.98)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
          boxShadow: "0 0 60px rgba(var(--v2-accent-rgb), 0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette" shouldFilter>
          <div
            className="flex items-center px-4 py-3"
            style={{
              borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            }}
          >
            <span
              className="material-symbols-outlined mr-3"
              style={{ color: "var(--v2-accent)", fontSize: 20 }}
            >
              search
            </span>
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent border-none outline-none"
              style={{ color: "#e5e2e1", fontSize: 14 }}
            />
            <kbd style={{ color: "#cdc3d7", fontSize: 10, opacity: 0.5 }}>
              ESC
            </kbd>
          </div>
          <Command.List
            style={{ maxHeight: 320, overflowY: "auto", padding: "8px 0" }}
          >
            <Command.Empty
              style={{
                color: "#cdc3d7",
                fontSize: 12,
                padding: "16px 20px",
                textAlign: "center",
              }}
            >
              No results found.
            </Command.Empty>
            <Command.Group heading="Navigation">
              {PAGES.map((page) => (
                <Command.Item
                  key={page.href}
                  value={page.label}
                  onSelect={() => navigate(page.href)}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer v2-cmd-item"
                  style={{ color: "#cdc3d7", fontSize: 13 }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: "var(--v2-accent)" }}
                  >
                    {page.icon}
                  </span>
                  {page.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return <CommandPalette isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}
