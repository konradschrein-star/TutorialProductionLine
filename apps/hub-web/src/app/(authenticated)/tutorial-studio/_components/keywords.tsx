"use client";

import { useEffect, useState } from "react";
import { V2Button } from "../../_components";
import { InitialKeywords } from "./initial-keywords";

/**
 * Keywords tab. Two sub-views:
 *
 *   • "Keyword Tool" — the live board (Video ERP), embedded by iframe over a
 *     short-lived SSO handoff. The rich, authoritative tool.
 *   • "Initial Keywords" — a hub-web-native fallback list of the ~2,150
 *     guide-realm keywords from the previous tool, stored in this app's own DB.
 *     It works even when the Keyword Tool is down, so the VA is never blocked.
 *
 * If the iframe handoff fails, we say so and point at the fallback rather than
 * leaving a dead panel.
 */

type SubTab = "tool" | "initial";

export interface ProductionKeywordsProps {
  /** Load a seed keyword into Create and switch to that tab. */
  onUseSeed: (seed: { id: number; title: string }) => void;
}

export function ProductionKeywords({ onUseSeed }: ProductionKeywordsProps) {
  const [sub, setSub] = useState<SubTab>("tool");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <V2Button
          variant={sub === "tool" ? "accent" : "outline"}
          onClick={() => setSub("tool")}
        >
          Keyword Tool
        </V2Button>
        <V2Button
          variant={sub === "initial" ? "accent" : "outline"}
          onClick={() => setSub("initial")}
        >
          Initial Keywords
        </V2Button>
      </div>

      {sub === "tool" ? (
        <KeywordToolFrame onUseFallback={() => setSub("initial")} />
      ) : (
        <InitialKeywords onUseSeed={onUseSeed} />
      )}
    </div>
  );
}

/**
 * The embedded Keyword Tool board. Fetches a short-lived SSO handoff URL and
 * iframes it; the Keyword Tool authenticates the viewer from the handoff token.
 */
function KeywordToolFrame({ onUseFallback }: { onUseFallback: () => void }) {
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
          You can still work from the saved starter set — it lives inside this
          app and does not need the Keyword Tool.
        </div>
        <div style={{ marginTop: 12 }}>
          <V2Button variant="accent" onClick={onUseFallback}>
            Use Initial Keywords
          </V2Button>
        </div>
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
        height: "calc(100vh - 210px)",
        minHeight: 600,
        border: "1px solid var(--v2-border, #222)",
        borderRadius: 12,
        background: "#0a0a0a",
      }}
    />
  );
}
