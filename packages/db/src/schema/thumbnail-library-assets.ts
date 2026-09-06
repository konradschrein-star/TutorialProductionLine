import { boolean, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const thumbnailLibraryAssets = pgTable("thumbnail_library_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 24 }).notNull(),
  file_path: text("file_path").notNull(),
  file_name: varchar("file_name", { length: 255 }).notNull(),
  created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  include_in_rotation: boolean("include_in_rotation").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ categoryCreatedIdx: index("idx_thumbnail_library_assets_category_created").on(table.category, table.created_at) }));

export type ThumbnailLibraryAsset = typeof thumbnailLibraryAssets.$inferSelect;
