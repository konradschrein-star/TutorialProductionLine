"use client";

/**
 * Wiring chip — states plainly whether a setting actually does anything.
 *
 * Audited 2026-07-28 by grepping every field name in `system_settings` across
 * apps/ and packages/. Every field below appears ONLY in the Zod schema and in
 * this form. No worker, renderer or auth path reads them, and the production
 * singleton row is NULL in every column. Rather than quietly implying these
 * knobs control the pipeline, each section says which it is.
 */

export type WiringState = "live" | "stored";

const STYLES: Record<
  WiringState,
  { fg: string; bg: string; bd: string; icon: string; label: string }
> = {
  live: {
    fg: "var(--v2-accent)",
    bg: "rgba(var(--v2-accent-rgb), 0.10)",
    bd: "rgba(var(--v2-accent-rgb), 0.28)",
    icon: "bolt",
    label: "Live",
  },
  stored: {
    fg: "#f9a825",
    bg: "rgba(249,168,37,0.08)",
    bd: "rgba(249,168,37,0.25)",
    icon: "database",
    label: "Stored only",
  },
};

interface WiringChipProps {
  state: WiringState;
  /** Shown on hover — what reads it, or what would have to be built. */
  detail: string;
}

export function WiringChip({ state, detail }: WiringChipProps) {
  const s = STYLES[state];
  return (
    <span
      title={detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 5,
        background: s.bg,
        border: `1px solid ${s.bd}`,
        color: s.fg,
        fontSize: 9.5,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}
