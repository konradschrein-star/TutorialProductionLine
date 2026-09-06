"use client";

import { StorageSection } from "./sections/storage-section";
import { NotificationsSection } from "./sections/notifications-section";
import { CredentialsCard, type CredentialRow } from "./credentials-card";
import { UploaderSection } from "./sections/uploader-section";
import { SettingsErrorBoundary } from "./settings-error-boundary";
import { ToastContainer } from "@/components/layout/toast";

/**
 * Settings shell. Every rendered section is wired to a runtime consumer:
 *   - Credentials (the ONE secrets area; shows reality; ADMIN only)
 *   - Storage (bytes, live disk truth, enforced)
 *   - Alerts (Telegram)
 *   - Distribution uploader controls (safe/dry-run by default)
 * Theme/appearance lives on the page shell (a cookie). Deleted: General,
 * Pipeline, Rendering, Channels, Security.
 */

interface SettingsShellProps {
  initialData: Record<string, unknown>;
  credentials: CredentialRow[];
  canEdit: boolean;
  canManageCredentials: boolean;
  storageStat: {
    ok: boolean;
    totalBytes?: number;
    freeBytes?: number;
    usedBytes?: number;
    error?: string;
  };
}

export function SettingsShell({
  initialData,
  credentials,
  canEdit,
  canManageCredentials,
  storageStat,
}: SettingsShellProps) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!canEdit && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(75,68,85,0.3)",
            }}
          >
            <p
              style={{
                fontSize: 11.5,
                color: "rgba(205,195,215,0.6)",
                margin: 0,
              }}
            >
              Your role can view these settings but not change them. Saving will
              be rejected.
            </p>
          </div>
        )}

        <SettingsErrorBoundary sectionName="Credentials">
          <CredentialsCard
            rows={credentials}
            canManage={canManageCredentials}
          />
        </SettingsErrorBoundary>

        <div id="uploader">
          <SettingsErrorBoundary sectionName="Uploader">
            <UploaderSection
              initialData={initialData.uploader}
              canEdit={canEdit}
            />
          </SettingsErrorBoundary>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
            alignItems: "start",
          }}
        >
          <SettingsErrorBoundary sectionName="Storage">
            <StorageSection
              initialData={initialData.storage}
              storageStat={storageStat}
              canManageCredentials={canManageCredentials}
            />
          </SettingsErrorBoundary>

          <SettingsErrorBoundary sectionName="Alerts">
            <NotificationsSection initialData={initialData.notifications} />
          </SettingsErrorBoundary>
        </div>
      </div>
      <ToastContainer />
    </>
  );
}
