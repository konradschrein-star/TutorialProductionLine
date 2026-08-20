"use client";

import { useRef, useState } from "react";
import { showToast } from "@/components/layout/toast";
import { updateSettingsSection } from "@/app/actions/settings";
import type { SettingsSectionId } from "@repo/contracts";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import { WiringChip, type WiringState } from "./wiring-chip";

/**
 * One settings section = one card that saves itself.
 *
 * Save is disabled until something actually changed, so the button state is
 * information rather than decoration. After a successful save the current
 * values become the new baseline.
 */

interface SectionFormWrapperProps {
  sectionId: SettingsSectionId;
  title: string;
  description: string;
  icon: string;
  wiring: WiringState;
  wiringDetail: string;
  children: React.ReactNode;
  getData: () => unknown;
  /** Let a section span the full grid width. */
  span?: boolean;
}

export function SectionFormWrapper({
  sectionId,
  title,
  description,
  icon,
  wiring,
  wiringDetail,
  children,
  getData,
  span = false,
}: SectionFormWrapperProps) {
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef<string | null>(null);

  // getData() is pure (it just reads section state), so calling it during
  // render to compute dirtiness is safe and avoids an extra state mirror.
  const current = JSON.stringify(getData() ?? null);
  if (baselineRef.current === null) baselineRef.current = current;
  const dirty = current !== baselineRef.current;

  async function handleSave() {
    setSaving(true);
    const snapshot = JSON.stringify(getData() ?? null);
    try {
      const result = await updateSettingsSection(sectionId, getData());
      if (result.success) {
        baselineRef.current = snapshot;
        showToast("success", `${title} saved`);
      } else {
        showToast("error", result.error || `Could not save ${title}`);
      }
    } catch {
      showToast("error", `Could not save ${title} — unexpected error`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        gridColumn: span ? "1 / -1" : undefined,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: "var(--v2-accent)",
            marginTop: 1,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h3
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
              }}
            >
              {title}
            </h3>
            <WiringChip state={wiring} detail={wiringDetail} />
          </div>
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              margin: "3px 0 0",
              lineHeight: 1.4,
            }}
          >
            {description}
          </p>
        </div>
      </div>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>

      {/* Save */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(75,68,85,0.25)",
        }}
      >
        {dirty && !saving && (
          <span style={{ fontSize: 10.5, color: "#f9a825", fontWeight: 700 }}>
            Unsaved changes
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: "6px 14px",
            fontSize: 11.5,
            fontWeight: 800,
            borderRadius: 7,
            cursor: saving || !dirty ? "default" : "pointer",
            background: dirty
              ? "rgba(var(--v2-accent-rgb), 0.14)"
              : "rgba(255,255,255,0.03)",
            border: `1px solid ${dirty ? "rgba(var(--v2-accent-rgb), 0.35)" : "rgba(75,68,85,0.3)"}`,
            color: dirty ? "var(--v2-accent)" : "rgba(205,195,215,0.35)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {saving && (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, animation: "spin 1s linear infinite" }}
            >
              progress_activity
            </span>
          )}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </GlassCard>
  );
}
