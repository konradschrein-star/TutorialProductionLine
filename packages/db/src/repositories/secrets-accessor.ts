import { eq } from "drizzle-orm";
import { encryptedSecrets } from "../schema/encrypted-secrets.js";
import type { DrizzleClient } from "../client.js";
import { decryptSecret, encryptSecret, last4 } from "../crypto/secret-box.js";

/**
 * The single accessor for the ONE secrets area (Decision D3).
 *
 * encrypted_secrets is re-keyed (migration 0046) to a flat `name` = the
 * environment-variable name. Resolution order is fixed and is the ONLY order:
 *   1. encrypted_secrets row where name = $1  -> decrypt -> return
 *   2. process.env[name] if non-empty         -> return, warn once per process
 *   3. throw with diagnostics                  -> never a silent fallback / "".
 *
 * There is exactly one public read (getSecret), one presence probe
 * (getSecretPresence) and one write (setSecret). Resist adding to this surface.
 */

export type SecretSource = "db" | "env" | "none";

export interface SecretPresence {
  name: string;
  source: SecretSource;
  last4: string | null;
  kind: "string" | "file";
  rotatedAt: Date | null;
  expiresAt: Date | null;
  description: string | null;
}

// ── process-local cache: 60s TTL, explicit invalidate on write ──────────────
interface CacheEntry {
  value: string;
  at: number;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const envWarned = new Set<string>();

function cacheGet(name: string): string | undefined {
  const hit = cache.get(name);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(name);
    return undefined;
  }
  return hit.value;
}

function invalidate(name: string): void {
  cache.delete(name);
}

async function readRow(db: DrizzleClient, name: string) {
  const [row] = await db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.name, name))
    .limit(1);
  return row;
}

/**
 * Resolve a string credential by env-var name. Throws if absent everywhere —
 * never returns an empty string.
 */
export async function getSecret(
  db: DrizzleClient,
  name: string,
): Promise<string> {
  const cached = cacheGet(name);
  if (cached !== undefined) return cached;

  const row = await readRow(db, name);
  if (row) {
    if (row.kind === "file") {
      throw new Error(
        `[secrets] ${name} is a FILE credential — use getSecretFilePath(), not getSecret().`,
      );
    }
    const value = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    });
    cache.set(name, { value, at: Date.now() });
    return value;
  }

  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) {
    if (!envWarned.has(name)) {
      envWarned.add(name);
      // eslint-disable-next-line no-console
      console.warn(
        `[secrets] ${name} resolved from .env fallback — migrate it into the secrets area (/settings#credentials).`,
      );
    }
    return fromEnv;
  }

  throw new Error(
    `[secrets] ${name} is not set. Checked: encrypted_secrets(name='${name}') and process.env['${name}']. ` +
      `Add it in /settings#credentials, or set it in .env for bootstrap-only secrets.`,
  );
}

/**
 * Presence probe used by System Health / the credentials editor. Never returns
 * a secret value — only last4 and metadata.
 */
export async function getSecretPresence(
  db: DrizzleClient,
  name: string,
): Promise<SecretPresence> {
  const row = await readRow(db, name);
  if (row) {
    return {
      name,
      source: "db",
      last4: row.last4,
      kind: (row.kind as "string" | "file") ?? "string",
      rotatedAt: row.rotated_at ?? null,
      expiresAt: row.expires_at ?? null,
      description: row.description ?? null,
    };
  }
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) {
    return {
      name,
      source: "env",
      last4: last4(fromEnv),
      kind: "string",
      rotatedAt: null,
      expiresAt: null,
      description: null,
    };
  }
  return {
    name,
    source: "none",
    last4: null,
    kind: "string",
    rotatedAt: null,
    expiresAt: null,
    description: null,
  };
}

/** Presence for many names in one round-trip (credentials editor / overlay). */
export async function getSecretPresences(
  db: DrizzleClient,
  names: string[],
): Promise<Map<string, SecretPresence>> {
  const rows = await db.select().from(encryptedSecrets);
  const byName = new Map(rows.map((r) => [r.name, r]));
  const out = new Map<string, SecretPresence>();
  for (const name of names) {
    const row = byName.get(name);
    if (row) {
      out.set(name, {
        name,
        source: "db",
        last4: row.last4,
        kind: (row.kind as "string" | "file") ?? "string",
        rotatedAt: row.rotated_at ?? null,
        expiresAt: row.expires_at ?? null,
        description: row.description ?? null,
      });
      continue;
    }
    const fromEnv = process.env[name];
    out.set(name, {
      name,
      source: fromEnv && fromEnv.length > 0 ? "env" : "none",
      last4: fromEnv && fromEnv.length > 0 ? last4(fromEnv) : null,
      kind: "string",
      rotatedAt: null,
      expiresAt: null,
      description: null,
    });
  }
  return out;
}

/**
 * Build an EnvLike overlay of every DB-stored credential merged over
 * process.env. Consumed by the provider-registry keyPresent() seam so System
 * Health and Settings report identical presence.
 */
export async function loadCredentialEnv(
  db: DrizzleClient,
): Promise<Record<string, string | undefined>> {
  const rows = await db
    .select({ name: encryptedSecrets.name, last4: encryptedSecrets.last4 })
    .from(encryptedSecrets);
  const overlay: Record<string, string | undefined> = { ...process.env };
  for (const row of rows) {
    // Presence-only overlay: keyPresent() checks non-empty, never the value.
    // We deliberately do NOT decrypt here — a marker is enough and cheaper/safer.
    if (!overlay[row.name] || overlay[row.name]?.length === 0) {
      overlay[row.name] = `stored:${row.last4}`;
    }
  }
  return overlay;
}

export interface SetSecretInput {
  name: string;
  value: string;
  userId: string;
  kind?: "string" | "file";
  description?: string | null;
  expiresAt?: Date | null;
}

/** Encrypt + upsert (by name) + audit + cache-bust. */
export async function setSecret(
  db: DrizzleClient,
  input: SetSecretInput,
): Promise<void> {
  const { name, value, userId } = input;
  if (!value || value.length === 0) {
    throw new Error(`[secrets] refusing to store an empty value for ${name}`);
  }
  const box = encryptSecret(value);
  await db
    .insert(encryptedSecrets)
    .values({
      name,
      kind: input.kind ?? "string",
      description: input.description ?? null,
      expires_at: input.expiresAt ?? null,
      rotated_at: new Date(),
      ciphertext: box.ciphertext,
      iv: box.iv,
      auth_tag: box.authTag,
      last4: last4(value),
      created_by: userId,
      updated_by: userId,
    })
    .onConflictDoUpdate({
      target: encryptedSecrets.name,
      set: {
        kind: input.kind ?? "string",
        description: input.description ?? null,
        expires_at: input.expiresAt ?? null,
        rotated_at: new Date(),
        ciphertext: box.ciphertext,
        iv: box.iv,
        auth_tag: box.authTag,
        last4: last4(value),
        updated_by: userId,
        updated_at: new Date(),
      },
    });
  invalidate(name);
}

/** Remove a credential from the secrets area entirely. */
export async function clearSecret(
  db: DrizzleClient,
  name: string,
): Promise<void> {
  await db.delete(encryptedSecrets).where(eq(encryptedSecrets.name, name));
  invalidate(name);
}
