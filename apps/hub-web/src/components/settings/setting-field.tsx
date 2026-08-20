"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * V2 settings form primitives.
 *
 * Inline styles only (see .claude/CLAUDE.md) — no Tailwind, no lucide.
 * The layout is deliberately dense: label and control share a row so a
 * section card holds five or six real settings instead of two.
 */

const LABEL_COLOR = "#e5e2e1";
const HINT_COLOR = "rgba(205,195,215,0.5)";

// ── Row: label left, control right ──────────────────────────────────────────

interface SettingRowProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  /** Width of the control column. Default 180px. */
  controlWidth?: number | string;
  /** Put the control on its own line below the label (for wide controls). */
  stacked?: boolean;
}

export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  controlWidth = 180,
  stacked = false,
}: SettingRowProps) {
  if (stacked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor={htmlFor}
          style={{ fontSize: 12, fontWeight: 600, color: LABEL_COLOR }}
        >
          {label}
        </label>
        {hint && (
          <p style={{ fontSize: 11, color: HINT_COLOR, margin: 0 }}>{hint}</p>
        )}
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <label
          htmlFor={htmlFor}
          style={{ fontSize: 12, fontWeight: 600, color: LABEL_COLOR }}
        >
          {label}
        </label>
        {hint && (
          <p
            style={{
              fontSize: 11,
              color: HINT_COLOR,
              margin: "2px 0 0",
              lineHeight: 1.4,
            }}
          >
            {hint}
          </p>
        )}
      </div>
      <div style={{ width: controlWidth, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/**
 * Legacy stacked field, kept because a few callers still use the old shape.
 */
interface SettingFieldProps {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
}

export function SettingField({
  label,
  description,
  htmlFor,
  children,
  error,
}: SettingFieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12, fontWeight: 600, color: LABEL_COLOR }}
      >
        {label}
      </label>
      {description && (
        <p
          style={{
            fontSize: 11,
            color: HINT_COLOR,
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {description}
        </p>
      )}
      {children}
      {error && (
        <p style={{ fontSize: 11, color: "#ffb4ab", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

const CONTROL_BASE: CSSProperties = {
  padding: "7px 10px",
  background: "#111",
  border: "1px solid rgba(75,68,85,0.45)",
  borderRadius: 7,
  color: "#e5e2e1",
  fontSize: 12.5,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  // Makes the native dropdown/spinners render dark instead of the
  // light-grey-on-white default Konrad complained about.
  colorScheme: "dark",
};

interface SettingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function SettingInput({ error, style, ...props }: SettingInputProps) {
  return (
    <input
      {...props}
      style={{
        ...CONTROL_BASE,
        border: `1px solid ${error ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.45)"}`,
        ...style,
      }}
    />
  );
}

interface SettingSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  error?: boolean;
}

export function SettingSelect({
  options,
  error,
  style,
  ...props
}: SettingSelectProps) {
  return (
    <select
      {...props}
      style={{
        ...CONTROL_BASE,
        border: `1px solid ${error ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.45)"}`,
        cursor: "pointer",
        ...style,
      }}
    >
      {options.map((opt) => (
        <option
          key={opt.value}
          value={opt.value}
          style={{ background: "#111", color: "#e5e2e1" }}
        >
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ── Small chrome ────────────────────────────────────────────────────────────

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "rgba(205,195,215,0.45)",
        textTransform: "uppercase",
        letterSpacing: "0.09em",
        margin: "4px 0 0",
      }}
    >
      {children}
    </p>
  );
}

export function GhostButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 7,
        cursor: "pointer",
        background: danger
          ? "rgba(255,180,171,0.08)"
          : "rgba(var(--v2-accent-rgb), 0.08)",
        border: `1px solid ${danger ? "rgba(255,180,171,0.3)" : "rgba(var(--v2-accent-rgb), 0.25)"}`,
        color: danger ? "#ffb4ab" : "var(--v2-accent)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
