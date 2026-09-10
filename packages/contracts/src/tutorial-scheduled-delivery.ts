import { z } from "zod";

/** An opt-in successor contract. Never reinterpret the private-only r1 exchange. */
export const SCHEDULED_DELIVERY_VERSION = "tutorial-scheduled-delivery/1" as const;
export const TutorialDeliveryPolicySchema = z.object({
  mode: z.enum(["manual", "scheduled_automatic"]).default("manual"),
  notMadeForKidsConfirmed: z.boolean().default(false),
  monetization: z.enum(["on", "off"]).optional(),
  adSuitabilityConfirmed: z.boolean().default(false),
}).strict().superRefine((policy, context) => {
  if (policy.mode === "scheduled_automatic" && (!policy.notMadeForKidsConfirmed || !policy.monetization || (policy.monetization === "on" && !policy.adSuitabilityConfirmed))) context.addIssue({ code: "custom", message: "Automatic delivery requires explicit audience, monetization and applicable ad-suitability declarations." });
});
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime({ offset: true });
export const ScheduledDeliveryReceiptSchema = z.object({
  version: z.literal(SCHEDULED_DELIVERY_VERSION),
  dispatchId: z.string().uuid(),
  claimId: z.string().uuid(),
  approvalRevision: digest,
  requestSha256: digest,
  sequence: z.number().int().positive(),
  state: z.enum(["uploading", "uploaded", "scheduled", "published", "failed", "uncertain"]),
  occurredAt: timestamp,
  message: z.string().min(1).max(1000),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  scheduledFor: timestamp.optional(),
  publishedAt: timestamp.optional(),
  // A connector must read back the provider state, not merely report a click.
  evidence: z.object({ kind: z.literal("provider_readback"), reference: z.string().min(1).max(500), observedAt: timestamp }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (["uploaded", "scheduled", "published"].includes(value.state) && (!value.videoId || !value.evidence || !value.visibility)) ctx.addIssue({ code: "custom", message: "Verified delivery requires video identity, visibility and provider readback evidence." });
  if (value.state === "scheduled" && (!value.scheduledFor || value.visibility !== "private")) ctx.addIssue({ code: "custom", message: "Scheduling requires a provider-confirmed publish time and private visibility." });
  if (value.state === "published" && (!value.publishedAt || value.visibility !== "public")) ctx.addIssue({ code: "custom", message: "Publication requires a provider-confirmed publication time and public visibility." });
  if (value.state === "uploaded" && value.visibility === "public") ctx.addIssue({ code: "custom", message: "Public visibility must use the published state." });
});
export type ScheduledDeliveryReceipt = z.infer<typeof ScheduledDeliveryReceiptSchema>;

/** Uncertain/failed transfers are never blindly requeued; evidence can reconcile them. */
export function scheduledDeliveryTransitionAllowed(previous: string, next: ScheduledDeliveryReceipt["state"]): boolean {
  if (previous === "generic_queued") return false;
  if (previous === "generic_published") return next === "published";
  if (previous === "generic_scheduled") return ["scheduled", "published", "uncertain", "failed"].includes(next);
  if (previous === "generic_uploaded") return next !== "uploading";
  if (["generic_uncertain", "generic_failed"].includes(previous)) return ["uploaded", "scheduled", "published", "uncertain", "failed"].includes(next);
  return ["generic_dispatched", "generic_uploading"].includes(previous);
}
