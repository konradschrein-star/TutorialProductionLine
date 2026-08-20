import { eq } from "drizzle-orm";
import { z } from "zod";
import { contentTemplates } from "@repo/db";
import { IngestPayloadSchema, DEFAULT_TIER_CONFIG } from "@repo/contracts";
import { createRedisConnection, createIngestQueue } from "@repo/queue";
import type {
  IngestPayload,
  RankingItem,
  RankingMetadata,
} from "@repo/contracts";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";
import type { CreatedJob } from "../types.js";

/**
 * Create a RANKING (tier-list) job. Like CASUALLY_EXPLAINED, RANKING routes
 * via the `ingest` queue rather than a direct row insert — the ingest
 * processor creates the content_jobs row in IDEA_GENERATION and threads it
 * through SCRIPTING → ASSET_COLLECTION → RENDER.
 *
 * RANKING is unusual in that the caller may provide NO explicit items: pass a
 * freeform `brief` (a pasted script, a rough list, or a description) and the
 * script-gen step (DeepSeek) decides + ranks the items itself, backfilling
 * `metadata.ranking.items` before footage-collection runs. When the caller
 * DOES pass `items`, those win.
 *
 * Because the row doesn't exist until the ingest worker picks the payload up
 * (seconds later), this creator returns an "accepted" marker rather than a CF
 * job ID. Callers poll listJobs(channelId, format=RANKING) to find the row.
 */

export const CreateRankingInputSchema = z.object({
  channelId: z.string().uuid(),
  brief: z
    .string()
    .min(3)
    .max(50000)
    .optional()
    .describe(
      "Freeform input: a pasted script, a list of things to rank, or a description. The LLM derives + ranks items from this when no explicit items are given.",
    ),
  topic: z
    .string()
    .min(3)
    .max(1000)
    .optional()
    .describe(
      "Optional explicit short title. Derived from brief/items if omitted.",
    ),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        pronunciation: z.string().optional(),
        footageUrls: z.array(z.string().url()).optional(),
      }),
    )
    .optional()
    .describe(
      "Optional explicit items to rank. When empty, the LLM derives them.",
    ),
  context: z.string().max(10000).optional(),
  templateName: z
    .string()
    .optional()
    .describe(
      "Optional exact content_templates.name. Otherwise the first RANKING template is picked.",
    ),
  language: z.string().default("en"),
  skipImageQc: z.boolean().default(false),
  skipFinalQc: z.boolean().default(false),
  jobMode: z
    .enum(["full_auto", "asset_quality_loop"])
    .default("asset_quality_loop")
    .describe(
      'Review gating. "asset_quality_loop" (DEFAULT) parks the job at AWAITING_VA_REVIEW so a human picks and trims B-roll per item in the selection studio. "full_auto" skips that gate entirely and renders the first-fetched footage candidates unattended — faster, but nobody checks the clips before they ship.',
    ),
  userMedia: z
    .array(
      z.object({
        url: z.string().min(1),
        kind: z.enum(["photo", "video"]),
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Create-time image/video uploads shared as a candidate pool across items.",
    ),
});
export type CreateRankingInput = z.infer<typeof CreateRankingInputSchema>;

export async function createRankingJob(
  rt: CfRuntime,
  rawInput: unknown,
): Promise<CreatedJob[]> {
  const parsed = CreateRankingInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Invalid RANKING input",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const hasItems = !!input.items && input.items.length >= 1;
  if (!input.brief && !input.topic && !hasItems) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Provide a brief, a topic, or at least one item.",
    );
  }

  // Pick the right RANKING content_templates row.
  const templates = await rt.db
    .select({ id: contentTemplates.id, name: contentTemplates.name })
    .from(contentTemplates)
    .where(eq(contentTemplates.format, "RANKING"));
  if (templates.length === 0) {
    throw new CfApiError(
      "FAILED_PRECONDITION",
      "No RANKING template found. Run pnpm --filter @repo/db seed:ranking first.",
    );
  }

  let template = templates[0]!;
  if (input.templateName) {
    const exact = templates.find((t) => t.name === input.templateName);
    if (!exact) {
      throw new CfApiError(
        "NOT_FOUND",
        `No RANKING template named "${input.templateName}"`,
        { available: templates.map((t) => t.name) },
      );
    }
    template = exact;
  }

  // Map explicit items (if any) to RankingItem[].
  const items: RankingItem[] = (input.items ?? []).map((it, idx) => ({
    id: `item-${idx + 1}`,
    name: it.name.trim(),
    ...(it.pronunciation ? { pronunciation: it.pronunciation } : {}),
    ...(it.footageUrls && it.footageUrls.length > 0
      ? { userFootageUrls: it.footageUrls }
      : {}),
  }));

  // Derive the topic: explicit → first non-empty line of brief → item names.
  let topic = input.topic?.trim() ?? "";
  if (!topic && input.brief) {
    const firstLine = input.brief
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    // Cap at 100 — content_jobs.title is varchar(100).
    if (firstLine) topic = firstLine.slice(0, 100);
  }
  if (!topic && items.length > 0) {
    topic = `Ranking: ${items
      .slice(0, 4)
      .map((i) => i.name)
      .join(", ")}`.slice(0, 100);
  }
  if (!topic) {
    // Should be unreachable given the guard above, but RankingMetadataSchema
    // requires a non-empty topic — fail loudly rather than emit garbage.
    throw new CfApiError(
      "BAD_REQUEST",
      "Could not derive a topic. Provide a topic, a non-empty brief, or at least one item.",
    );
  }

  const ranking: RankingMetadata = {
    topic,
    ...(input.brief ? { brief: input.brief } : {}),
    items,
    context: input.context ?? "",
    tierConfig: DEFAULT_TIER_CONFIG,
    // Written explicitly (not left undefined) so the mode is visible in the
    // job row rather than implied by asset-collection's default. Nothing used
    // to write this field at all, which made full_auto unreachable.
    jobMode: input.jobMode,
    ...(input.userMedia && input.userMedia.length > 0
      ? { userMedia: input.userMedia }
      : {}),
  };

  // Build the IngestPayload. RANKING needs no archetype_id.
  const payload: IngestPayload = IngestPayloadSchema.parse({
    channel_id: input.channelId,
    format: "RANKING",
    template_id: template.id,
    production_version: "V2",
    initial_topic: topic,
    language: input.language,
    skip_image_qc: input.skipImageQc,
    skip_final_qc: input.skipFinalQc,
    metadata: { ranking },
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

  return [
    {
      id: `pending:${bullJobId}`,
      title: topic,
      status: "IDEA_GENERATION",
      status_updated_at: new Date().toISOString(),
      extra: {
        accepted: true,
        format: "RANKING",
        channelId: input.channelId,
        templateId: template.id,
        templateName: template.name,
        ingestQueueJobId: bullJobId,
        itemsProvided: items.length,
        jobMode: input.jobMode,
        hint: "Poll cf_list_jobs filtered by channelId+format=RANKING to find the content_jobs row (IDEA_GENERATION → SCRIPTING within ~10s).",
      },
    },
  ];
}
