"use server";

import { revalidatePath } from "next/cache";
import {
  updateTemplate as updateTemplateRepo,
  toggleTemplateActive as toggleTemplateActiveRepo,
} from "@/lib/repositories/template-repository";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Update an existing template
 *
 * @param id - Template ID
 * @param data - Updated template data
 * @returns ActionResult
 */
export async function updateTemplate(
  id: string,
  data: {
    name: string;
    description: string | null;
    format: string;
    pipeline_stages: string[];
    prompts: Record<string, any>;
    render_config: Record<string, any>;
    required_assets: string[];
    supports_character_tracking?: boolean;
  },
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:templates")) {
      return { success: false, error: "Unauthorized" };
    }

    const template = await updateTemplateRepo(id, data);

    if (!template) {
      return { success: false, error: "Template not found" };
    }

    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to update template:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Toggle template active status
 *
 * @param id - Template ID
 * @param is_active - New active status
 * @returns ActionResult
 */
export async function toggleTemplateActive(
  id: string,
  is_active: boolean,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:templates")) {
      return { success: false, error: "Unauthorized" };
    }

    const template = await toggleTemplateActiveRepo(id, is_active);

    if (!template) {
      return { success: false, error: "Template not found" };
    }

    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to toggle template active:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
