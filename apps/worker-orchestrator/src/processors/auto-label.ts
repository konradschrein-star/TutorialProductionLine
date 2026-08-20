import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import { loadConfig } from "@repo/config";

/**
 * Auto-Label Processor
 *
 * Automatically generates `generated_tags[]` for a published content job
 * by reading the job's script content (or title as fallback) and calling
 * a small local Ollama LLM.
 *
 * Why text-only (no vision model):
 * The script already describes the content. Tags are derived from topic and
 * narrative context — no image analysis needed.
 *
 * Payload: { job_id: string }
 *
 * Flow:
 * 1. Load content job row
 * 2. Extract context text from script_content or title
 * 3. Call Ollama /api/chat with JSON format, asking for { tags }
 * 4. PATCH content_jobs.generated_tags with the result
 */
export function createAutoLabelProcessor(db: DrizzleClient) {
  const config = loadConfig();

  return async (job: Job<{ job_id: string }>) => {
    const { job_id } = job.data;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Starting auto-label job",
        job_id,
      }),
    );

    // 1. Load content job
    const [contentJob] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job_id))
      .limit(1);

    if (!contentJob) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Auto-label: content job not found, skipping",
          job_id,
        }),
      );
      return;
    }

    // 2. Extract context for the LLM
    // Prefer script (truncated), fall back to title
    const scriptContent = contentJob.script ?? "";
    const contextText = scriptContent.trim() || contentJob.title.trim();

    if (!contextText) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Auto-label: no script or title — skipping",
          job_id,
        }),
      );
      return;
    }

    // 3. Build Ollama request
    const systemPrompt = `You are a content librarian for a YouTube automation system.
Given a video script or title, produce a list of descriptive tags for the content.
Respond ONLY with valid JSON — no markdown, no extra text.
Format: { "tags": ["<tag1>", "<tag2>", ...] }
Tags should be lowercase, specific, and useful for search and categorization.
Include: topic tags, format tags (e.g. explainer, documentary), tone tags (e.g. educational, opinion),
and subject-matter tags (e.g. history, technology, politics, health).
Aim for 5-15 tags.`;

    const userMessage = `Title: ${contentJob.title}
Script excerpt: ${contextText.slice(0, 1500)}`;

    const ollamaUrl = (config as any).OLLAMA_URL as string;
    const ollamaModel = (config as any).OLLAMA_MODEL as string;

    let generatedTags: string[] = [];

    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: false,
          format: "json",
          options: {
            temperature: 0.3,
            num_predict: 256,
          },
        }),
        signal: AbortSignal.timeout(50_000),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama returned HTTP ${response.status}: ${await response.text()}`,
        );
      }

      const ollamaBody = (await response.json()) as {
        message?: { content?: string };
        error?: string;
      };

      if (ollamaBody.error) {
        throw new Error(`Ollama error: ${ollamaBody.error}`);
      }

      const content = ollamaBody.message?.content ?? "";
      const parsed = JSON.parse(content) as unknown;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "tags" in parsed &&
        Array.isArray((parsed as any).tags)
      ) {
        generatedTags = (parsed as { tags: unknown[] }).tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        throw new Error(
          `Unexpected Ollama response shape: ${content.slice(0, 200)}`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Auto-label: Ollama call failed",
          job_id,
          error: errMsg.slice(0, 500),
        }),
      );
      throw err; // Let BullMQ retry
    }

    // 4. Patch content_jobs.generated_tags
    await db
      .update(contentJobs)
      .set({
        generated_tags: generatedTags,
        updated_at: new Date(),
      })
      .where(eq(contentJobs.id, job_id));

    console.log(
      JSON.stringify({
        level: "info",
        message: "Auto-label completed",
        job_id,
        tag_count: generatedTags.length,
        tags: generatedTags,
      }),
    );
  };
}
