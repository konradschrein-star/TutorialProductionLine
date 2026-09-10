import { z } from "zod";

export const assetPreferenceSchema = z.object({
  assetKey: z.string().min(1).max(512).refine((key) => /^[a-z0-9][a-z0-9_-]{0,100}$/i.test(key) || (key.startsWith("/") && !key.startsWith("//") && !key.includes("..") && !/[?#\\\u0000-\u001f]/.test(key)), "Invalid asset key"),
  hidden: z.boolean().optional(),
  includeInRotation: z.boolean().optional(),
}).refine((value) => value.hidden !== undefined || value.includeInRotation !== undefined, "Choose a preference to update");

export function assetIsInCollection(key: string, preferences: Record<string, { hidden?: boolean }>): boolean {
  return !preferences[key]?.hidden;
}
export function eligibleBackgrounds<T extends { key: string }>(backgrounds: T[], preferences: Record<string, { hidden?: boolean; includeInRotation?: boolean }>): T[] {
  return backgrounds.filter((item) => !preferences[item.key]?.hidden && preferences[item.key]?.includeInRotation !== false);
}
