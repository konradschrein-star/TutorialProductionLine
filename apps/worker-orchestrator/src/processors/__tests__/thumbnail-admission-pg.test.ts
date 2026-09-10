import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it, vi } from "vitest";
import { createDrizzleClient } from "@repo/db";
import { ThumbnailPayloadSchema } from "@repo/contracts";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../utils/thumbnail/index.js", () => ({ requestThumbnail: mocks.request }));
import { createThumbnailProcessor } from "../thumbnail.js";
const database = "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test";
it.skipIf(process.env.RECOVERY_THUMBNAIL_PG !== "true")("real JSONB admission commits before mocked HTTP, and repeated delivery spends once", async () => {
  if (process.env.DATABASE_URL !== database || process.env.RECOVERY_NO_WORKERS !== "true") throw new Error("Explicit isolated DB and no-workers guard required");
  const sql = postgres(database, { max: 2 });
  const db = createDrizzleClient(database, { idleTimeoutSeconds: 1 });
  try {
    const [settings] = await sql`SELECT thumbnail_generation_mode FROM tutorial_settings WHERE id=1`;
    expect(settings?.thumbnail_generation_mode).toBe("ai");
    const [owner] = await sql`SELECT id,default_tutorial_channel_id FROM users WHERE email='va@recovery.test' AND is_active=true`;
    expect(owner?.default_tutorial_channel_id).toBeTruthy();
    const id = randomUUID(), group = randomUUID();
    await sql`INSERT INTO tutorial_jobs(id,created_by,channel_id,title,mode,status,language,script_provider,tts_provider,tts_voice) VALUES(${id},${owner!.id},${owner!.default_tutorial_channel_id},'Synthetic thumbnail admission only','THREE_MIN','READY_TO_RECORD','en','synthetic-disabled','synthetic-disabled','synthetic-disabled')`;
    const payload = ThumbnailPayloadSchema.parse({ subjectKind: "tutorial_job", subjectId: id, channelId: owner!.default_tutorial_channel_id, title: "Synthetic thumbnail admission only", format: "TUTORIAL_STUDIO", language: "en", thumbnailTextTop: "TEST", thumbnailTextBottom: "ONLY", requestGroupId: group, manualSelection: true });
    // PostgreSQL JSONB changes key ordering; equality must not depend on serialization order.
    await sql`INSERT INTO tutorial_thumbnail_ai_batches(job_id,request_id,payload_digest,payload) VALUES(${id},${group},'synthetic-only',${sql.json({ payload, count: 5 })})`;
    mocks.request.mockImplementation(async () => {
      await sql.begin(async tx => {
        await tx`SET LOCAL lock_timeout='500ms'`;
        await tx`SELECT id FROM tutorial_jobs WHERE id=${id} FOR UPDATE NOWAIT`;
        await tx`SELECT id FROM tutorial_settings WHERE id=1 FOR UPDATE NOWAIT`;
      });
      const [batch] = await sql`SELECT attempted_variants FROM tutorial_thumbnail_ai_batches WHERE job_id=${id} AND request_id=${group}`;
      expect(batch!.attempted_variants).toEqual([0]);
      return { status: "completed", thumbnailId: randomUUID(), outputPath: "/synthetic/not-created.png" };
    });
    const processor = createThumbnailProcessor(db);
    const job = { data: { ...payload, variantIndex: 0 } } as never;
    await Promise.all([processor(job), processor(job)]);
    await processor(job);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    console.log(JSON.stringify({ syntheticJobId: id, batchId: group, providerInvocationsMocked: true, admissions: 1 }));
  } finally { await sql.end(); }
});
