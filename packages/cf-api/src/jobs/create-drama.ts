import { eq } from "drizzle-orm";
import { contentJobs, contentTemplates, channels } from "@repo/db";
import {
  getClipLibraryById,
  getReferenceScriptById,
  pickNextReferenceScript,
} from "@repo/db/repositories";
import { LongFormDramaConfigSchema } from "@repo/contracts";
import type { DramaTTSPayload } from "@repo/contracts";
import { createRedisConnection, createDramaTTSQueue } from "@repo/queue";
import { z } from "zod";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";
import type { CreatedJob } from "../types.js";
import { generateDramaScript } from "../drama/generate-script.js";

const RENDER_MODES = [
  "KEN_BURNS",
  "SLOW_VIDEO",
  "DIRECT_T2V",
  "STOCK_CHAIN_FULL",
  "STOCK_CHAIN_HOOKED",
] as const;
type RenderMode = (typeof RENDER_MODES)[number];

export const CreateDramaJobInputSchema = z.object({
  channelId: z.string().uuid(),
  template: z.enum(RENDER_MODES),
  autoScript: z.boolean(),
  topics: z.array(z.string().trim().min(1)).optional(),
  scripts: z.array(z.string().trim().min(1)).optional(),
  targetMinutes: z.number().int().min(1).max(180).default(60),
  referenceScript: z
    .object({
      enabled: z.boolean(),
      referenceId: z.string().uuid().nullable(),
    })
    .optional(),
  music: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["generate", "library"]),
      volumeDb: z.number().min(-60).max(0),
    })
    .optional(),
});
export type CreateDramaJobInput = z.infer<typeof CreateDramaJobInputSchema>;

export interface CreateDramaJobOptions {
  /**
   * If autoScript fails for a topic, by default the job is still
   * created with a placeholder script so the operator can retry from
   * the detail page. Set to true to abort the whole batch instead.
   */
  failFastOnScriptError?: boolean;
}

export async function createDramaJob(
  rt: CfRuntime,
  rawInput: unknown,
  opts: CreateDramaJobOptions = {},
): Promise<CreatedJob[]> {
  const parsed = CreateDramaJobInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CfApiError(
      "BAD_REQUEST",
      "Invalid drama job input",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const items: string[] = input.autoScript
    ? (input.topics ?? [])
    : (input.scripts ?? []);
  if (items.length === 0) {
    throw new CfApiError(
      "BAD_REQUEST",
      input.autoScript ? "topics required" : "scripts required",
    );
  }

  const [template] = await rt.db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.format, "LONG_FORM_DRAMA"))
    .limit(1);
  if (!template) {
    throw new CfApiError(
      "FAILED_PRECONDITION",
      "No LONG_FORM_DRAMA template found. Run the seed script first.",
    );
  }

  const [channel] = await rt.db
    .select({
      id: channels.id,
      clip_library_id: channels.clip_library_id,
    })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  if (!channel) {
    throw new CfApiError("NOT_FOUND", `Channel ${input.channelId} not found`);
  }

  const library = channel.clip_library_id
    ? await getClipLibraryById(channel.clip_library_id)
    : null;
  const systemPrompt =
    library?.script_prompt?.trim() ||
    "You are writing a reality-TV-style drama script. Keep the tone grounded, emotional, and rooted in everyday life. Output the full narrative script in prose with no headings or labels.";

  const conn = createRedisConnection({ url: rt.redisUrl, mode: "queue" });
  const queue = createDramaTTSQueue(conn);
  const created: CreatedJob[] = [];

  try {
    for (const item of items) {
      let script = item;
      let usedReferenceId: string | null = null;
      let usedReferenceName: string | null = null;

      if (input.autoScript) {
        let referenceText: string | null = null;
        const refsEnabled =
          (input.referenceScript?.enabled ?? true) &&
          (library?.use_reference_scripts ?? true) &&
          library != null;

        if (refsEnabled && library) {
          if (input.referenceScript?.referenceId) {
            const ref = await getReferenceScriptById(
              input.referenceScript.referenceId,
            );
            if (ref && ref.clip_library_id === library.id) {
              referenceText = ref.content;
              usedReferenceId = ref.id;
              usedReferenceName = ref.name;
            }
          } else {
            const ref = await pickNextReferenceScript(library.id);
            if (ref) {
              referenceText = ref.content;
              usedReferenceId = ref.id;
              usedReferenceName = ref.name;
            }
          }
        }

        try {
          script = await generateDramaScript({
            topic: item,
            systemPrompt,
            targetMinutes: input.targetMinutes,
            referenceText,
          });
        } catch (err) {
          if (opts.failFastOnScriptError) {
            throw new CfApiError(
              "INTERNAL",
              `Script generation failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // Don't fail the whole batch — record a placeholder job
          // that lets the operator retry from the job detail page.
          script = `[auto-script failed: ${err instanceof Error ? err.message : String(err)}]\n\nTopic: ${item}`;
        }
      }

      const wordCount = script.trim().split(/\s+/).length;
      const estMinutes = Math.round(wordCount / 130);
      const titlePreview = script.slice(0, 60).replace(/\n/g, " ").trim();

      const dramaConfig = LongFormDramaConfigSchema.parse({
        script,
        channelId: input.channelId,
        // Characters were dropped per the new spec; the schema's min(1)
        // is satisfied with a dummy UUID that downstream ignores.
        characterIds: [crypto.randomUUID()],
        renderMode: input.template satisfies RenderMode,
        musicEnabled: input.music?.enabled ?? false,
        musicVolumeDb: input.music?.volumeDb ?? -28,
      });

      const [newJob] = await rt.db
        .insert(contentJobs)
        .values({
          format: "LONG_FORM_DRAMA",
          status: "DRAMA_TTS_GENERATING",
          status_updated_at: new Date(),
          channel_id: input.channelId,
          template_id: template.id,
          title: `Drama: ${titlePreview}…`,
          description: `Long-form drama (~${estMinutes} min, ${wordCount} words)`,
          metadata: {
            drama_config: dramaConfig,
            render_mode: input.template,
            // Snapshot music + library settings at submit time so mid-batch
            // library edits don't retroactively change running jobs.
            music: {
              enabled: input.music?.enabled ?? false,
              mode: input.music?.mode ?? library?.music_mode ?? "generate",
              volume_db:
                input.music?.volumeDb ?? library?.music_volume_db ?? -28,
            },
            clip_library_id: library?.id ?? null,
            target_minutes: input.targetMinutes,
            auto_script: input.autoScript,
            source_topic: input.autoScript ? item : null,
            reference_script: usedReferenceId
              ? { id: usedReferenceId, name: usedReferenceName }
              : null,
          },
        })
        .returning({ id: contentJobs.id });

      if (!newJob) continue;

      const payload: DramaTTSPayload = {
        jobId: newJob.id,
        config: dramaConfig,
      };
      await queue.add("drama-tts", payload, { attempts: 2 });

      created.push({
        id: newJob.id,
        title: `Drama: ${titlePreview}…`,
        status: "DRAMA_TTS_GENERATING",
        status_updated_at: new Date().toISOString(),
        extra: {
          word_count: wordCount,
          estimated_minutes: estMinutes,
          reference_script_id: usedReferenceId,
        },
      });
    }
  } finally {
    await conn.quit();
  }

  return created;
}
