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
import type { CredentialRow } from "@/components/settings/credentials-card";
import { ConfigMap, type ConfigTile } from "./_components/config-map";
import { db } from "@/lib/db";
import { getSecretPresences } from "@repo/db";
import { BUILT_IN_PROVIDERS } from "@repo/provider-registry";
import { getHubConfig } from "@/lib/config";
import {
  ttsVoices,
  musicLibrary,
  subtitlePresets,
  channels,
  contentTemplates,
  users,
} from "@repo/db/schema";
import type { PgTable } from "drizzle-orm/pg-core";

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

async function buildCredentialRows(): Promise<CredentialRow[]> {
  const names = Array.from(
    new Set(
      BUILT_IN_PROVIDERS.map((p) => p.keyEnvVar).filter(
        (n): n is string => !!n,
      ),
    ),
  );
  let presences: Awaited<ReturnType<typeof getSecretPresences>>;
  try {
    presences = await getSecretPresences(db, names);
  } catch (error) {
    console.warn("[settings] credential presence lookup failed:", error);
    presences = new Map();
  }
  return BUILT_IN_PROVIDERS.map((p) => {
    const pres = p.keyEnvVar ? presences.get(p.keyEnvVar) : undefined;
    return {
      providerKey: p.key,
      displayName: p.displayName,
      keyEnvVar: p.keyEnvVar,
      source: pres?.source ?? "none",
      last4: pres?.last4 ?? null,
      expiresAt: pres?.expiresAt ? pres.expiresAt.toISOString() : null,
      costTier: String(p.costTier),
      sortOrder: p.sortOrder ?? 0,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export default async function SettingsPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:settings")) {
    redirect("/dashboard");
  }

  const canEdit = hasPermission(session, "edit:settings");
  const canManageCredentials = hasPermission(session, "manage:credentials");

  const cookieStore = await cookies();
  const rawTheme = cookieStore.get("hub_ui_theme")?.value ?? "lime";
  const currentTheme = VALID_THEMES.has(rawTheme) ? rawTheme : "lime";

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
    };
  } catch (error) {
    console.error("[settings] Failed to load settings:", error);
    loadError =
      error instanceof Error ? error.message : "Failed to load settings";
    initialData = {
      storage: resolveSectionById("storage", null),
      notifications: resolveSectionById("notifications", null),
    };
  }

  const [credentials, storageStat] = await Promise.all([
    buildCredentialRows(),
    readStorageStat(),
  ]);

  // ── Live counts for the configuration map ─────────────────────────────────
  const [
    voiceCount,
    trackCount,
    presetCount,
    channelCount,
    templateCount,
    userCount,
  ] = await Promise.all([
    safeCount(ttsVoices),
    safeCount(musicLibrary),
    safeCount(subtitlePresets),
    safeCount(channels),
    safeCount(contentTemplates),
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
      label: "Subtitle Presets",
      href: "/subtitles",
      icon: "subtitles",
      count: presetCount,
      countLabel: "presets",
      hint: "unavailable",
    },
    {
      label: "Formats & Templates",
      href: "/formats",
      icon: "category",
      count: templateCount,
      countLabel: "templates",
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
    // "Narrators" tile removed (S3): it pointed at /narrators, a deprecated
    // tombstone that just redirects to /channels. Narrators are managed per
    // channel now; TTS Voices above is the live voice surface. Removing this
    // also de-duplicates the two "voice" rows Konrad flagged.
    {
      label: "Team & Access",
      href: "/team",
      icon: "group",
      count: userCount,
      countLabel: "users",
      hint: "unavailable",
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

      <SettingsShell
        initialData={initialData}
        credentials={credentials}
        canEdit={canEdit}
        canManageCredentials={canManageCredentials}
        storageStat={storageStat}
      />
    </div>
  );
}
