import { z } from "zod";

/**
 * Operator Role Enum
 *
 * Defines the five operator roles in the human-in-the-loop model.
 * Used for RBAC in the Hub control plane.
 *
 * Roles:
 * - ADMIN: Full control, system configuration, template management
 * - MANAGER: Operational oversight, VA management, performance tracking
 * - PRODUCTION_VA: Operates external web UIs (HeyGen), visual QA, asset uploads
 * - UPLOADER_VA: Uses Chrome extension to upload finished videos to YouTube
 * - VIEWER: Read-only access for investors or external stakeholders
 */
export const OperatorRole = z.enum([
  "ADMIN",
  "MANAGER",
  "PRODUCTION_VA",
  "UPLOADER_VA",
  "VIEWER",
  // Scoped operator: can create + monitor LONG_FORM_DRAMA jobs only.
  // Sees nothing else on the platform — jobs/formats lists are filtered
  // server-side, sidebar entries other than the drama flows are hidden.
  "DRAMA_OPERATOR",
  // Scoped operator: can ONLY use the Tutorial Studio (/tutorial-studio).
  // Sees nothing else — the sidebar shows only the tool and every other
  // route 403s back to /tutorial-studio. For the VA recording team.
  "TUTORIAL_VA",
  // Sales demo. Sees the Tutorial Studio and NOTHING else, read-only, and the
  // only rows it can reach are demo jobs created under its own user id — the
  // Studio list and detail routes both filter on created_by, so real work is
  // structurally unreachable rather than filtered out after the fact.
  // Every write is denied and every API path outside a small GET allowlist is
  // 403'd in middleware. Handed to prospective buyers, so treat any widening
  // of this role as a data-disclosure change.
  "TUTORIAL_VISITOR",
]);

export type OperatorRole = z.infer<typeof OperatorRole>;
