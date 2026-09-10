import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { statfs } from "node:fs/promises";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { ThemeSelector } from "../_components/theme-selector";
import { hasPermission } from "@/lib/auth/rbac";
import { getSettings } from "@/lib/repositories/settings-repository";
import { resolveSectionById } from "@/lib/services/settings-service";
import { SettingsShell } from "@/components/settings/settings-shell";
import { ConfigMap, type ConfigTile } from "./_components/config-map";
import { db } from "@/lib/db";
import { buildTutorialCredentialRows } from "@/lib/tutorial/credentials";
import { getHubConfig } from "@/lib/config";
import { ttsVoices, musicLibrary, channels, users } from "@repo/db/schema";
import { DriveArchiveCard } from "@/components/settings/sections/drive-archive-card";
import type { PgTable } from "drizzle-orm/pg-core";
import { SetupReadinessCard } from "@/components/settings/setup-readiness-card";
import { UploaderSettingsSchema } from "@repo/contracts";
import { channelSetupCheck } from "@/components/settings/setup-checks";
import { ChannelGroups } from "@/components/settings/channel-groups";

/**
 * Settings — reworked (§3.3). Only three things do something now: Credentials
 * (the ONE secrets area, ADMIN only, shows reality), Storage (bytes, live disk,
 * enforced) and Alerts (Telegram). Theme is a cookie. Everything stored-only was
 * deleted, so the old "Stored only" banner is gone too.
 */

export const dynamic = "force-dynamic";

const VALID_THEMES = new Set([
  "lime",
  "purple",
  "teal",
  "orange",
  "blue",
  "green",
]);

async function safeCount(table: PgTable): Promise<number | null> {
  try {
    const [row] = await db.select({ value: count() }).from(table);
    return row?.value ?? null;
  } catch (error) {
    console.warn("[settings] count failed:", error);
    return null;
  }
}

/** Live disk truth on the artifact root — never a fabricated zero (§3.4). */
async function readStorageStat(): Promise<{
  ok: boolean;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  error?: string;
}> {
  try {
    const root = getHubConfig().LOCAL_MEDIA_ROOT;
    const s = await statfs(root);
    const total = Number(s.bsize) * Number(s.blocks);
    const free = Number(s.bsize) * Number(s.bavail);
    return {
      ok: true,
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "statfs failed",
    };
  }
}

export default async function SettingsPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    redirect("/dashboard");
  }

  const canEdit = hasPermission(session, "edit:settings");
  const canManageCredentials = hasPermission(session, "manage:credentials");

  const cookieStore = await cookies();
  const rawTheme = cookieStore.get("hub_ui_theme")?.value ?? "blue";
  const currentTheme = VALID_THEMES.has(rawTheme) ? rawTheme : "blue";

  // ── Stored settings (only storage + notifications survive) ────────────────
  let initialData: Record<string, unknown>;
  let loadError: string | null = null;
  let lastSavedAt: Date | null = null;

  try {
    const row = await getSettings();
    lastSavedAt = row?.updatedBy ? (row.updatedAt ?? null) : null;
    initialData = {
      storage: resolveSectionById("storage", row?.storage ?? null),
      notifications: resolveSectionById(
        "notifications",
        row?.notifications ?? null,
      ),
      uploader: resolveSectionById("uploader", row?.uploader ?? null),
    };
  } catch (error) {
    console.error("[settings] Failed to load settings:", error);
    loadError =
      error instanceof Error ? error.message : "Failed to load settings";
    initialData = {
      storage: resolveSectionById("storage", null),
      notifications: resolveSectionById("notifications", null),
      uploader: resolveSectionById("uploader", null),
    };
  }

  const [credentials, storageStat] = await Promise.all([
    buildTutorialCredentialRows(),
    readStorageStat(),
  ]);

  // ── Live counts for the configuration map ─────────────────────────────────
  const [voiceCount, trackCount, channelCount, userCount] = await Promise.all([
    safeCount(ttsVoices),
    safeCount(musicLibrary),
    safeCount(channels),
    safeCount(users),
  ]);

  const tiles: ConfigTile[] = [
    {
      label: "Providers & health",
      href: "/system-health",
      icon: "monitor_heart",
      count: null,
      countLabel: "",
      hint: "Health, quotas, fallback chains",
      primary: true,
    },
    {
      label: "TTS Voices",
      href: "/settings/voices",
      icon: "record_voice_over",
      count: voiceCount,
      countLabel: "voices",
      hint: "unavailable",
    },
    {
      label: "Music Library",
      href: "/settings/music",
      icon: "library_music",
      count: trackCount,
      countLabel: "tracks",
      hint: "unavailable",
    },
    {
      label: "Channels",
      href: "/channels",
      icon: "live_tv",
      count: channelCount,
      countLabel: "channels",
      hint: "unavailable",
    },
    {
      label: "Accounts",
      href: "/team",
      icon: "group",
      count: userCount,
      countLabel: "accounts",
      hint: "unavailable",
    },
  ];

  const credentialReady = (kind: string) =>
    credentials.some(
      (row) => row.kind === kind && row.required && row.source !== "none",
    );
  const driveCredentialCount = credentials.filter(
    (row) =>
      row.providerKey.startsWith("google_drive") && row.source !== "none",
  ).length;
  const uploaderSettings = UploaderSettingsSchema.parse(
    initialData.uploader ?? {},
  );
  const handoffChecks = [
    channelSetupCheck(channelCount),
    {
      id: "accounts",
      label: "Team access",
      ready: (userCount ?? 0) >= 2,
      detail: `${userCount ?? 0} accounts configured`,
      href: "/team",
    },
    {
      id: "script",
      probe: true,
      label: "Script provider",
      ready: credentialReady("script"),
      detail: credentialReady("script")
        ? "Credential saved; test to verify connectivity"
        : "Add a required API key below",
      href: "#connections",
    },
    {
      id: "tts",
      probe: true,
      label: "Voice provider",
      ready: credentialReady("tts"),
      detail: credentialReady("tts")
        ? "Credential saved; test to verify connectivity"
        : "Add a required API key below",
      href: "#connections",
    },
    {
      id: "drive",
      probe: true,
      label: "Google Drive",
      ready: driveCredentialCount === 3,
      detail: `${driveCredentialCount}/3 OAuth values saved`,
      href: "#connections",
    },
    {
      id: "uploader",
      label: "Automatic uploader",
      optional: true,
      probe: uploaderSettings.enabled,
      ready: uploaderSettings.enabled,
      detail: uploaderSettings.enabled
        ? `${uploaderSettings.executionMode}; test connection and configure channel destinations before use`
        : "Not enabled. Use manual delivery; connect your own uploader later.",
      href: "#uploader",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Settings
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: "4px 0 0" }}>
            Workspace configuration.{" "}
            {lastSavedAt
              ? `Last saved ${lastSavedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
              : "Nothing has ever been saved here."}
          </p>
        </div>
        <a
          href="/system-health"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: 11.5,
            fontWeight: 800,
            background: "rgba(var(--v2-accent-rgb), 0.1)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            color: "var(--v2-accent)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            monitor_heart
          </span>
          Provider health
        </a>
      </div>

      {/* Load error */}
      {loadError && (
        <GlassCard
          style={{
            padding: 14,
            border: "1px solid rgba(255,180,171,0.25)",
            background: "rgba(255,180,171,0.05)",
            display: "flex",
            gap: 10,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color: "#ffb4ab", flexShrink: 0 }}
          >
            error
          </span>
          <div>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#ffb4ab",
                margin: 0,
              }}
            >
              Could not read saved settings
            </p>
            <p
              style={{
                fontSize: 11,
                color: "rgba(205,195,215,0.6)",
                margin: "3px 0 0",
              }}
            >
              Showing schema defaults. {loadError}
            </p>
          </div>
        </GlassCard>
      )}

      <ConfigMap tiles={tiles} />

      <SetupReadinessCard checks={handoffChecks} />

      {session.role === "ADMIN" && (
        <div id="channel-groups">
          <GlassCard style={{ padding: 16 }}>
            <ChannelGroups />
          </GlassCard>
        </div>
      )}

      {/* Appearance */}
      <GlassCard
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color: "var(--v2-accent)" }}
          >
            palette
          </span>
          <div>
            <h2
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
              }}
            >
              Console appearance
            </h2>
            <p
              style={{
                fontSize: 11,
                color: "rgba(205,195,215,0.5)",
                margin: "2px 0 0",
              }}
            >
              Accent colour, stored per browser. Applies immediately.
            </p>
          </div>
        </div>
        <ThemeSelector currentTheme={currentTheme} />
      </GlassCard>

      <div id="connections">
        <SettingsShell
          initialData={initialData}
          credentials={credentials}
          canEdit={canEdit}
          canManageCredentials={canManageCredentials}
          storageStat={storageStat}
        />
      </div>

      {/* Google Drive delivery status. Paste the Drive Client ID / Secret /
          Refresh token into Credentials above to connect; this card then shows
          real quota + last-upload truth. */}
      <GlassCard style={{ padding: 16, display: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color: "var(--v2-accent)" }}
          >
            cloud_upload
          </span>
          <div>
            <h2
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
              }}
            >
              Delivery — Google Drive
            </h2>
            <p
              style={{
                fontSize: 11,
                color: "rgba(205,195,215,0.5)",
                margin: "2px 0 0",
              }}
            >
              Finished videos are archived here. Connect it by setting the three
              Google Drive credentials above.
            </p>
          </div>
        </div>
        <DriveArchiveCard />
      </GlassCard>
    </div>
  );
}
