import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getProductionChannelAccess } from "@/lib/tutorial/channel-access";
import {
  channels,
  createOrReuseTutorialJob,
  getTutorialSettings,
  listPromptPresets,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import {
  KEYWORD_INTAKE_MODES,
  validateKeywordCsvRows,
} from "@/lib/tutorial/keyword-csv";

export const dynamic = "force-dynamic";

const mode = z.enum(KEYWORD_INTAKE_MODES);
const rowSchema = z
  .object({
    // Keep row-level validation below so the response can identify CSV row 7,
    // not just return an opaque request-schema failure for the whole batch.
    keyword: z.string(),
    channel: z.string().trim().default(""),
    steps: z.string().default(""),
    reference_url: z.string().trim().default(""),
    mode: z.string().trim().default(""),
    source_mode: z.string().trim().default(""),
  })
  .strict();
const requestSchema = z
  .object({
    batchKey: z.string().uuid(),
    defaultChannelId: z.string().uuid(),
    rows: z.array(rowSchema).min(1).max(200),
  })
  .strict();

const normalise = (value: string) => value.trim().toLocaleLowerCase("en");

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "The import request is invalid.", issues: parsed.error.issues },
      { status: 400 },
    );

  const available = await db
    .select({
      id: channels.id,
      name: channels.name,
      language: channels.language,
    })
    .from(channels)
    .where(
      and(eq(channels.accepts_tutorials, true), eq(channels.is_primary, true)),
    );
  const byName = new Map(
    available.map((channel) => [normalise(channel.name), channel]),
  );
  const byId = new Map(available.map((channel) => [channel.id, channel]));
  const errors: Array<{ row: number; field: string; message: string }> =
    validateKeywordCsvRows(parsed.data.rows);
  if (errors.length)
    return NextResponse.json(
      {
        error: "Fix the marked rows before importing. Nothing was created.",
        errors,
      },
      { status: 400 },
    );
  const resolved = [] as Array<{
    row: number;
    keyword: string;
    channelId: string;
    language: string;
    steps: string;
    referenceUrl?: string;
    mode: z.infer<typeof mode>;
    sourceMode: "FROM_SCRATCH" | "TRANSCRIPT_REWRITE";
  }>;

  for (const [index, row] of parsed.data.rows.entries()) {
    const rowNumber = index + 2;
    const destination = row.channel
      ? (byId.get(row.channel) ?? byName.get(normalise(row.channel)))
      : byId.get(parsed.data.defaultChannelId);
    if (!destination) {
      errors.push({
        row: rowNumber,
        field: "channel",
        message: "Choose an available channel or use its exact name.",
      });
      continue;
    }
    if (!(await getProductionChannelAccess(session.userId, destination.id))) {
      errors.push({
        row: rowNumber,
        field: "channel",
        message: "This channel is not assigned to you.",
      });
      continue;
    }
    const selectedMode = row.mode
      ? mode.safeParse(row.mode)
      : mode.safeParse("THREE_MIN");
    if (!selectedMode.success) {
      errors.push({
        row: rowNumber,
        field: "mode",
        message: "Use THREE_MIN, SIX_MIN, SHORT_MATCH, or SHORT_PLUS.",
      });
      continue;
    }
    const sourceMode =
      row.source_mode ||
      (row.reference_url ? "TRANSCRIPT_REWRITE" : "FROM_SCRATCH");
    if (sourceMode !== "FROM_SCRATCH" && sourceMode !== "TRANSCRIPT_REWRITE") {
      errors.push({
        row: rowNumber,
        field: "source_mode",
        message: "Use FROM_SCRATCH or TRANSCRIPT_REWRITE.",
      });
      continue;
    }
    resolved.push({
      row: rowNumber,
      keyword: row.keyword,
      channelId: destination.id,
      language: destination.language,
      steps: row.steps,
      ...(row.reference_url ? { referenceUrl: row.reference_url } : {}),
      mode: selectedMode.data,
      sourceMode,
    });
  }
  const seen = new Map<string, number>();
  for (const item of resolved) {
    const key = `${item.channelId}\u0000${normalise(item.keyword)}`;
    const firstRow = seen.get(key);
    if (firstRow)
      errors.push({
        row: item.row,
        field: "keyword",
        message: `This duplicates row ${firstRow} for the same destination channel.`,
      });
    else seen.set(key, item.row);
  }
  if (errors.length)
    return NextResponse.json(
      {
        error: "Fix the marked CSV rows before importing. Nothing was created.",
        errors,
      },
      { status: 400 },
    );

  const [settings, presets] = await Promise.all([
    getTutorialSettings(db),
    listPromptPresets(db),
  ]);
  const preset = presets.find((item) => item.is_default);
  if (!preset)
    return NextResponse.json(
      {
        error:
          "An Admin must configure a default tutorial prompt preset before CSV intake.",
      },
      { status: 409 },
    );
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl)
    return NextResponse.json(
      { error: "The tutorial queue is not configured." },
      { status: 503 },
    );

  const created: Array<{ row: number; jobId: string; duplicate: boolean }> = [];
  const connection = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialGenerateQueue(connection);
    for (const item of resolved) {
      const intake = await createOrReuseTutorialJob(db, {
        created_by: session.userId,
        // Key by the original CSV position, not the filtered array position.
        // A retry must address the same durable intake even if an earlier row
        // failed channel authorization during a previous attempt.
        keyword_ref: `seed:csv:${parsed.data.batchKey}:${item.row - 1}`,
        batch_id: randomUUID(),
        title: item.keyword,
        mode: item.mode,
        steps_input: item.steps,
        prompt_preset_id: preset.id,
        script_provider: settings.default_script_provider,
        script_model: settings.default_script_model ?? undefined,
        tts_provider: settings.default_tts_provider,
        tts_voice: settings.default_tts_voice,
        voice_settings: settings.default_voice_settings ?? undefined,
        channel_id: item.channelId,
        source_mode: item.sourceMode,
        reference_url: item.referenceUrl,
        language: item.language,
      });
      if (!intake.job) {
        errors.push({
          row: item.row,
          field: "keyword",
          message: "This intake key belongs to another producer or channel.",
        });
        continue;
      }
      try {
        await queue.add(
          "tutorial-generate",
          { jobId: intake.job.id, stage: "script" },
          { jobId: `tutorial-script-${intake.job.id}`, attempts: 2 },
        );
        created.push({
          row: item.row,
          jobId: intake.job.id,
          duplicate: !intake.created,
        });
      } catch {
        // The durable intake key means the same batch can be retried safely.
        // Tell the operator that the record exists but is not acknowledged as
        // queued, rather than turning a partial batch into an unexplained 500.
        errors.push({
          row: item.row,
          field: "keyword",
          message:
            "The tutorial was saved, but script queueing was not confirmed. Retry this same batch; do not create a replacement row.",
        });
      }
    }
  } finally {
    await connection.quit();
  }
  return NextResponse.json(
    { created, errors, batchKey: parsed.data.batchKey },
    { status: errors.length ? 207 : 201 },
  );
}
