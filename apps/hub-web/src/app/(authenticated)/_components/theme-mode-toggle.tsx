"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Flips the `data-theme` attribute on the authenticated
 * shell wrapper (instant, since the v2 tokens cascade) and persists the choice
 * in the `hub_ui_mode` cookie so SSR renders the same mode next load.
 */
export function ThemeModeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-theme]");
    const cur = el?.getAttribute("data-theme");
    if (cur === "light" || cur === "dark") setMode(cur);
  }, []);

  const toggle = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    document
      .querySelectorAll<HTMLElement>("[data-theme]")
      .forEach((el) => el.setAttribute("data-theme", next));
    document.cookie = `hub_ui_mode=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <button
      onClick={toggle}
      title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle light/dark mode"
      className="flex items-center justify-center"
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "var(--v2-surface-2)",
        border: "1px solid var(--v2-border-1)",
        color: "var(--v2-text-2)",
        cursor: "pointer",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {mode === "dark" ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
