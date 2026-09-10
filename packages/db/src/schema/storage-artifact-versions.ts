import { pgTable, uuid, text, bigint, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { storageArtifacts } from "./storage-artifacts.js";
/** Immutable evidence for retained Drive objects, not proof of remote availability. */
export const storageArtifactVersions = pgTable("storage_artifact_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  artifact_id: uuid("artifact_id").notNull().references(() => storageArtifacts.id, { onDelete: "restrict" }),
  drive_file_id: text("drive_file_id").notNull(),
  vps_path: text("vps_path").notNull(),
  bytes: bigint("bytes", { mode: "number" }),
  checksum_sha256: text("checksum_sha256"),
  drive_md5: text("drive_md5"),
  verified_at: timestamp("verified_at", { withTimezone: true }),
  recorded_at: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ object: uniqueIndex("storage_artifact_versions_artifact_id_drive_file_id_key").on(table.artifact_id, table.drive_file_id) }));
