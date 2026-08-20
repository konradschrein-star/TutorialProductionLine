import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { assets } from "./assets.js";

/**
 * Asset Collections Table
 *
 * Provides hierarchical organization for media assets (video, audio, image).
 * Collections allow operators to group assets by project, episode, content type, etc.
 *
 * Design principles:
 * - Many-to-many relationship: assets can belong to multiple collections
 * - Soft categorization: collections are not required, "Uncategorized" shows all unassigned
 * - Metadata support: each collection has color, icon, description for better UX
 * - Cascade delete: deleting a collection does NOT delete assets (only memberships)
 *
 * Use cases:
 * - "Episode 5 Assets" — all media for a specific episode
 * - "Stock B-Roll" — reusable footage across multiple jobs
 * - "Client Provided" — assets uploaded by external sources
 * - "Music Tracks" — background music collection
 */
export const assetCollections = pgTable("asset_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),

  // Visual metadata for UI
  color: varchar("color", { length: 7 }).default("#6366F1"), // Hex color
  icon: varchar("icon", { length: 50 }).default("folder"),   // Material icon name

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Asset Collection Memberships Table
 *
 * Junction table for many-to-many relationship between assets and collections.
 * An asset can belong to multiple collections, and a collection can contain multiple assets.
 *
 * Cascade behavior:
 * - Deleting an asset removes all its memberships automatically
 * - Deleting a collection removes all its memberships but keeps the assets
 */
export const assetCollectionMemberships = pgTable(
  "asset_collection_memberships",
  {
    asset_id: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    collection_id: uuid("collection_id")
      .notNull()
      .references(() => assetCollections.id, { onDelete: "cascade" }),

    added_at: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.asset_id, table.collection_id] }),
  })
);

export type AssetCollection = typeof assetCollections.$inferSelect;
export type NewAssetCollection = typeof assetCollections.$inferInsert;
export type AssetCollectionMembership = typeof assetCollectionMemberships.$inferSelect;
export type NewAssetCollectionMembership = typeof assetCollectionMemberships.$inferInsert;
