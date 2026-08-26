import { BUILT_IN_PROVIDERS } from "@repo/provider-registry";
import { getSecretPresences } from "@repo/db";
import { db } from "@/lib/db";
import type { CredentialRow } from "@/components/settings/credentials-card";

/**
 * Single source of truth for the secrets THIS tutorial tool actually uses.
 *
 * The full `BUILT_IN_PROVIDERS` catalog carries the entire Content Forge zoo
 * (VEO Fleet, VUP, forge, whisper, suno, pexels, yt-dlp, …) which is irrelevant
 * noise for a standalone tutorial studio. Both Settings → Credentials and the
 * System Health page read from here so the two never drift apart.
 */

export type CredentialKind = "script" | "tts" | "delivery" | "alerts";

/** Provider-catalog keys we surface, mapped to what they power. */
const PROVIDER_KINDS: Record<string, CredentialKind> = {
  deepseek: "script", // script engine (default)
  gemini_direct: "script", // optional script fallback
  openai: "script", // optional script fallback
  fish: "tts", // TTS (default)
  ai33: "tts", // TTS + optional thumbnail image gen
  google_tts: "tts",
  elevenlabs_official: "tts",
  inworld: "tts",
};

/**
 * Providers this specific deployment does NOT use. They are surfaced (so the
 * catalog stays honest) but must never read as red/"missing" — the friend's
 * line only runs DeepSeek (script) + Fish (TTS) + Drive + Telegram, so these
 * are rendered muted with a "not needed" chip instead of an alarming error.
 */
const NOT_NEEDED_PROVIDERS = new Set<string>([
  "ai33",
  "openai",
  "gemini_direct",
  "elevenlabs_official",
  "google_tts",
  "inworld",
]);

/**
 * Delivery + alerts secrets that aren't LLM/TTS providers, so they live outside
 * the provider catalog. Same /api/credentials write rails (keyed by env var) —
 * which is what makes Drive + Telegram "connectable" in Settings.
 */
interface ExtraCredential {
  providerKey: string;
  displayName: string;
  keyEnvVar: string;
  costTier: string;
  sortOrder: number;
  kind: CredentialKind;
}

const EXTRA_CREDENTIALS: ExtraCredential[] = [
  {
    providerKey: "google_drive_client_id",
    displayName: "Google Drive — Client ID",
    keyEnvVar: "GOOGLE_DRIVE_CLIENT_ID",
    costTier: "delivery",
    sortOrder: 100,
    kind: "delivery",
  },
  {
    providerKey: "google_drive_client_secret",
    displayName: "Google Drive — Client secret",
    keyEnvVar: "GOOGLE_DRIVE_CLIENT_SECRET",
    costTier: "delivery",
    sortOrder: 101,
    kind: "delivery",
  },
  {
    providerKey: "google_drive_refresh_token",
    displayName: "Google Drive — Refresh token",
    keyEnvVar: "GOOGLE_DRIVE_REFRESH_TOKEN",
    costTier: "delivery",
    sortOrder: 102,
    kind: "delivery",
  },
  {
    providerKey: "telegram_bot_token",
    displayName: "Telegram — Bot token",
    keyEnvVar: "TELEGRAM_BOT_TOKEN",
    costTier: "alerts",
    sortOrder: 110,
    kind: "alerts",
  },
];

export interface TutorialCredentialRow extends CredentialRow {
  kind: CredentialKind;
  /** True for providers surfaced but not used by this deployment. Rendered
   *  muted with a "not needed" chip instead of a red "missing" state. */
  notNeeded?: boolean;
}

/**
 * Build the credential rows (catalog subset + Drive/Telegram) joined to real
 * encrypted_secrets / .env presence. Never throws — a failed presence lookup
 * degrades every row to "none" rather than blowing up the page.
 */
export async function buildTutorialCredentialRows(): Promise<
  TutorialCredentialRow[]
> {
  const providers = BUILT_IN_PROVIDERS.filter((p) => PROVIDER_KINDS[p.key]);

  const names = Array.from(
    new Set(
      [
        ...providers.map((p) => p.keyEnvVar),
        ...EXTRA_CREDENTIALS.map((e) => e.keyEnvVar),
      ].filter((n): n is string => !!n),
    ),
  );

  let presences: Awaited<ReturnType<typeof getSecretPresences>>;
  try {
    presences = await getSecretPresences(db, names);
  } catch (error) {
    console.warn("[credentials] presence lookup failed:", error);
    presences = new Map();
  }

  const providerRows: TutorialCredentialRow[] = providers.map((p) => {
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
      kind: PROVIDER_KINDS[p.key]!,
      notNeeded: NOT_NEEDED_PROVIDERS.has(p.key),
    };
  });

  const extraRows: TutorialCredentialRow[] = EXTRA_CREDENTIALS.map((e) => {
    const pres = presences.get(e.keyEnvVar);
    return {
      providerKey: e.providerKey,
      displayName: e.displayName,
      keyEnvVar: e.keyEnvVar,
      source: pres?.source ?? "none",
      last4: pres?.last4 ?? null,
      expiresAt: pres?.expiresAt ? pres.expiresAt.toISOString() : null,
      costTier: e.costTier,
      sortOrder: e.sortOrder,
      kind: e.kind,
    };
  });

  return [...providerRows, ...extraRows].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}
