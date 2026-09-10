import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { channels } from "./channels.js";
import { tutorialJobs } from "./tutorial-jobs.js";
export const tutorialLegacyArchive = pgTable(
  "tutorial_legacy_archive",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source_system: varchar("source_system", { length: 64 }).notNull(),
    source_table: varchar("source_table", { length: 64 }).notNull(),
    source_id: uuid("source_id").notNull(),
    source_parent_id: uuid("source_parent_id"),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    source_owner_id: uuid("source_owner_id"),
    source_channel_id: uuid("source_channel_id"),
    title: text("title").notNull(),
    language: text("language"),
    source_status: text("source_status").notNull(),
    needs_routing: boolean("needs_routing").notNull().default(false),
    source_json: text("source_json").notNull(),
    snapshot_sha256: varchar("snapshot_sha256", { length: 64 }).notNull(),
    runtime_job_id: uuid("runtime_job_id").references(() => tutorialJobs.id, {
      onDelete: "set null",
    }),
    assigned_channel_id: uuid("assigned_channel_id").references(
      () => channels.id,
      { onDelete: "set null" },
    ),
    assigned_by: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    assigned_at: timestamp("assigned_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    snapshotIdentity: uniqueIndex(
      "tutorial_legacy_archive_snapshot_identity",
    ).on(
      table.source_system,
      table.source_table,
      table.source_id,
      table.snapshot_sha256,
    ),
    ownerTime: index("tutorial_legacy_archive_owner_time").on(
      table.owner_user_id,
      table.created_at,
      table.id,
    ),
  }),
);
export const tutorialLegacyArchiveEvents = pgTable(
  "tutorial_legacy_archive_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    archive_id: uuid("archive_id")
      .notNull()
      .references(() => tutorialLegacyArchive.id),
    actor_id: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    event_type: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
