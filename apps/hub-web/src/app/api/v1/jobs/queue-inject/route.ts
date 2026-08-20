import type { NextRequest } from "next/server";
import { IngestPayloadSchema } from "@repo/contracts";
import { createRedisConnection, createIngestQueue } from "@repo/queue";
import { CfApiError } from "@repo/cf-api";
import { withApiAuth } from "../../_lib/auth";
import { getV1Runtime } from "../../_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jobs/queue-inject
 *
 * Generic queue-ingest entry point. Wraps the same direct-injection pattern
 * used by apps/worker-orchestrator/src/cli/inject-reactor-job.ts but behind
 * the bearer-gated /api/v1 surface so cf-mcp-server (and any other machine
 * client) can fire jobs for formats that don't yet have a typed cf-api
 * creator: POLITICAL_COMMENTARY_REACTOR, BUNDESTAG.
 *
 * The ingest worker is the single chokepoint that creates the content_jobs
 * row and dispatches to the right format-specific lane (reactor download,
 * bundestag clip analysis, ai-generation for scripting, etc.) — see
 * apps/worker-orchestrator/src/processors/ingest.ts. So an arbitrary
 * IngestPayload here is sufficient to start every queue-ingest format.
 *
 * Body: the full IngestPayload (channel_id, format, template_id, ...).
 *   See packages/contracts/src/queue-payloads/ingest-payload.ts.
 *
 * Returns: { accepted: true, format, ingestQueueJobId, topicPreview }.
 *   The content_jobs row appears within seconds — poll
 *   GET /api/v1/jobs?format=<F>&channelId=<C> to find it.
 */
export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = IngestPayloadSchema.safeParse(body);
    if (!parsed.success) {
      throw new CfApiError(
        "BAD_REQUEST",
        "Invalid IngestPayload",
        parsed.error.flatten(),
      );
    }
    const payload = parsed.data;

    const { redisUrl } = getV1Runtime();
    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    let bullJobId: string;
    try {
      const queue = createIngestQueue(conn);
      const enq = await queue.add("ingest-job", payload, { attempts: 1 });
      bullJobId = String(enq.id);
    } finally {
      await conn.quit();
    }

    const topicPreview = payload.initial_topic
      ? payload.initial_topic.slice(0, 80)
      : payload.script_text
        ? payload.script_text.slice(0, 80).replace(/\n/g, " ")
        : null;

    return {
      accepted: true,
      format: payload.format,
      channelId: payload.channel_id,
      templateId: payload.template_id,
      ingestQueueJobId: bullJobId,
      topicPreview,
      hint: "Poll GET /api/v1/jobs?format=<F>&channelId=<C> to find the content_jobs row (appears within ~10s).",
    };
  });
}
