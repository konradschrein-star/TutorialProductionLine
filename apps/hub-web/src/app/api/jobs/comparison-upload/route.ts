export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db, contentJobs, eq } from "@/lib/db";
import { createRedisConnection, createAIGenerationQueue } from "@repo/queue";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * POST /api/jobs/comparison-upload
 *
 * Handles research file uploads for TECH_COMPARISON jobs at AWAITING_RESEARCH status.
 * Saves files to local filesystem, transitions job to SCRIPTING, and dispatches
 * the script_from_research AI generation job.
 */
export async function POST(request: NextRequest) {
  // Middleware-exempt (/api/jobs) — must self-authenticate. This writes files to
  // disk and dispatches an AI-generation queue job, so it must not be public.
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let conn: ReturnType<typeof createRedisConnection> | null = null;

  try {
    const formData = await request.formData();
    const jobId = formData.get("job_id") as string;
    const files = formData.getAll("research_files") as File[];

    if (!jobId || files.length === 0) {
      return NextResponse.json(
        { error: "Missing job_id or files" },
        { status: 400 },
      );
    }

    const job = await db.query.contentJobs.findFirst({
      where: eq(contentJobs.id, jobId),
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const localRoot =
      process.env.LOCAL_MEDIA_ROOT ?? "/opt/content-forge/media";
    const jobDir = path.join(localRoot, job.channel_id, job.id, "research");
    await mkdir(jobDir, { recursive: true });

    const assetManifestEntries = [];
    for (const file of files) {
      const filepath = path.join(jobDir, file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filepath, buffer);
      assetManifestEntries.push({
        // Must match the type the generator filters on
        // (handleScriptFromResearchGeneration / hasResearchFiles) —
        // otherwise these uploads are invisible and the job throws
        // "no research files". Canonical string: research/perplexity.
        type: "research/perplexity",
        key: filepath,
        size_bytes: buffer.length,
      });
    }

    const existingManifest = (job.r2_asset_manifest as any[]) ?? [];
    const comparisonMeta = ((job.metadata as any) ?? {})?.comparison ?? {};

    await db
      .update(contentJobs)
      .set({
        r2_asset_manifest: [...existingManifest, ...assetManifestEntries],
        metadata: {
          ...((job.metadata as any) ?? {}),
          comparison: {
            ...comparisonMeta,
            research_uploaded_at: new Date().toISOString(),
          },
        },
        status: "SCRIPTING",
        status_updated_at: new Date(),
      })
      .where(eq(contentJobs.id, jobId));

    // Dispatch script_from_research to AI generation queue
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      conn = createRedisConnection({ url: redisUrl, mode: "queue" });
      const aiQueue = createAIGenerationQueue(conn);
      await aiQueue.add("script-from-research", {
        generation_type: "script_from_research",
        job_id: jobId,
        template_id: job.template_id,
        product_a_name: comparisonMeta.product_a_name ?? "",
        product_b_name: comparisonMeta.product_b_name ?? "",
        subformat: comparisonMeta.subformat ?? "TECH_SOFTWARE",
        // Real research was just uploaded — use it, don't skip.
        skip_research: false,
      });
      await conn.quit();
      conn = null;
    }

    return NextResponse.json({
      success: true,
      files_uploaded: files.length,
      job_id: jobId,
    });
  } catch (error: any) {
    console.error("[comparison-upload] Error:", error);
    if (conn) {
      try {
        await conn.quit();
      } catch {}
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
