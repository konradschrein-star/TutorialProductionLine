"use client";

import { useState, useCallback } from "react";
import { SectionFormWrapper } from "../section-form-wrapper";
import { SettingRow, SettingInput } from "../setting-field";
import { StorageSettingsSchema, type StorageSettings } from "@repo/contracts";
import { DriveArchiveCard } from "./drive-archive-card";

interface StorageSectionProps {
  initialData: unknown;
  storageStat?: {
    ok: boolean;
    totalBytes?: number;
    freeBytes?: number;
    usedBytes?: number;
    error?: string;
  };
}

const GIB = 1024 * 1024 * 1024;

function fmtBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "unavailable";
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${n} B`;
}

export function StorageSection({
  initialData,
  storageStat,
}: StorageSectionProps) {
  const [state, setState] = useState<StorageSettings>(() =>
    StorageSettingsSchema.parse(initialData ?? {}),
  );

  // Edit in GB; persist in bytes.
  const gb = Math.round((state.maxUploadBytes / GIB) * 10) / 10;

  const getData = useCallback(() => state, [state]);

  return (
    <SectionFormWrapper
      sectionId="storage"
      title="Storage"
      description="Asset retention and max upload size (in bytes, shown as GB)."
      icon="hard_drive"
      wiring="live"
      wiringDetail="Persists to system_settings.storage. maxUploadBytes is enforced by upload routes (throws with the actual size + the limit). Disk figures are read live from the artifact root."
      getData={getData}
    >
      {/* Live disk truth — never a fabricated zero (§3.4). */}
      <div
        style={{
          fontSize: 11.5,
          color: "var(--v2-text-2)",
          padding: "8px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 8,
        }}
      >
        {storageStat?.ok ? (
          <span>
            Disk: {fmtBytes(storageStat.freeBytes)} free of{" "}
            {fmtBytes(storageStat.totalBytes)} (
            {fmtBytes(storageStat.usedBytes)} used)
          </span>
        ) : (
          <span style={{ color: "var(--v2-danger, #e57373)" }}>
            Disk usage unavailable
            {storageStat?.error ? `: ${storageStat.error}` : ""}
          </span>
        )}
      </div>

      <SettingRow
        label="Retention"
        hint="Days before generated assets are eligible for cleanup"
        htmlFor="retentionDays"
        controlWidth={110}
      >
        <SettingInput
          id="retentionDays"
          type="number"
          min={1}
          max={3650}
          value={state.retentionDays}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              retentionDays: parseInt(e.target.value, 10) || 90,
            }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Max upload size"
        hint="Gigabytes per uploaded file (long videos exceed 10 GB)"
        htmlFor="maxUploadGb"
        controlWidth={110}
      >
        <SettingInput
          id="maxUploadGb"
          type="number"
          min={1}
          max={1024}
          value={gb}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              maxUploadBytes: Math.max(
                1,
                Math.round((parseFloat(e.target.value) || 50) * GIB),
              ),
            }))
          }
        />
      </SettingRow>

      <DriveArchiveCard />
    </SectionFormWrapper>
  );
}
