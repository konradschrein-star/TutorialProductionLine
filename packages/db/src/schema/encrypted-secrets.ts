import {
  pgTable,
  uuid,
  text,
  customType,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { secretCapabilityEnum } from "./tutorial-enums.js";

// bytea column helper (Drizzle has no first-class bytea)
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * encrypted_secrets — THE single secrets area (Decision D3).
 *
 * Re-keyed by migration 0046 from (namespace, capability, provider) to a flat
 * `name` = the environment-variable name, so this table is a 1:1 encrypted
 * mirror of .env. The provider registry's providers.key_env_var is the join.
 *
 * `namespace`, `capability`, `provider` are kept NULLABLE for one release as
 * forensic columns (they used to be the identity); a later migration drops them.
 */
export const encryptedSecrets = pgTable(
  "encrypted_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The environment-variable name, e.g. AI33_API_KEY. The identity of the row. */
    name: text("name").notNull(),
    /** 'string' = value is the secret; 'file' = value is a path to a credential file. */
    kind: text("kind").notNull().default("string"),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    auth_tag: bytea("auth_tag").notNull(),
    last4: text("last4").notNull(),
    description: text("description"),
    rotated_at: timestamp("rotated_at", { withTimezone: true }),
    /** e.g. Fish Audio key expires 2026-08-01. NEVER guessed — set explicitly. */
    expires_at: timestamp("expires_at", { withTimezone: true }),

    // ── Forensic columns (nullable since 0046) — do not use as identity. ──
    namespace: text("namespace").default("tutorial-production"),
    capability: secretCapabilityEnum("capability"),
    provider: text("provider"),

    created_by: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    nameUq: unique("uq_encrypted_secrets_name").on(t.name),
  }),
);
