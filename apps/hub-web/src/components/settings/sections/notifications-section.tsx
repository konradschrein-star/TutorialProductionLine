"use client";

import { useState, useCallback } from "react";
import { SectionFormWrapper } from "../section-form-wrapper";
import { SettingRow, SettingInput } from "../setting-field";
import { AlertsSettingsSchema, type AlertsSettings } from "@repo/contracts";
import { sendTestAlert } from "@/app/actions/alerts";

interface NotificationsSectionProps {
  initialData: unknown;
}

const CATEGORY_LABELS: Record<string, string> = {
  providerDown: "Provider down",
  credentialExpiry: "Credential expiry (e.g. Fish Audio)",
  jobFailed: "Job failed",
  queueStalled: "Queue stalled",
  diskPressure: "Disk pressure",
};

export function NotificationsSection({
  initialData,
}: NotificationsSectionProps) {
  const [state, setState] = useState<AlertsSettings>(() =>
    AlertsSettingsSchema.parse(initialData ?? {}),
  );
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const getData = useCallback(() => state, [state]);

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    const res = await sendTestAlert(state.chatId);
    setTestMsg(res.success ? "Test alert sent." : `Failed: ${res.error}`);
    setTesting(false);
  }

  return (
    <SectionFormWrapper
      sectionId="notifications"
      title="Alerts"
      description="Telegram alerts when something breaks."
      icon="notifications"
      wiring="live"
      wiringDetail="Persists to system_settings.notifications. Alerts are sent via the Telegram Bot API directly (send-only, independent of AI-OS fleet_state). The bot token lives in the secrets area (TELEGRAM_BOT_TOKEN)."
      getData={getData}
    >
      <SettingRow label="Enabled" htmlFor="alerts-enabled" controlWidth={60}>
        <input
          id="alerts-enabled"
          type="checkbox"
          checked={state.enabled}
          onChange={(e) =>
            setState((s) => ({ ...s, enabled: e.target.checked }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Telegram chat id"
        hint="Where alerts are delivered"
        htmlFor="alerts-chatid"
        controlWidth={180}
      >
        <SettingInput
          id="alerts-chatid"
          type="text"
          value={state.chatId ?? ""}
          placeholder="e.g. 6267562276"
          onChange={(e) =>
            setState((s) => ({ ...s, chatId: e.target.value || undefined }))
          }
        />
      </SettingRow>

      <SettingRow label="Categories" stacked>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(
            Object.keys(CATEGORY_LABELS) as Array<keyof typeof state.categories>
          ).map((key) => (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--v2-text-2)",
              }}
            >
              <input
                type="checkbox"
                checked={state.categories[key]}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    categories: { ...s.categories, [key]: e.target.checked },
                  }))
                }
              />
              {CATEGORY_LABELS[key]}
            </label>
          ))}
        </div>
      </SettingRow>

      <div
        style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}
      >
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "var(--v2-text-1)",
            cursor: testing ? "not-allowed" : "pointer",
          }}
        >
          {testing ? "Sending…" : "Send test alert"}
        </button>
        {testMsg && (
          <span style={{ fontSize: 11.5, color: "var(--v2-text-2)" }}>
            {testMsg}
          </span>
        )}
      </div>
    </SectionFormWrapper>
  );
}
