import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tutorialPromptCategoryEnum } from "./tutorial-enums.js";

export const tutorialPromptPresets = pgTable(
  "tutorial_prompt_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: tutorialPromptCategoryEnum("category").notNull(),
    name: text("name").notNull(),
    system_prompt: text("system_prompt").notNull(),
    is_seeded: boolean("is_seeded").notNull().default(false),
    is_default: boolean("is_default").notNull().default(false),
    created_by: uuid("created_by").references(() => users.id, {
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
    categoryIdx: index("tutorial_prompt_presets_category_idx").on(t.category),
  }),
);
