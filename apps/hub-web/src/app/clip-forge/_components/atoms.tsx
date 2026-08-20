"use client";

import { statusMeta, personaMeta } from "../_lib/display";

export function StatusPill({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        color: m.color,
        background: m.bg,
        padding: "2px 7px",
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

export function PersonaChip({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  const m = personaMeta(name);
  const fs = size <= 18 ? 8 : size <= 22 ? 9 : 12;
  return (
    <span
      title={name}
      style={{
        flex: "0 0 auto",
        width: size,
        height: size,
        borderRadius: 4,
        background: m.bg,
        border: `1px solid ${m.color}`,
        color: m.color,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: fs,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {m.initials}
    </span>
  );
}

export function Card({
  children,
  style,
  pad = 13,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid #1d232a",
        borderRadius: 7,
        background: "#0e1217",
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: ".1em",
        color: "#59616a",
        fontFamily: "'IBM Plex Mono', monospace",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

export function Mono({
  children,
  size = 11,
  color = "#cfd4da",
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: size,
        color,
      }}
    >
      {children}
    </span>
  );
}
