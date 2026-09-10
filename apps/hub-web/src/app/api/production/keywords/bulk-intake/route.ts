import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getProductionChannelAccess } from "@/lib/tutorial/channel-access";
import { channels, createOrReuseTutorialJob, getTutorialSettings, listPromptPresets } from "@repo/db";
import { createRedisConnection, createTutorialGenerateQueue } from "@repo/queue";

export const dynamic = "force-dynamic";

const mode = z.enum(["THREE_MIN", "SIX_MIN", "SHORT_MATCH", "SHORT_PLUS"]);
const rowSchema = z.object({
  keyword: z.string().trim().min(1).max(300),
  channel: z.string().trim().max(200).default(""),
  steps: z.string().max(100_000).default(""),
  reference_url: z.string().trim().max(2_000).default(""),
  mode: z.string().trim().default(""),
  source_mode: z.string().trim().default(""),
}).strict();
const requestSchema = z.object({
  batchKey: z.string().uuid(),
  defaultChannelId: z.string().uuid(),
  rows: z.array(rowSchema).min(1).max(200),
}).strict();

const normalise = (value: string) => value.trim().toLocaleLowerCase("en");

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The import request is invalid.", issues: parsed.error.issues }, { status: 400 });

  const available = await db.select({ id: channels.id, name: channels.name, language: channels.language })
    .from(channels).where(and(eq(channels.accepts_tutorials, true), eq(channels.is_primary, true)));
  const byName = new Map(available.map(channel => [normalise(channel.name), channel]));
  const byId = new Map(available.map(channel => [channel.id, channel]));
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const resolved = [] as Array<{
    row: number; keyword: string; channelId: string; language: string; steps: string;
    referenceUrl?: string; mode: z.infer<typeof mode>; sourceMode: "FROM_SCRATCH" | "TRANSCRIPT_REWRITE";
  }>;

  for (const [index, row] of parsed.data.rows.entries()) {
    const rowNumber = index + 2;
    const destination = (row.channel ? byId.get(row.channel) ?? byName.get(normalise(row.channel)) : byId.get(parsed.data.defaultChannelId));
    if (!destination) { errors.push({ row: rowNumber, field: "channel", message: "Choose an available channel or use its exact name." }); continue; }
    if (!await getProductionChannelAccess(session.userId, destination.id)) { errors.push({ row: rowNumber, field: "channel", message: "This channel is not assigned to you." }); continue; }
    const selectedMode = row.mode ? mode.safeParse(row.mode) : mode.safeParse("THREE_MIN");
    if (!selectedMode.success) { errors.push({ row: rowNumber, field: "mode", message: "Use THREE_MIN, SIX_MIN, SHORT_MATCH, or SHORT_PLUS." }); continue; }
    const sourceMode = row.source_mode || (row.reference_url ? "TRANSCRIPT_REWRITE" : "FROM_SCRATCH");
    if (sourceMode !== "FROM_SCRATCH" && sourceMode !== "TRANSCRIPT_REWRITE") { errors.push({ row: rowNumber, field: "source_mode", message: "Use FROM_SCRATCH or TRANSCRIPT_REWRITE." }); continue; }
    if (row.reference_url) {
      let url: URL;
      try { url = new URL(row.reference_url); } catch { errors.push({ row: rowNumber, field: "reference_url", message: "Enter a complete https:// URL." }); continue; }
      if (!/^https?:$/.test(url.protocol)) { errors.push({ row: rowNumber, field: "reference_url", message: "Only HTTP(S) URLs are accepted." }); continue; }
      if (sourceMode === "TRANSCRIPT_REWRITE" && !(url.hostname === "youtu.be" || url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))) {
        errors.push({ row: rowNumber, field: "reference_url", message: "Automatic transcript rewrite currently accepts YouTube links only." }); continue;
      }
    }
    resolved.push({ row: rowNumber, keyword: row.keyword, channelId: destination.id, language: destination.language, steps: row.steps, ...(row.reference_url ? { referenceUrl: row.reference_url } : {}), mode: selectedMode.data, sourceMode });
  }
  if (errors.length) return NextResponse.json({ error: "Fix the marked CSV rows before importing. Nothing was created.", errors }, { status: 400 });

  const [settings, presets] = await Promise.all([getTutorialSettings(db), listPromptPresets(db)]);
  const preset = presets.find(item => item.is_default);
  if (!preset) return NextResponse.json({ error: "An Admin must configure a default tutorial prompt preset before CSV intake." }, { status: 409 });
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return NextResponse.json({ error: "The tutorial queue is not configured." }, { status: 503 });

  const created: Array<{ row: number; jobId: string; duplicate: boolean }> = [];
  const connection = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialGenerateQueue(connection);
    for (const [index, item] of resolved.entries()) {
      const intake = await createOrReuseTutorialJob(db, {
        created_by: session.userId,
        keyword_ref: `seed:csv:${parsed.data.batchKey}:${index + 1}`,
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
      if (!intake.job) { errors.push({ row: item.row, field: "keyword", message: "This intake key belongs to another producer or channel." }); continue; }
      await queue.add("tutorial-generate", { jobId: intake.job.id, stage: "script" }, { jobId: `tutorial-script-${intake.job.id}`, attempts: 2 });
      created.push({ row: item.row, jobId: intake.job.id, duplicate: !intake.created });
    }
  } finally { await connection.quit(); }
  return NextResponse.json({ created, errors, batchKey: parsed.data.batchKey }, { status: errors.length ? 207 : 201 });
}
