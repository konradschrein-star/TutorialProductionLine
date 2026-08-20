"use client";

import { useEffect, useState } from "react";

/**
 * Keywords tab — embeds the Keyword Tool board (Video ERP). It fetches a
 * short-lived SSO handoff URL and iframes it; the Keyword Tool authenticates the
 * viewer from the handoff token, so VAs stay inside the Hub.
 */
export function ProductionKeywords() {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled) setUrl(d.url as string);
      })
      .catch((e) => {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load keywords");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div style={{ padding: 24, color: "#f87171", fontSize: 13 }}>
        Keyword Tool unavailable — {err}
      </div>
    );
  }
  if (!url) {
    return (
      <div style={{ padding: 24, color: "#888", fontSize: 13 }}>
        Loading keyword board…
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title="Keyword Tool board"
      style={{
        width: "100%",
        height: "calc(100vh - 170px)",
        minHeight: 600,
        border: "1px solid var(--v2-border, #222)",
        borderRadius: 12,
        background: "#0a0a0a",
      }}
    />
  );
}
