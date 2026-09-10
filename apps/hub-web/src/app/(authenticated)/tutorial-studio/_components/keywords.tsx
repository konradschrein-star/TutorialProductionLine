"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { V2Button } from "../../_components";
import { KeywordDirectIntake } from "./keyword-direct-intake";

/**
 * Keywords tab: Directly embeds the authoritative Keyword Tool board (Video ERP)
 * with complete Admin iframe controls.
 */

function KeywordToolPanel() {
  const [url, setUrl] = useState<string | null>(null);
  const [boardUrl, setBoardUrl] = useState<string | null>(null);
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [view, setView] = useState<"board" | "admin">("board");
  const [ssoReady, setSsoReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [integration, setIntegration] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchUrl = () => {
    fetch("/api/production/keywords/embed-url")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(
            d.error || `Failed to open the keyword board (${r.status})`,
          );
        }
        return r.json();
      })
      .then((d) => {
        setIntegration(d.integration ?? "configured");
        setUrl(d.url as string);
        setBoardUrl(
          (typeof d.boardUrl === "string" ? d.boardUrl : d.url) as string,
        );
        setAdminUrl(typeof d.adminUrl === "string" ? d.adminUrl : null);
        setCanAdmin(Boolean(d.canAdmin));
        setView("board");
        setSsoReady(false);
        setErr(null);
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Failed to load keywords");
      });
  };

  useEffect(() => {
    fetchUrl();
  }, []);

  const handleRefresh = () => {
    setReloadKey((prev) => prev + 1);
    toast.success("Refreshing Keyword Tool iframe…");
  };

  const handleOpenExternal = () => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const switchView = (next: "board" | "admin") => {
    if (next === "admin" && (!canAdmin || !adminUrl)) return;
    setView(next);
    setUrl(next === "admin" ? adminUrl : boardUrl);
  };

  if (err) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 12,
          border: "1px solid rgba(248,113,113,0.3)",
          background: "rgba(248,113,113,0.06)",
        }}
      >
        <div style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>
          Keyword Tool unavailable: {err}
        </div>
        <div style={{ fontSize: 12, color: "var(--v2-text-2)", marginTop: 8 }}>
          Could not establish single sign-on connection with the Keyword Tool
          backend.
        </div>
        <div style={{ marginTop: 12 }}>
          <V2Button variant="accent" onClick={fetchUrl}>
            Retry Connection
          </V2Button>
        </div>
      </div>
    );
  }

  if (integration === "disabled" || integration === "unconfigured") {
    return (
      <div style={{ padding: 24, color: "var(--v2-text-2)", fontSize: 14 }}>
        {integration === "disabled"
          ? "Keyword Tool is switched off for this workspace."
          : "Keyword Tool has not been connected yet."}{" "}
        Your administrator can connect the existing board. Tutorial preparation
        remains available.
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ padding: 24, color: "var(--v2-text-2)", fontSize: 13 }}>
        Loading Keyword Tool board…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Admin Control Bar for iframe */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 14px",
          background: "var(--v2-surface-2)",
          borderRadius: 8,
          border: "1px solid var(--v2-border-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{ fontSize: 13, fontWeight: 700, color: "var(--v2-text-1)" }}
          >
            Keyword Tool: {view === "admin" ? "Admin console" : "VA board"}
          </span>
          {canAdmin && (
            <div
              role="group"
              aria-label="Keyword Tool view"
              style={{ display: "flex", gap: 4, marginLeft: 8 }}
            >
              <V2Button
                variant={view === "board" ? "accent" : "outline"}
                size="sm"
                onClick={() => switchView("board")}
              >
                VA board
              </V2Button>
              <V2Button
                variant={view === "admin" ? "accent" : "outline"}
                size="sm"
                disabled={!ssoReady}
                title={
                  ssoReady
                    ? "Open the complete Keyword Tool admin console"
                    : "Establishing Keyword Tool sign-in…"
                }
                onClick={() => switchView("admin")}
              >
                Admin console
              </V2Button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <V2Button variant="outline" size="sm" onClick={handleRefresh}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              refresh
            </span>
            Reload Iframe
          </V2Button>

          <V2Button variant="outline" size="sm" onClick={handleOpenExternal}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              open_in_new
            </span>
            Open in New Tab
          </V2Button>

          <V2Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              {isFullscreen ? "fullscreen_exit" : "fullscreen"}
            </span>
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </V2Button>
        </div>
      </div>

      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={url}
        onLoad={() => setSsoReady(true)}
        title="Keyword Tool board"
        style={{
          width: "100%",
          height: isFullscreen ? "90vh" : "calc(100vh - 250px)",
          minHeight: isFullscreen ? 800 : 650,
          border: "1px solid var(--v2-border-1)",
          borderRadius: 12,
          background: "var(--v2-surface-1)",
        }}
      />
    </div>
  );
}

export function ProductionKeywords({
  channels,
}: {
  channels: Array<{ id: string; name: string; language: string }>;
}) {
  const [section, setSection] = useState<"tool" | "import">("tool");
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>
          Keyword intake
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--v2-text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Claim researched topics on the board, or send an approved list
          directly to Studio. Claimed topics keep their identity through script,
          recording, review, and completion; board updates retry automatically
          if the integration is offline.
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Keyword intake method"
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          width: "fit-content",
          border: "1px solid var(--v2-border-1)",
          borderRadius: 10,
          background: "var(--v2-surface-2)",
        }}
      >
        <button
          id="keyword-tool-tab"
          role="tab"
          aria-controls="keyword-tool-panel"
          aria-selected={section === "tool"}
          tabIndex={section === "tool" ? 0 : -1}
          type="button"
          onClick={() => setSection("tool")}
          onKeyDown={(event) => {
            if (!["ArrowRight", "End"].includes(event.key)) return;
            event.preventDefault();
            setSection("import");
            requestAnimationFrame(() =>
              document.getElementById("keyword-import-tab")?.focus(),
            );
          }}
          style={{
            minHeight: 44,
            padding: "8px 14px",
            border: 0,
            borderRadius: 7,
            background: section === "tool" ? "var(--v2-accent)" : "transparent",
            color:
              section === "tool"
                ? "var(--v2-on-accent, #081018)"
                : "var(--v2-text-2)",
            fontWeight: 750,
            cursor: "pointer",
          }}
        >
          Research board
        </button>
        <button
          id="keyword-import-tab"
          role="tab"
          aria-controls="keyword-import-panel"
          aria-selected={section === "import"}
          tabIndex={section === "import" ? 0 : -1}
          type="button"
          onClick={() => setSection("import")}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "Home"].includes(event.key)) return;
            event.preventDefault();
            setSection("tool");
            requestAnimationFrame(() =>
              document.getElementById("keyword-tool-tab")?.focus(),
            );
          }}
          style={{
            minHeight: 44,
            padding: "8px 14px",
            border: 0,
            borderRadius: 7,
            background:
              section === "import" ? "var(--v2-accent)" : "transparent",
            color:
              section === "import"
                ? "var(--v2-on-accent, #081018)"
                : "var(--v2-text-2)",
            fontWeight: 750,
            cursor: "pointer",
          }}
        >
          Direct intake
        </button>
      </div>
      <div
        id={section === "tool" ? "keyword-tool-panel" : "keyword-import-panel"}
        role="tabpanel"
        aria-labelledby={
          section === "tool" ? "keyword-tool-tab" : "keyword-import-tab"
        }
      >
        {section === "tool" ? (
          <KeywordToolPanel />
        ) : (
          <KeywordDirectIntake channels={channels} />
        )}
      </div>
    </div>
  );
}
