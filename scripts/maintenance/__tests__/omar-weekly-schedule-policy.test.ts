import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OMAR_ENABLED_TUTORIAL_CHANNELS,
  OMAR_STANDARD_TUTORIAL_SCHEDULE,
  assertOmarScheduleApplied,
  assertOmarSchedulePreconditions,
  assertOmarScheduleRollbackPreconditions,
  buildOmarScheduleBackup,
  metadataWithOmarSchedule,
  parseOmarScheduleBackup,
  type OmarScheduleChannelRow,
} from "../omar-weekly-schedule-policy.js";

const rows = (): OmarScheduleChannelRow[] => OMAR_ENABLED_TUTORIAL_CHANNELS.map((row) => ({ ...row, is_primary: row.isPrimary, accepts_tutorials: true, metadata: { tutorialChannelProfile: { thumbnailMode: "procedural" }, keep: row.language } }));

describe("Omar weekly schedule operation", () => {
  it("accepts only the exact five enabled identities with absent schedules", () => {
    assert.doesNotThrow(() => assertOmarSchedulePreconditions(rows().reverse()));
    assert.throws(() => assertOmarSchedulePreconditions(rows().slice(1)), /count changed/);
    const renamed = rows(); renamed[0]!.name = "Wrong";
    assert.throws(() => assertOmarSchedulePreconditions(renamed), /identity changed/);
    const scheduled = rows(); scheduled[0]!.metadata = { tutorialSchedule: {} };
    assert.throws(() => assertOmarSchedulePreconditions(scheduled), /already exists/);
  });

  it("adds the seven-day 30/day UTC schedule without changing other keys", () => {
    const before = rows();
    const after = before.map((row) => ({ ...row, metadata: metadataWithOmarSchedule(row.metadata) }));
    assert.doesNotThrow(() => assertOmarScheduleApplied(before, after));
    assert.equal(after[0]!.metadata!.keep, "de");
    assert.deepEqual(after[0]!.metadata!.tutorialSchedule, OMAR_STANDARD_TUTORIAL_SCHEDULE);
    (after[0]!.metadata!.tutorialChannelProfile as Record<string, unknown>).changed = true;
    assert.throws(() => assertOmarScheduleApplied(before, after), /Unrelated/);
  });

  it("creates a scoped backup and permits rollback only from the exact unchanged post-state", () => {
    const before = rows();
    const backup = parseOmarScheduleBackup(buildOmarScheduleBackup(before, new Date("2026-09-10T00:00:00Z")));
    const current = before.map((row) => ({ ...row, metadata: metadataWithOmarSchedule(row.metadata) }));
    assert.doesNotThrow(() => assertOmarScheduleRollbackPreconditions(current, backup));
    (current[0]!.metadata!.tutorialSchedule as Record<string, unknown>).dailyCapacity = 29;
    assert.throws(() => assertOmarScheduleRollbackPreconditions(current, backup), /exact standard/);
  });
});
