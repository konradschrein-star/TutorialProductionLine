"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { V2Button } from "../../_components";

/**
 * Keywords tab: Directly embeds the authoritative Keyword Tool board (Video ERP)
 * with complete Admin iframe controls.
 */

export function ProductionKeywords() {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
        setUrl(d.url as string);
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
          Keyword Tool unavailable — {err}
        </div>
        <div style={{ fontSize: 12, color: "var(--v2-text-2)", marginTop: 8 }}>
          Could not establish single sign-on connection with the Keyword Tool backend.
        </div>
        <div style={{ marginTop: 12 }}>
          <V2Button variant="accent" onClick={fetchUrl}>
            Retry Connection
          </V2Button>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ padding: 24, color: "#888", fontSize: 13 }}>
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
          background: "rgba(255,255,255,0.03)",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 8px #4ade80",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
            Keyword Tool (Video ERP)
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <V2Button variant="outline" size="sm" onClick={handleRefresh}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              refresh
            </span>
            Reload Iframe
          </V2Button>

          <V2Button variant="outline" size="sm" onClick={handleOpenExternal}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              open_in_new
            </span>
            Open in New Tab
          </V2Button>

          <V2Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
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
        title="Keyword Tool board"
        style={{
          width: "100%",
          height: isFullscreen ? "90vh" : "calc(100vh - 250px)",
          minHeight: isFullscreen ? 800 : 650,
          border: "1px solid var(--v2-border, #222)",
          borderRadius: 12,
          background: "#0a0a0a",
        }}
      />
    </div>
  );
}
