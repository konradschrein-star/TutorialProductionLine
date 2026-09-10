import { createHash } from "node:crypto";

export const OMAR_SCHEDULE_CONFIRMATION = "SET_OMAR_STANDARD_WEEKLY_SCHEDULE_20260910";
export const OMAR_SCHEDULE_ROLLBACK_CONFIRMATION = "ROLLBACK_OMAR_STANDARD_WEEKLY_SCHEDULE_20260910";
export const OMAR_SCHEDULE_BACKUP_VERSION = "omar-tutorial-schedule-backup/1" as const;

export const OMAR_ENABLED_TUTORIAL_CHANNELS = [
  { id: "096f7862-4bd6-4ea2-bb1c-a5ce33efbb2b", name: "German Tutorials", language: "de", isPrimary: false },
  { id: "2c95bd71-e753-451e-aec1-f3fb2b603f37", name: "USA Tutorials", language: "en", isPrimary: true },
  { id: "915bb447-d397-4733-bcfc-1415a293ea2e", name: "Swedish Tutorials", language: "sv", isPrimary: false },
  { id: "db586e35-cbe2-44c8-8c23-9fe1d63d3675", name: "Italian Tutorials", language: "it", isPrimary: false },
  { id: "ede03e43-b899-41a3-935f-6802601aaeaa", name: "French Tutorials", language: "fr", isPrimary: false },
] as const;

const day = { enabled: true, dailyCapacity: 30, startMinute: 480, endMinute: 1200 } as const;
export const OMAR_STANDARD_TUTORIAL_SCHEDULE = {
  timezone: "UTC",
  dailyCapacity: 30,
  startMinute: 480,
  endMinute: 1200,
  weeklyPlan: {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: day,
    sunday: day,
  },
} as const;

export interface OmarScheduleChannelRow {
  id: string;
  name: string;
  language: string;
  is_primary: boolean;
  accepts_tutorials: boolean;
  metadata: Record<string, unknown> | null;
}

export interface OmarScheduleBackup {
  version: typeof OMAR_SCHEDULE_BACKUP_VERSION;
  database: "tutorial_studio";
  createdAt: string;
  channels: Array<{ id: string; metadata: Record<string, unknown> | null }>;
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
};

/** Digest of the exact bytes written by the guarded operation. */
export const omarScheduleBackupSha256 = (backup: OmarScheduleBackup) => createHash("sha256").update(JSON.stringify(backup)).digest("hex");

function plainMetadata(value: unknown): value is Record<string, unknown> | null {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

/** Fixed identity and absent-schedule fence used before both dry-run and commit. */
export function assertOmarSchedulePreconditions(rows: readonly OmarScheduleChannelRow[]): void {
  if (rows.length !== OMAR_ENABLED_TUTORIAL_CHANNELS.length) throw new Error("Enabled tutorial channel count changed; no settings were updated");
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  for (let index = 0; index < OMAR_ENABLED_TUTORIAL_CHANNELS.length; index += 1) {
    const expected = OMAR_ENABLED_TUTORIAL_CHANNELS[index]!;
    const actual = ordered[index];
    if (!actual || actual.id !== expected.id || actual.name !== expected.name || actual.language !== expected.language || actual.is_primary !== expected.isPrimary || !actual.accepts_tutorials) throw new Error("Enabled tutorial channel identity changed; no settings were updated");
    if (!plainMetadata(actual.metadata)) throw new Error("Channel metadata is not a JSON object; no settings were updated");
    if (actual.metadata && Object.prototype.hasOwnProperty.call(actual.metadata, "tutorialSchedule")) throw new Error("A tutorial schedule already exists; no settings were updated");
  }
}

export function buildOmarScheduleBackup(rows: readonly OmarScheduleChannelRow[], createdAt = new Date()): OmarScheduleBackup {
  assertOmarSchedulePreconditions(rows);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid backup time");
  return { version: OMAR_SCHEDULE_BACKUP_VERSION, database: "tutorial_studio", createdAt: createdAt.toISOString(), channels: [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({ id: row.id, metadata: row.metadata })) };
}

export function metadataWithOmarSchedule(metadata: Record<string, unknown> | null): Record<string, unknown> {
  return { ...structuredClone(metadata ?? {}), tutorialSchedule: structuredClone(OMAR_STANDARD_TUTORIAL_SCHEDULE) };
}

export function assertOmarScheduleApplied(before: readonly OmarScheduleChannelRow[], after: readonly OmarScheduleChannelRow[]): void {
  if (after.length !== before.length) throw new Error("Schedule verification row count changed; transaction must roll back");
  const previous = new Map(before.map((row) => [row.id, row]));
  for (const row of after) {
    const old = previous.get(row.id);
    if (!old || !plainMetadata(row.metadata)) throw new Error("Schedule verification identity changed; transaction must roll back");
    if (stable(row.metadata?.tutorialSchedule) !== stable(OMAR_STANDARD_TUTORIAL_SCHEDULE)) throw new Error("Standard schedule verification failed; transaction must roll back");
    const { tutorialSchedule: _newSchedule, ...otherAfter } = row.metadata ?? {};
    if (stable(otherAfter) !== stable(old.metadata ?? {})) throw new Error("Unrelated channel metadata changed; transaction must roll back");
  }
}

export function parseOmarScheduleBackup(value: unknown): OmarScheduleBackup {
  if (!value || typeof value !== "object") throw new Error("Invalid Omar schedule backup");
  const backup = value as OmarScheduleBackup;
  const ids = backup.channels?.map((row) => row.id).sort();
  if (backup.version !== OMAR_SCHEDULE_BACKUP_VERSION || backup.database !== "tutorial_studio" || !Number.isFinite(Date.parse(backup.createdAt)) || stable(ids) !== stable(OMAR_ENABLED_TUTORIAL_CHANNELS.map((row) => row.id).sort()) || backup.channels.some((row) => !plainMetadata(row.metadata) || Boolean(row.metadata && Object.prototype.hasOwnProperty.call(row.metadata, "tutorialSchedule")))) throw new Error("Invalid or out-of-scope Omar schedule backup");
  return backup;
}

export function assertOmarScheduleRollbackPreconditions(current: readonly OmarScheduleChannelRow[], backup: OmarScheduleBackup): void {
  if (current.length !== OMAR_ENABLED_TUTORIAL_CHANNELS.length) throw new Error("Enabled tutorial channel count changed; rollback aborted");
  const backedUp = new Map(backup.channels.map((row) => [row.id, row.metadata]));
  for (const row of current) {
    const old = backedUp.get(row.id);
    if (!backedUp.has(row.id) || !plainMetadata(row.metadata) || stable(row.metadata.tutorialSchedule) !== stable(OMAR_STANDARD_TUTORIAL_SCHEDULE)) throw new Error("Current schedule is not the exact standard schedule; rollback aborted");
    const { tutorialSchedule: _schedule, ...other } = row.metadata;
    if (stable(other) !== stable(old ?? {})) throw new Error("Metadata changed after schedule application; rollback aborted");
  }
}
