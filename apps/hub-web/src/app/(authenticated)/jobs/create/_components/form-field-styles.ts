// apps/hub-web/src/app/(authenticated)/jobs/create/_components/form-field-styles.ts
import type { CSSProperties } from "react";

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(205,195,215,0.6)",
  marginBottom: 6,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
  borderRadius: 8,
  color: "#e5e2e1",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.6,
  fontFamily: "inherit",
};

export const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const fieldGroupStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};
