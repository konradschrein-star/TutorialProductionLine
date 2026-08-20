"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getSection,
  updateSection as updateSectionRepo,
} from "@/lib/repositories/settings-repository";
import { resolveSectionById } from "@/lib/services/settings-service";
import {
  getSchemaForSection,
  type SettingsSectionId,
  SETTINGS_SECTION_IDS,
} from "@repo/contracts";

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface SettingsDataResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Fetch a settings section with defaults resolved and sensitive values masked.
 */
export async function getSettingsSection(
  sectionId: SettingsSectionId,
): Promise<SettingsDataResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "view:settings")) {
      return { success: false, error: "Unauthorized" };
    }

    if (!SETTINGS_SECTION_IDS.includes(sectionId)) {
      return { success: false, error: `Invalid section: ${sectionId}` };
    }

    const dbValue = await getSection(sectionId);
    const resolved = resolveSectionById(sectionId, dbValue);
    // Credentials are no longer a settings section — they live in the secrets
    // area (encrypted_secrets), never returned here.
    return { success: true, data: resolved };
  } catch (error) {
    console.error(`Failed to get settings section ${sectionId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update a settings section. Validates data against the section's Zod schema.
 */
export async function updateSettingsSection(
  sectionId: SettingsSectionId,
  data: unknown,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "edit:settings")) {
      return { success: false, error: "Unauthorized" };
    }

    if (!SETTINGS_SECTION_IDS.includes(sectionId)) {
      return { success: false, error: `Invalid section: ${sectionId}` };
    }

    const schema = getSchemaForSection(sectionId);
    const result = schema.safeParse(data);

    if (!result.success) {
      const messages = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { success: false, error: `Validation failed: ${messages}` };
    }

    await updateSectionRepo(sectionId, result.data, session.userId);

    revalidatePath("/settings");

    return { success: true };
  } catch (error) {
    console.error(`Failed to update settings section ${sectionId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
