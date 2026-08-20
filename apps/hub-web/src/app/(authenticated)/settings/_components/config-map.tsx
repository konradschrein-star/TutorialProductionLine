"use client";

import { useState } from "react";
import { GlassCard } from "../../_components/glass-card";

/**
 * Where configuration actually lives.
 *
 * Settings used to be a dead end: /settings/voices was reachable from exactly
 * one link buried in the CASUALLY_EXPLAINED job form, and nothing pointed at
 * System Health. Counts are read from the database — a tile shows no count
 * rather than a made-up one if the query fails.
 */

export interface ConfigTile {
  label: string;
  href: string;
  icon: string;
  /** Real, DB-derived. null = we could not read it; render nothing. */
  count: number | null;
  countLabel: string;
  hint: string;
  /** Visually promotes the System Health tile. */
  primary?: boolean;
}

export function ConfigMap({ tiles }: { tiles: ConfigTile[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <GlassCard
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "#e5e2e1",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          Where configuration lives
        </h2>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "3px 0 0",
          }}
        >
          The real knobs are on these pages. Counts are live from the database.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
        {tiles.map((tile) => {
          const isHovered = hovered === tile.href;
          const accentBorder = tile.primary
            ? "rgba(var(--v2-accent-rgb), 0.35)"
            : "rgba(75,68,85,0.3)";
          return (
            <a
              key={tile.href}
              href={tile.href}
              onMouseEnter={() => setHovered(tile.href)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "10px 12px",
                borderRadius: 9,
                textDecoration: "none",
                background: isHovered
                  ? "rgba(var(--v2-accent-rgb), 0.09)"
                  : tile.primary
                    ? "rgba(var(--v2-accent-rgb), 0.05)"
                    : "rgba(255,255,255,0.03)",
                border: `1px solid ${isHovered ? "rgba(var(--v2-accent-rgb), 0.4)" : accentBorder}`,
                transition: "background 0.12s, border-color 0.12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 17,
                    color:
                      tile.primary || isHovered
                        ? "var(--v2-accent)"
                        : "rgba(205,195,215,0.55)",
                  }}
                >
                  {tile.icon}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tile.label}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                {tile.count !== null ? (
                  <>
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 900,
                        color: "#e5e2e1",
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {tile.count}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "rgba(205,195,215,0.45)",
                      }}
                    >
                      {tile.countLabel}
                    </span>
                  </>
                ) : (
                  <span
                    style={{ fontSize: 10.5, color: "rgba(205,195,215,0.35)" }}
                  >
                    {tile.hint}
                  </span>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </GlassCard>
  );
}
