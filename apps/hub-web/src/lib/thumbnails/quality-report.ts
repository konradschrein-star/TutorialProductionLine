import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
const reportSchema = z.object({ version: z.literal(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["passed", "needs_review", "unverified"]), checks: z.object({ dimensions: z.boolean(), nonBlank: z.boolean() }), issues: z.array(z.string().max(300)).max(16), repairInstructions: z.string().max(1000).nullable(), visualCheck: z.enum(["checked", "unavailable"]), approval: z.literal("human_required") });
export function validateThumbnailQualityReport(value: unknown, sha256: string) {
  const parsed = reportSchema.safeParse(value);
  return parsed.success && parsed.data.sha256 === sha256 ? parsed.data : null;
}
export async function readThumbnailQualityReport(path: string, sha256: string) {
  try {
    const reportPath = `${path}.quality.json`;
    const info = await lstat(reportPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return null;
    return validateThumbnailQualityReport(JSON.parse(await readFile(reportPath, "utf8")), sha256);
  } catch { return null; }
}
