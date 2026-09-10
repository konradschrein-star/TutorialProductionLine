import { z } from "zod";

/** Deliberately excludes per-job engines: linked intake uses workspace defaults. */
export const KeywordProductionSchema = z.object({
  keyword_ref: z.string().regex(/^[1-9]\d*$/),
  title: z.string().trim().min(1).max(500),
  channel_id: z.string().uuid(),
  language: z.string().min(2).max(30),
  mode: z.enum(["THREE_MIN", "SIX_MIN"]),
  steps_input: z.string().max(100000).default(""),
  source_mode: z.enum(["FROM_SCRATCH", "TRANSCRIPT_REWRITE"]),
  reference_url: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password &&
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname);
  }, "Use a YouTube reference URL.").optional(),
  reference_transcript: z.string().max(500000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.source_mode !== "TRANSCRIPT_REWRITE") return;
  if (value.reference_transcript && value.reference_transcript.trim().split(/\s+/).length < 80) ctx.addIssue({ code: "custom", path: ["reference_transcript"], message: "Paste the full transcript (at least 80 words)." });
  if (!value.reference_transcript && !value.reference_url) ctx.addIssue({ code: "custom", path: ["reference_url"], message: "Rewrite requires a reference URL or transcript." });
});

export function keywordProductionPayload(data: z.infer<typeof KeywordProductionSchema>) {
  return { title: data.title, channel_id: data.channel_id, language: data.language, mode: data.mode,
    steps: data.steps_input, source_mode: data.source_mode,
    reference_url: data.reference_url, reference_transcript: data.reference_transcript };
}
