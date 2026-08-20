import type { ReactNode } from "react";
import { getSession } from "../(authenticated)/_lib/v2-auth";

/**
 * Clip Forge — own full-bleed Palantir/IBM Plex shell.
 *
 * Lives outside the (authenticated) route group so the main hub sidebar
 * does not wrap it. Auth is enforced by the global middleware; this layout
 * additionally calls getSession() so server components downstream can rely
 * on a verified user.
 */
export default async function ClipForgeLayout({
  children,
}: {
  children: ReactNode;
}) {
  await getSession();
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes cf-blink { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
        @keyframes cf-fadein { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: none } }
        .cf-root *::-webkit-scrollbar { width: 9px; height: 9px }
        .cf-root *::-webkit-scrollbar-thumb { background: #252b33; border-radius: 6px; border: 2px solid #0a0c0f }
        .cf-root *::-webkit-scrollbar-thumb:hover { background: #323a44 }
        .cf-root *::-webkit-scrollbar-track { background: transparent }
        .cf-root input[type="range"] { accent-color: #7d8893 }
      `}</style>
      <div
        className="cf-root"
        style={{
          position: "fixed",
          inset: 0,
          background: "#0a0c0f",
          color: "#dfe3e8",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          fontSize: 13,
          lineHeight: 1.4,
          overflow: "hidden",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </div>
    </>
  );
}
