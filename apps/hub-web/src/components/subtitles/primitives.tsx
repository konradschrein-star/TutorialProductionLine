"use client";
// Small V2-styled form primitives shared by every subtitle control group.
// Inline styles only (project V2 standard) — no Tailwind, no className styling.

import React, { useState } from "react";
import { V2Listbox } from "../thumbnails/v2-listbox";

const LABEL = { fontSize: 12, color: "#cdc3d7" } as const;
export const INPUT_BG = "rgba(255,255,255,0.05)";
export const INPUT_BORDER = "1px solid rgba(var(--v2-accent-rgb),0.2)";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ ...LABEL, display: "block" }}>{label}</label>
      {children}
      {hint && (
        <span style={{ fontSize: 10, color: "rgba(205,195,215,0.6)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={LABEL}>{label}</span>
        <span
          style={{ fontSize: 12, color: "var(--v2-accent)", fontWeight: 600 }}
        >
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--v2-accent)" }}
      />
    </label>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
  disabled,
  allowNull,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  allowNull?: boolean;
}) {
  const enabled = value != null;
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={LABEL}>{label}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {allowNull && (
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? "#000000" : null)}
            title="Enable"
          />
        )}
        <input
          type="color"
          value={(value ?? "#000000").slice(0, 7)}
          disabled={disabled || (allowNull && !enabled)}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 28,
            height: 28,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        />
        <input
          type="text"
          value={value ?? ""}
          disabled={disabled || (allowNull && !enabled)}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 90,
            background: INPUT_BG,
            border: INPUT_BORDER,
            borderRadius: 4,
            color: "#e5e2e1",
            fontSize: 11,
            padding: "3px 6px",
          }}
        />
      </div>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={LABEL}>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label && <span style={LABEL}>{label}</span>}
      <div
        style={{
          display: "flex",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 8,
          padding: 3,
          gap: 2,
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.title}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "none",
                cursor: disabled ? "default" : "pointer",
                fontSize: 11,
                fontWeight: 600,
                background: active ? "var(--v2-accent)" : "transparent",
                color: active ? "#fff" : "#cdc3d7",
                transition: "all 0.15s",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Built on V2Listbox — never a native <select> (project §0). The native control
// renders its option popup with the OS widget, which on Windows Chrome is
// unstyleable (dark-grey-on-white) and cannot preview a per-option font-family.
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  options: { value: T; label: string; fontFamily?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const content = (
    <V2Listbox
      value={value}
      disabled={disabled}
      onChange={(v) => onChange(v as T)}
      options={options.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.fontFamily ? { fontFamily: o.fontFamily } : {}),
      }))}
    />
  );
  if (!label) return content;
  return <Field label={label}>{content}</Field>;
}

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.1)" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          padding: "12px 0",
          background: "none",
          border: "none",
          color: "#e5e2e1",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {title}
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 16, color: "var(--v2-accent)" }}
        >
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div
          style={{
            paddingBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FontFamilySelect — the shared font-family dropdown used by every subtitle
// control group (primary font, secondary font, ffmpeg font). Renders a
// "__system__" sentinel plus one option per uploaded font (each previewed in
// its own family) and encapsulates the id -> family lookup in its onChange.
// ---------------------------------------------------------------------------

interface FontOption {
  id: string;
  name: string;
}

const SYSTEM_SENTINEL = "__system__";

export function FontFamilySelect({
  label = "Font Family",
  fonts,
  valueFontId,
  valueFontFamily,
  onChange,
  disabled,
}: {
  label?: string;
  fonts: FontOption[];
  valueFontId: string | null;
  valueFontFamily: string;
  onChange: (next: { fontId: string | null; fontFamily: string }) => void;
  disabled?: boolean;
}) {
  // V2Listbox (not a native <select>): its rows are real DOM, so each font
  // option can finally preview in its own typeface — the whole point of a font
  // picker, which a native <option> cannot do reliably on Windows Chrome.
  const content = (
    <V2Listbox
      value={valueFontId ?? SYSTEM_SENTINEL}
      disabled={disabled}
      searchable={fonts.length > 6}
      onChange={(v) => {
        if (v === SYSTEM_SENTINEL) {
          onChange({ fontId: null, fontFamily: valueFontFamily });
        } else {
          const font = fonts.find((f) => f.id === v);
          onChange({ fontId: v, fontFamily: font?.name ?? valueFontFamily });
        }
      }}
      options={[
        {
          value: SYSTEM_SENTINEL,
          label: `System: ${valueFontFamily}`,
          fontFamily: valueFontFamily,
        },
        ...fonts.map((f) => ({
          value: f.id,
          label: f.name,
          fontFamily: f.name,
        })),
      ]}
    />
  );
  if (!label) return content;
  return <Field label={label}>{content}</Field>;
}
