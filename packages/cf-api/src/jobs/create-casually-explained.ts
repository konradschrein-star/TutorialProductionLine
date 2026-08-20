import { eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { contentTemplates, archetypes } from "@repo/db";
import { IngestPayloadSchema } from "@repo/contracts";
import { createRedisConnection, createIngestQueue } from "@repo/queue";
import type { IngestPayload } from "@repo/contracts";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";
import type { CreatedJob } from "../types.js";

/**
 * Create a CASUALLY_EXPLAINED job. The classic pipeline (Explainer-style
 * formats) routes via the `ingest` queue rather than direct row insert —
 * the ingest processor creates the content_jobs row in IDEA_GENERATION
 * and threads it through SCRIPTING → ASSET_COLLECTION → RENDER.
 *
 * Because the row doesn't exist until the ingest worker picks the
 * payload up (seconds later), this creator returns an "accepted" marker
 * rather than a CF job ID. Callers (Hermes, the forge CLI) poll
 * listJobs(channelId, format=CASUALLY_EXPLAINED, status=IDEA_GENERATION)
 * to find the freshly-created row.
 */

const TemplateVariantSchema = z
  .enum([
    "AUTOMATED",
    "EDITORIAL",
    "AUTOMATED_SCRIPT_PROVIDED",
    "EDITORIAL_SCRIPT_PROVIDED",
  ])
  .default("AUTOMATED");

export const CreateCasuallyExplainedInputSchema = z.object({
  channelId: z.string().uuid(),
  topic: z.string().min(3).max(1000).optional(),
  script: z.string().min(50).max(50000).optional(),
  templateName: z
    .string()
    .optional()
    .describe(
      "Optional exact content_templates.name. Otherwise the first CASUALLY_EXPLAINED template is picked.",
    ),
  templateVariant: TemplateVariantSchema.optional().describe(
    "Convenience selector when templateName isn't known: AUTOMATED|EDITORIAL[+_SCRIPT_PROVIDED]. Picks by template name match.",
  ),
  productionVersion: z.enum(["V1", "V2", "V3"]).default("V2"),
  language: z.string().default("en"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3"]).default("16:9"),
  targetDurationSeconds: z.number().int().positive().optional(),
  skipImageQc: z.boolean().default(false),
  skipFinalQc: z.boolean().default(false),
  imageGenerationMode: z.enum(["auto", "manual"]).default("auto"),
  archetypeId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Archetype UUID. If omitted, cf-api auto-selects by archetype name = format (matches what the UI form does).",
    ),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateCasuallyExplainedInput = z.infer<
  typeof CreateCasuallyExplainedInputSchema
>;

export interface CasuallyExplainedAccepted {
  /** Sentinel so callers can detect the async pattern. */
  accepted: true;
  format: "CASUALLY_EXPLAINED";
  channelId: string;
  templateId: string;
  hasScript: boolean;
  topicPreview: string | null;
  /**
   * BullMQ ingest job ID — opaque, only useful for the queue dashboard.
   * To track the actual content job, poll
   *   listJobs(rt, { channelId, format: "CASUALLY_EXPLAINED" })
   * filtering by created_at >= <now>. The row appears within seconds.
   */
  ingestQueueJobId: string;
}

export async function createCasuallyExplainedJob(
  rt: CfRuntime,
  rawInput: unknown,
): Promise<CreatedJob[]> {
  const parsed = CreateCasuallyExplainedInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Invalid CASUALLY_EXPLAINED input",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  if (!input.topic && !input.script) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Provide either `topic` (auto-script) or `script` (verbatim).",
    );
  }

  // Pick the right CASUALLY_EXPLAINED content_templates row.
  const templates = await rt.db
    .select({ id: contentTemplates.id, name: contentTemplates.name })
    .from(contentTemplates)
    .where(eq(contentTemplates.format, "CASUALLY_EXPLAINED"));
  if (templates.length === 0) {
    throw new CfApiError(
      "FAILED_PRECONDITION",
      "No CASUALLY_EXPLAINED template found. Run pnpm seed:casually-explained-* first.",
    );
  }

  let template = templates[0]!;
  if (input.templateName) {
    const exact = templates.find((t) => t.name === input.templateName);
    if (!exact) {
      throw new CfApiError(
        "NOT_FOUND",
        `No CASUALLY_EXPLAINED template named "${input.templateName}"`,
        { available: templates.map((t) => t.name) },
      );
    }
    template = exact;
  } else if (input.templateVariant) {
    const wantsScript = input.templateVariant.endsWith("_SCRIPT_PROVIDED");
    const baseName = input.templateVariant.startsWith("AUTOMATED")
      ? "automated"
      : "editorial";
    const match = templates.find((t) => {
      const n = t.name.toLowerCase();
      const hasScriptInName = n.includes("script");
      return n.includes(baseName) && hasScriptInName === wantsScript;
    });
    if (match) template = match;
  }

  // Resolve archetype_id. The ingest worker's pre-flight validation
  // rejects CE payloads without one (MISSING_ARCHETYPE_ID). The UI form
  // does the same auto-lookup, so cf-api matches that behaviour: prefer
  // an exact-name match for "CASUALLY_EXPLAINED", fall back to any
  // archetype if none match (the worker's pre-flight will then complain
  // with a clearer message than a NOT_FOUND from us).
  let archetypeId = input.archetypeId ?? null;
  if (!archetypeId) {
    const [row] = await rt.db
      .select({ id: archetypes.id })
      .from(archetypes)
      .where(eq(archetypes.name, "CASUALLY_EXPLAINED"))
      .limit(1);
    archetypeId = row?.id ?? null;
  }
  if (!archetypeId) {
    throw new CfApiError(
      "FAILED_PRECONDITION",
      "No archetype found for CASUALLY_EXPLAINED. Run pnpm seed:archetypes or pass archetypeId explicitly.",
    );
  }

  // Build the IngestPayload (the existing pipeline already knows how to
  // turn this into a content_jobs row + drive SCRIPTING).
  const payload: IngestPayload = IngestPayloadSchema.parse({
    channel_id: input.channelId,
    format: "CASUALLY_EXPLAINED",
    template_id: template.id,
    production_version: input.productionVersion,
    initial_topic: input.topic,
    script_text: input.script,
    language: input.language,
    aspect_ratio: input.aspectRatio,
    target_duration_seconds: input.targetDurationSeconds,
    skip_image_qc: input.skipImageQc,
    skip_final_qc: input.skipFinalQc,
    image_generation_mode: input.imageGenerationMode,
    archetype_id: archetypeId,
    metadata: input.metadata,
  });

  const conn = createRedisConnection({ url: rt.redisUrl, mode: "queue" });
  let bullJobId: string;
  try {
    const queue = createIngestQueue(conn);
    const enq = await queue.add("ingest-job", payload, { attempts: 1 });
    bullJobId = String(enq.id);
  } finally {
    await conn.quit();
  }

  const topicPreview = input.topic
    ? input.topic.slice(0, 80)
    : input.script
      ? input.script.slice(0, 80).replace(/\n/g, " ")
      : null;

  // We can't return the eventual content_jobs.id synchronously — the
  // ingest worker creates it. Surface enough info that the caller can
  // poll listJobs() and pick the right row out.
  return [
    {
      id: `pending:${bullJobId}`,
      title: topicPreview ?? "Casually Explained",
      status: "IDEA_GENERATION",
      status_updated_at: new Date().toISOString(),
      extra: {
        accepted: true,
        format: "CASUALLY_EXPLAINED",
        channelId: input.channelId,
        templateId: template.id,
        templateName: template.name,
        ingestQueueJobId: bullJobId,
        hasScript: !!input.script,
        topicPreview,
        hint: "The content_jobs row is created by the ingest worker; poll cf_list_jobs filtered by channelId+format to find it (look for IDEA_GENERATION → SCRIPTING within ~10s).",
      } satisfies CasuallyExplainedAccepted & {
        templateName: string;
        hint: string;
      },
    },
  ];
}
