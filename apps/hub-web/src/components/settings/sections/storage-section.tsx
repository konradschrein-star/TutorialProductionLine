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
  canManageCredentials?: boolean;
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
  canManageCredentials = false,
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
      description="Keep source files safe until the exact revision has a verified Drive copy. YouTube delivery and Drive preservation are separate checks."
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
        label="Fallback retention (days)"
        hint="Age threshold only, not permission to delete. Tutorial cleanup must also have verified publication and exact Drive proof; changing this does not clean files now."
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
        label="Maximum incoming file (GiB)"
        hint="1 GiB = 1,073,741,824 bytes. This limits files submitted to Studio, not the number of YouTube uploads."
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

      <div
        style={{
          marginTop: 10,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,.08)",
        }}
      >
        <div
          style={{ fontSize: 12, fontWeight: 800, color: "var(--v2-text-1)" }}
        >
          Google Drive delivery
        </div>
        <div
          style={{ fontSize: 10.5, color: "var(--v2-text-2)", marginTop: 3 }}
        >
          Credentials are managed above. These controls are read by the Drive
          worker without editing files.
        </div>
      </div>

      <SettingRow
        label="Automatic delivery"
        hint="Copy approved bundles to Drive"
        htmlFor="driveEnabled"
        controlWidth={70}
      >
        <input
          id="driveEnabled"
          type="checkbox"
          checked={state.driveEnabled}
          onChange={(e) =>
            setState((s) => ({ ...s, driveEnabled: e.target.checked }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Other formats' Drive root"
        hint="Legacy shared-format folder name. Tutorial archives use the separate tutorials folder below; this does not relocate existing files."
        htmlFor="driveRootFolderName"
        controlWidth={200}
      >
        <SettingInput
          id="driveRootFolderName"
          value={state.driveRootFolderName}
          onChange={(e) =>
            setState((s) => ({ ...s, driveRootFolderName: e.target.value }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Tutorial archive folder name"
        hint="Separate top-level tutorial tree, not a folder inside the other formats' root. Existing verified folder IDs remain unchanged; an installation-specific move needs a reviewed migration."
        htmlFor="driveTutorialsFolderName"
        controlWidth={200}
      >
        <SettingInput
          id="driveTutorialsFolderName"
          value={state.driveTutorialsFolderName}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              driveTutorialsFolderName: e.target.value,
            }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Delivery scan"
        hint="How often the worker checks for approved work"
        htmlFor="driveScanIntervalMinutes"
        controlWidth={120}
      >
        <SettingInput
          id="driveScanIntervalMinutes"
          type="number"
          min={1}
          max={1440}
          value={state.driveScanIntervalMinutes}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              driveScanIntervalMinutes: Number(e.target.value) || 5,
            }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Jobs per pass"
        hint="Limits each Drive scan"
        htmlFor="driveBatchSize"
        controlWidth={120}
      >
        <SettingInput
          id="driveBatchSize"
          type="number"
          min={1}
          max={50}
          value={state.driveBatchSize}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              driveBatchSize: Number(e.target.value) || 5,
            }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Daily Drive budget"
        hint="GB per day; leaves room below Google's ceiling"
        htmlFor="driveDailyBudgetGb"
        controlWidth={120}
      >
        <SettingInput
          id="driveDailyBudgetGb"
          type="number"
          min={1}
          max={740}
          value={state.driveDailyBudgetGb}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              driveDailyBudgetGb: Number(e.target.value) || 500,
            }))
          }
        />
      </SettingRow>

      <DriveArchiveCard canManage={canManageCredentials} />
    </SectionFormWrapper>
  );
}
