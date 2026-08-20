"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Shared V2-styled primitives for the music library.
 *
 * Kept local to the music module rather than pushed into a global component
 * set, so this work does not collide with other pages being reworked.
 */

export const TEXT = "#e5e2e1";
export const TEXT_DIM = "#cdc3d7";
export const TEXT_FAINT = "rgba(205,195,215,0.55)";

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
  borderRadius: 8,
  color: TEXT,
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

export function Label({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: TEXT_FAINT,
        marginBottom: 6,
      }}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <Label>{label}</Label>
      {children}
      {hint && (
        <span
          style={{
            display: "block",
            fontSize: 10,
            color: TEXT_FAINT,
            marginTop: 4,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color: color ?? "inherit", ...style }}
    >
      {name}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  style?: CSSProperties;
}) {
  const palette =
    variant === "primary"
      ? {
          background: disabled
            ? "rgba(var(--v2-accent-rgb), 0.25)"
            : "var(--v2-accent)",
          border: "none",
          color: "#000",
        }
      : variant === "danger"
        ? {
            background: "rgba(255,80,80,0.12)",
            border: "1px solid rgba(255,80,80,0.3)",
            color: "#ff8080",
          }
        : {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
            color: TEXT,
          };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "all 0.15s ease",
        ...palette,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/**
 * V2 select. Native <select> option lists render as unstyled grey-on-white on
 * this stack, so options get an explicit dark background here.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer" }}
    >
      {placeholder !== undefined && (
        <option value="" style={{ background: "#191622", color: TEXT }}>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option
          key={o.value}
          value={o.value}
          style={{ background: "#191622", color: TEXT }}
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Pill({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "ok";
  title?: string;
}) {
  const tones: Record<string, CSSProperties> = {
    neutral: {
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
      color: TEXT_DIM,
    },
    accent: {
      background: "rgba(var(--v2-accent-rgb), 0.15)",
      border: "1px solid rgba(var(--v2-accent-rgb), 0.35)",
      color: "var(--v2-accent)",
    },
    ok: {
      background: "rgba(80,220,150,0.12)",
      border: "1px solid rgba(80,220,150,0.3)",
      color: "#6ee7b7",
    },
    warn: {
      background: "rgba(255,200,80,0.12)",
      border: "1px solid rgba(255,200,80,0.3)",
      color: "#fcd34d",
    },
    danger: {
      background: "rgba(255,80,80,0.12)",
      border: "1px solid rgba(255,80,80,0.3)",
      color: "#ff8080",
    },
  };

  return (
    <span
      title={title}
      style={{
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}

/** Inline error banner. Errors are shown, never swallowed into a console log. */
export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: "rgba(255,80,80,0.08)",
        border: "1px solid rgba(255,80,80,0.28)",
        borderRadius: 8,
      }}
    >
      <Icon name="error" size={16} color="#ff8080" style={{ marginTop: 1 }} />
      <span style={{ flex: 1, fontSize: 12, color: "#ffb3b3" }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            color: "#ff8080",
            cursor: "pointer",
            padding: 0,
            display: "flex",
          }}
          aria-label="Dismiss"
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "36px 20px",
        textAlign: "center",
      }}
    >
      <Icon name={icon} size={32} style={{ opacity: 0.3, color: TEXT_DIM }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>
        {title}
      </span>
      {detail && (
        <span style={{ fontSize: 11, color: TEXT_FAINT, maxWidth: 460 }}>
          {detail}
        </span>
      )}
    </div>
  );
}
