import React, { type ReactNode } from "react";

/** Decorative: always pair with a visible language name, never use as a label. */
export function LanguageFlag({ language, fallback }: { language: string; fallback?: string }) {
  let drawing: ReactNode;
  switch (language.toLowerCase()) {
    case "en":
      drawing = <><path fill="#012169" d="M0 0h30v20H0z" /><path stroke="#fff" strokeWidth="5" d="m0 0 30 20M30 0 0 20" /><path stroke="#c8102e" strokeWidth="2" d="m0 0 30 20M30 0 0 20" /><path stroke="#fff" strokeWidth="7" d="M15 0v20M0 10h30" /><path stroke="#c8102e" strokeWidth="4" d="M15 0v20M0 10h30" /></>;
      break;
    case "de":
      drawing = <><path fill="#151515" d="M0 0h30v7H0z" /><path fill="#d00" d="M0 7h30v6H0z" /><path fill="#ffce00" d="M0 13h30v7H0z" /></>;
      break;
    case "fr":
      drawing = <><path fill="#0055a4" d="M0 0h10v20H0z" /><path fill="#fff" d="M10 0h10v20H10z" /><path fill="#ef4135" d="M20 0h10v20H20z" /></>;
      break;
    case "it":
      drawing = <><path fill="#009246" d="M0 0h10v20H0z" /><path fill="#fff" d="M10 0h10v20H10z" /><path fill="#ce2b37" d="M20 0h10v20H20z" /></>;
      break;
    case "sv":
      drawing = <><path fill="#006aa7" d="M0 0h30v20H0z" /><path fill="#fecc00" d="M9 0h4v20H9zM0 8h30v4H0z" /></>;
      break;
    default:
      return fallback ? <span aria-hidden="true">{fallback}</span> : null;
  }
  return <svg width="20" height="14" viewBox="0 0 30 20" aria-hidden="true" focusable="false" style={{ display: "inline-block", verticalAlign: "-1px", flexShrink: 0, borderRadius: 1, overflow: "hidden" }}>{drawing}</svg>;
}
