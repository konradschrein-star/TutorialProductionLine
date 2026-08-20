import { beforeEach, expect, it } from "vitest";
import { describeDb, getTestDb, truncateAll } from "../setup/test-db.js";
import {
  createTutorialJob,
  updateTutorialJob,
  getTutorialJobById,
} from "../../repositories/tutorial-job-repository.js";
import { users } from "../../schema/users.js";

describeDb("tutorial-job-repository", () => {
  let userId: string;
  beforeEach(async () => {
    await truncateAll();
    const db = getTestDb();
    const [u] = await db
      .insert(users)
      .values({
        email: "va@example.com",
        name: "VA",
        role: "PRODUCTION_VA",
        passwordHash: "x",
      })
      .returning();
    userId = u!.id;
  });

  it("creates and reads a job with defaults", async () => {
    const db = getTestDb();
    const job = await createTutorialJob(db, {
      created_by: userId,
      title: "How to reset a router",
      mode: "THREE_MIN",
      script_provider: "gemini_pool",
      tts_provider: "ai33_elevenlabs",
      tts_voice: "rachel",
    });
    expect(job.status).toBe("QUEUED");
    expect(job.progress).toBe(0);
    const fetched = await getTutorialJobById(db, job.id);
    expect(fetched?.title).toBe("How to reset a router");
  });

  it("updates status + progress", async () => {
    const db = getTestDb();
    const job = await createTutorialJob(db, {
      created_by: userId,
      title: "t",
      mode: "SIX_MIN",
      script_provider: "gemini_pool",
      tts_provider: "ai33_minimax",
      tts_voice: "v",
    });
    const updated = await updateTutorialJob(db, job.id, {
      status: "GENERATING_SCRIPT",
      progress: 25,
    });
    expect(updated.status).toBe("GENERATING_SCRIPT");
    expect(updated.progress).toBe(25);
  });
});
