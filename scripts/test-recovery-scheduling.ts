import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { createDrizzleClient, channels, users, thumbnails, tutorialJobs, eq, inArray } from "../packages/db/dist/index.js";
import { reserveCompletedTutorialSlots } from "../apps/hub-web/src/lib/tutorial/reserve-publication";
import { channelLocalDate } from "../apps/hub-web/src/lib/tutorial/publication-slots";

const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Only the isolated recovery test database is allowed.");
const db = createDrizzleClient(url);
const [owner] = await db.select().from(users).where(eq(users.email, "va@recovery.test"));
assert(owner, "Run seed-recovery-test first");
const channelId = randomUUID();
await db.insert(channels).values({ id: channelId, youtube_channel_id: `test-${channelId}`, name: "Concurrent scheduling test", language: "en", metadata: { tutorialSchedule: { timezone: "Europe/Berlin", dailyCapacity: 30 } } });
const ids = Array.from({ length: 35 }, () => randomUUID());
await db.insert(tutorialJobs).values(ids.map((id) => ({ id, created_by: owner.id, channel_id: channelId, title: "Scheduling concurrency fixture", mode: "THREE_MIN" as const, status: "COMPLETED" as const, script_provider: "test", tts_provider: "test", tts_voice: "test", final_path: "/test-only/not-a-real-video.mp4", language: "en", va_review_status: "approved" })));
const now = new Date("2026-09-08T00:00:00Z");
await db.update(tutorialJobs).set({ description: "Local test metadata", tags: ["test"] }).where(inArray(tutorialJobs.id, ids));
await db.insert(thumbnails).values(ids.map((id) => ({ subject_kind: "tutorial_job" as const, subject_id: id, channel_id: channelId, language: "en", prompt_mode: "manual" as const, prompt_used: "Isolated scheduling test fixture", status: "completed" as const, is_selected: true, output_path: "/test-only/not-a-real-thumbnail.png" })));
await Promise.all(ids.map((id) => db.transaction(async (tx) => {
  await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, id)).for("update");
  await reserveCompletedTutorialSlots(tx, id, now);
})));
const before = await db.select({ id: tutorialJobs.id, at: tutorialJobs.scheduled_for }).from(tutorialJobs).where(inArray(tutorialJobs.id, ids));
assert.equal(new Set(before.map((row) => row.at!.toISOString())).size, 35);
const days: Record<string, number> = {};
for (const row of before) { const day = channelLocalDate(row.at!, "Europe/Berlin"); days[day] = (days[day] ?? 0) + 1; }
assert.deepEqual(days, { "2026-09-08": 30, "2026-09-09": 5 });
await db.transaction((tx) => reserveCompletedTutorialSlots(tx, ids[0]!, now));
const [after] = await db.select({ at: tutorialJobs.scheduled_for }).from(tutorialJobs).where(eq(tutorialJobs.id, ids[0]!));
assert.equal(after!.at!.toISOString(), before.find((row) => row.id === ids[0])!.at!.toISOString());
console.log(JSON.stringify({ concurrentApprovals: 35, uniqueSlots: 35, dailyCounts: days, repeatedApprovalPreservedSlot: true, environment: "isolated local database" }, null, 2));
// The shared Drizzle client owns a pooled connection; this standalone probe has
// no more work, no workers, and no external delivery configured.
process.exit(0);
