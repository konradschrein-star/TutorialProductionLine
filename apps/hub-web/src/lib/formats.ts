import { eq } from "drizzle-orm";
import { db, contentTemplates } from "./db";

/**
 * Dynamic format list for the Thumbnail Studio.
 *
 * Single runtime source for every format selector across the thumbnail UI.
 * Never hardcode a format array here or in callers — this reads the
 * distinct set of active formats straight from `content_templates`, plus
 * TUTORIAL_STUDIO (a separate subsystem that has no content_templates row).
 */

export interface ActiveFormat {
  id: string;
  label: string;
}

export function titleCase(id: string): string {
  return id
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export async function getActiveFormats(): Promise<ActiveFormat[]> {
  const rows = await db
    .selectDistinct({ format: contentTemplates.format })
    .from(contentTemplates)
    .where(eq(contentTemplates.is_active, true));

  const ids = new Set<string>();
  for (const r of rows) {
    if (r.format) ids.add(r.format as string);
  }
  ids.add("TUTORIAL_STUDIO"); // tutorials are a gateway format, not a content_templates row

  return [...ids].sort().map((id) => ({ id, label: titleCase(id) }));
}
