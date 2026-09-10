"use client";
import { useState, useEffect } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { getCommandPages } from "./command-palette-model";
import { requestWorkspaceNavigation } from "@/lib/workspace-navigation-guard";
import type { JWTPayload } from "@/lib/auth/jwt";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  session: JWTPayload;
}
export function CommandPalette({ isOpen, onClose, session }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;

  function navigate(href: string) {
    if (!requestWorkspaceNavigation()) return;
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
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a page"
        style={{
          background: "var(--v2-surface-1)",
          border: "1px solid var(--v2-border-1)",
          boxShadow: "0 0 60px rgba(var(--v2-accent-rgb), 0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette" shouldFilter>
          <div
            className="flex items-center px-4 py-3"
            style={{
              borderBottom: "1px solid var(--v2-border-1)",
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
              style={{ color: "var(--v2-text-1)", fontSize: 14 }}
            />
            <kbd style={{ color: "var(--v2-text-3)", fontSize: 10 }}>
              ESC
            </kbd>
          </div>
          <Command.List
            style={{ maxHeight: 320, overflowY: "auto", padding: "8px 0" }}
          >
            <Command.Empty
              style={{
                color: "var(--v2-text-2)",
                fontSize: 12,
                padding: "16px 20px",
                textAlign: "center",
              }}
            >
              No results found.
            </Command.Empty>
            <Command.Group heading="Navigation">
              {getCommandPages(session).map((page) => (
                <Command.Item
                  key={page.href}
                  value={page.label}
                  onSelect={() => navigate(page.href)}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer v2-cmd-item"
                  style={{ color: "var(--v2-text-2)", fontSize: 13 }}
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
// Keep the command palette as the only export from this module.
