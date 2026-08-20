import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Canonical AES-256-GCM secret box for the ONE secrets area (encrypted_secrets).
 *
 * This is the single copy. It replaces the two byte-identical duplicates that
 * used to live at apps/hub-web/src/lib/crypto/secret-box.ts and
 * apps/worker-orchestrator/src/utils/tutorial/secret-box.ts (H2).
 */

export interface SecretBox {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

const ALGO = "aes-256-gcm";

function loadKey(base64Key?: string): Buffer {
  const raw = base64Key ?? process.env["SECRETS_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error("SECRETS_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  base64Key?: string,
): SecretBox {
  const key = loadKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptSecret(box: SecretBox, base64Key?: string): string {
  const key = loadKey(base64Key);
  const decipher = createDecipheriv(ALGO, key, box.iv);
  decipher.setAuthTag(box.authTag);
  const plaintext = Buffer.concat([
    decipher.update(box.ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function last4(value: string): string {
  return value.length <= 4 ? value : value.slice(-4);
}
