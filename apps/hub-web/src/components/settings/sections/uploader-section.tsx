"use client";

import { useCallback, useState } from "react";
import { UploaderSettingsSchema, type UploaderSettings } from "@repo/contracts";
import { SectionFormWrapper } from "../section-form-wrapper";
import { SettingInput, SettingRow } from "../setting-field";

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,.12)",
  background: "var(--v2-surface-2)",
  color: "var(--v2-text-1)",
  fontSize: 12,
};

export function UploaderSection({
  initialData,
  canEdit,
}: {
  initialData: unknown;
  canEdit: boolean;
}) {
  const [state, setState] = useState<UploaderSettings>(() =>
    UploaderSettingsSchema.parse(initialData ?? {}),
  );
  const [confirm, setConfirm] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const getData = useCallback(() => state, [state]);
  const liveUnlocked = confirm.trim().toUpperCase() === "ENABLE LIVE UPLOADS";

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/health/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "uploader" }),
      });
      const json = (await response.json()) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      setTestResult({
        ok: Boolean(json.ok),
        text: json.detail ?? json.error ?? `HTTP ${response.status}`,
      });
    } catch (error) {
      setTestResult({
        ok: false,
        text: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <SectionFormWrapper
      sectionId="uploader"
      title="YouTube uploader"
      description="Configure the separate distribution worker. Saving this panel never starts an upload."
      icon="publish"
      wiring="live"
      wiringDetail="The uploader reads this configuration through the authenticated runtime-config endpoint. Dry-run is the safe default."
      getData={getData}
    >
      <div
        style={{
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${state.executionMode === "dry_run" ? "rgba(230,179,74,.35)" : "rgba(224,96,94,.45)"}`,
          background:
            state.executionMode === "dry_run"
              ? "rgba(230,179,74,.07)"
              : "rgba(224,96,94,.08)",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: state.executionMode === "dry_run" ? "#e6b34a" : "#ff8b86",
          }}
        >
          {state.executionMode === "dry_run"
            ? "DRY RUN — no YouTube upload may be started"
            : "LIVE MODE — uploads may be started by the external worker"}
        </div>
        <div style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 4 }}>
          The Studio only prepares jobs and receives status callbacks. The
          uploader remains a separate process.
        </div>
      </div>

      <SettingRow
        label="Uploader enabled"
        hint="Allows the external worker to claim jobs"
        htmlFor="uploader-enabled"
        controlWidth={70}
      >
        <input
          id="uploader-enabled"
          type="checkbox"
          checked={state.enabled}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({ ...s, enabled: e.target.checked }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Execution mode"
        hint="Live mode requires an explicit confirmation phrase"
        stacked
      >
        <div style={{ display: "grid", gap: 8 }}>
          <select
            style={selectStyle}
            value={state.executionMode}
            disabled={!canEdit}
            onChange={(e) => {
              const next = e.target.value as "dry_run" | "live";
              setState((s) => ({
                ...s,
                executionMode:
                  next === "live" && !liveUnlocked ? "dry_run" : next,
              }));
            }}
          >
            <option value="dry_run">Dry run (recommended)</option>
            <option value="live" disabled={!liveUnlocked}>
              Live uploads
            </option>
          </select>
          <SettingInput
            value={confirm}
            disabled={!canEdit}
            placeholder="Type ENABLE LIVE UPLOADS to unlock"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </SettingRow>
      <SettingRow
        label="Upload method"
        hint="Official API is preferred; browser-assisted mode must remain operator-visible"
        htmlFor="uploader-transport"
        controlWidth={230}
      >
        <select
          id="uploader-transport"
          style={selectStyle}
          value={state.transport}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              transport: e.target.value as UploaderSettings["transport"],
            }))
          }
        >
          <option value="youtube_data_api">YouTube Data API</option>
          <option value="browser_assisted">Browser-assisted</option>
        </select>
      </SettingRow>
      <SettingRow
        label="Default visibility"
        htmlFor="uploader-visibility"
        controlWidth={180}
      >
        <select
          id="uploader-visibility"
          style={selectStyle}
          value={state.defaultVisibility}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              defaultVisibility: e.target
                .value as UploaderSettings["defaultVisibility"],
            }))
          }
        >
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </SettingRow>
      <SettingRow
        label="Timezone"
        hint="IANA name used for schedules"
        htmlFor="uploader-timezone"
        controlWidth={220}
      >
        <SettingInput
          id="uploader-timezone"
          value={state.timezone}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({ ...s, timezone: e.target.value }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Schedule lead"
        hint="Minimum minutes between job release and publish time"
        htmlFor="uploader-lead"
        controlWidth={110}
      >
        <SettingInput
          id="uploader-lead"
          type="number"
          min={15}
          max={43200}
          value={state.scheduleLeadMinutes}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              scheduleLeadMinutes: Number(e.target.value) || 120,
            }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Upload pacing"
        hint="One-at-a-time and conservative by default"
        stacked
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,minmax(120px,1fr))",
            gap: 8,
          }}
        >
          <label style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
            Concurrent
            <SettingInput
              type="number"
              min={1}
              max={3}
              value={state.maxConcurrentUploads}
              disabled={!canEdit}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  maxConcurrentUploads: Number(e.target.value) || 1,
                }))
              }
            />
          </label>
          <label style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
            Minutes apart
            <SettingInput
              type="number"
              min={1}
              max={1440}
              value={state.minMinutesBetweenStarts}
              disabled={!canEdit}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  minMinutesBetweenStarts: Number(e.target.value) || 10,
                }))
              }
            />
          </label>
          <label style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
            Daily maximum
            <SettingInput
              type="number"
              min={1}
              max={100}
              value={state.maxUploadsPerDay}
              disabled={!canEdit}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  maxUploadsPerDay: Number(e.target.value) || 20,
                }))
              }
            />
          </label>
        </div>
      </SettingRow>
      <SettingRow
        label="Dashboard API URL"
        hint="Private endpoint exposed by the uploader service"
        htmlFor="uploader-api"
        stacked
      >
        <SettingInput
          id="uploader-api"
          type="url"
          value={state.dashboardApiUrl}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({ ...s, dashboardApiUrl: e.target.value }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Operations page"
        hint="Where admins open uploader diagnostics"
        htmlFor="uploader-ops"
        stacked
      >
        <SettingInput
          id="uploader-ops"
          value={state.operationsUrl}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({ ...s, operationsUrl: e.target.value }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Callback URL"
        hint="Public Tutorial Studio endpoint called with upload status events"
        htmlFor="uploader-callback"
        stacked
      >
        <SettingInput
          id="uploader-callback"
          type="url"
          value={state.callbackPublicUrl ?? ""}
          placeholder="https://studio.example.com/api/production/uploader-status"
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              callbackPublicUrl: e.target.value || undefined,
            }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Manual release"
        hint="Require an operator to release each prepared job"
        htmlFor="uploader-release"
        controlWidth={70}
      >
        <input
          id="uploader-release"
          type="checkbox"
          checked={state.requireManualRelease}
          disabled={!canEdit}
          onChange={(e) =>
            setState((s) => ({ ...s, requireManualRelease: e.target.checked }))
          }
        />
      </SettingRow>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <button
          type="button"
          onClick={testConnection}
          disabled={testing}
          style={{
            padding: "7px 11px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,.12)",
            background: "rgba(255,255,255,.06)",
            color: "var(--v2-text-1)",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {testing ? "Testing…" : "Test uploader connection"}
        </button>
        {testResult && (
          <span
            style={{
              fontSize: 10.5,
              color: testResult.ok ? "#7fd99a" : "#e57373",
            }}
          >
            {testResult.text}
          </span>
        )}
      </div>
    </SectionFormWrapper>
  );
}
