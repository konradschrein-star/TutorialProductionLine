import type { NextRequest } from "next/server";
import { z } from "zod";
import { drama as cfDrama, CfApiError } from "@repo/cf-api";
import { withApiAuth } from "../../../_lib/auth";

const BodySchema = z.object({
  topic: z.string().min(1),
  systemPrompt: z.string().min(1),
  targetMinutes: z.number().int().min(1).max(180),
  referenceText: z.string().nullable().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new CfApiError(
        "BAD_REQUEST",
        "Invalid script-generation request",
        parsed.error.flatten(),
      );
    }
    const script = await cfDrama.generateDramaScript({
      topic: parsed.data.topic,
      systemPrompt: parsed.data.systemPrompt,
      targetMinutes: parsed.data.targetMinutes,
      referenceText: parsed.data.referenceText ?? null,
    });
    return {
      script,
      word_count: script.trim().split(/\s+/).length,
    };
  });
}
