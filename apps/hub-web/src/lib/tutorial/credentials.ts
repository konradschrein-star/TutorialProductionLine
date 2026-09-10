import { BUILT_IN_PROVIDERS } from "@repo/provider-registry";
import { getSecretPresences } from "@repo/db";
import { db } from "@/lib/db";
import type { CredentialRow } from "@/components/settings/credentials-card";
import { TUTORIAL_PROVIDER_KEY_OVERRIDES, TUTORIAL_ADDITIONAL_KEYS } from './credential-slots';

/**
 * Single source of truth for the secrets THIS tutorial tool actually uses.
 *
 * The full `BUILT_IN_PROVIDERS` catalog carries the entire Content Forge zoo
 * (VEO Fleet, VUP, forge, whisper, suno, pexels, yt-dlp, …) which is irrelevant
 * noise for a standalone tutorial studio. Both Settings → Credentials and the
 * System Health page read from here so the two never drift apart.
 */

export type CredentialKind = "script" | "tts" | "images" | "delivery" | "alerts";

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
  required?: boolean;
  description?: string;
  setupUrl?: string;
}

const EXTRA_CREDENTIALS: ExtraCredential[] = [
  ...TUTORIAL_ADDITIONAL_KEYS.map(([keyEnvVar, displayName, kind], index) => ({providerKey:keyEnvVar.toLowerCase(),keyEnvVar,displayName,kind,costTier:'optional',sortOrder:70+index,required:false,description:'Optional provider credential. Save encrypted here; configure its endpoint and provider separately. Presence does not confirm account validity.'})),
  {
    providerKey: "google_drive_client_id",
    displayName: "Google Drive — Client ID",
    keyEnvVar: "GOOGLE_DRIVE_CLIENT_ID",
    costTier: "delivery",
    sortOrder: 100,
    kind: "delivery",
    required: true,
    description:
      "OAuth application identifier used to access the delivery Drive.",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    providerKey: "google_drive_client_secret",
    displayName: "Google Drive — Client secret",
    keyEnvVar: "GOOGLE_DRIVE_CLIENT_SECRET",
    costTier: "delivery",
    sortOrder: 101,
    kind: "delivery",
    required: true,
    description: "OAuth client secret paired with the Drive client ID.",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    providerKey: "google_drive_refresh_token",
    displayName: "Google Drive — Refresh token",
    keyEnvVar: "GOOGLE_DRIVE_REFRESH_TOKEN",
    costTier: "delivery",
    sortOrder: 102,
    kind: "delivery",
    required: true,
    description:
      "Long-lived OAuth refresh token for unattended Drive delivery.",
  },
  {
    providerKey: "telegram_bot_token",
    displayName: "Telegram — Bot token",
    keyEnvVar: "TELEGRAM_BOT_TOKEN",
    costTier: "alerts",
    sortOrder: 110,
    kind: "alerts",
    description: "Optional token used to send operational alerts to Telegram.",
  },
  {
    providerKey: "uploader_callback_secret",
    displayName: "Uploader — Connection token",
    keyEnvVar: "UPLOADER_CALLBACK_SECRET",
    costTier: "uploader",
    sortOrder: 120,
    kind: "delivery",
    required: false,
    description:
      "Optional for manual delivery. When connecting an uploader, use a shared random token of at least 32 characters for callbacks and runtime configuration.",
  },
];

export interface TutorialCredentialRow extends CredentialRow {
  kind: CredentialKind;
  /** True for providers surfaced but not used by this deployment. Rendered
   *  muted with a "not needed" chip instead of a red "missing" state. */
  notNeeded?: boolean;
  required?: boolean;
  description?: string;
  setupUrl?: string;
}

/**
 * Build the credential rows (catalog subset + Drive/Telegram) joined to real
 * encrypted_secrets / .env presence. Never throws — a failed presence lookup
 * degrades every row to "none" rather than blowing up the page.
 */
export async function buildTutorialCredentialRows(): Promise<
  TutorialCredentialRow[]
> {
  const providers = BUILT_IN_PROVIDERS.filter((p) => PROVIDER_KINDS[p.key]).map(p => ({...p,keyEnvVar:TUTORIAL_PROVIDER_KEY_OVERRIDES[p.key] ?? p.keyEnvVar}));

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
      required: p.key === "deepseek" || p.key === "fish",
      description:
        p.key === "deepseek"
          ? "Generates scripts, metadata and translations."
          : p.key === "fish"
            ? "Generates tutorial narration and localized voices."
            : "Optional fallback provider.",
      setupUrl: p.docsUrl ?? undefined,
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
      required: e.required,
      description: e.description,
      setupUrl: e.setupUrl,
    };
  });

  return [...providerRows, ...extraRows].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}
