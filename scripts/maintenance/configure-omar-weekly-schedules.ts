/** Omar-only, dry-run by default. Changes only channels.metadata.tutorialSchedule. */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  OMAR_ENABLED_TUTORIAL_CHANNELS,
  OMAR_SCHEDULE_BACKUP_VERSION,
  OMAR_SCHEDULE_CONFIRMATION,
  OMAR_SCHEDULE_ROLLBACK_CONFIRMATION,
  OMAR_STANDARD_TUTORIAL_SCHEDULE,
  assertOmarScheduleApplied,
  assertOmarSchedulePreconditions,
  assertOmarScheduleRollbackPreconditions,
  buildOmarScheduleBackup,
  omarScheduleBackupSha256,
  parseOmarScheduleBackup,
  type OmarScheduleChannelRow,
} from "./omar-weekly-schedule-policy.js";

config({ path: resolve(process.cwd(), ".env") });
const args = process.argv.slice(2);
const commit = args.length === 1 && args[0] === "--commit";
const rollbackArg = args.length === 1 && args[0]?.startsWith("--rollback=") ? args[0].slice("--rollback=".length) : null;
if (args.length && !commit && !rollbackArg) throw new Error("Use no arguments for dry-run, --commit, or --rollback=/absolute/backup.json");
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl || decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== "tutorial_studio") throw new Error("Refusing to operate outside Omar's tutorial_studio database");
if (commit && process.env["OMAR_TUTORIAL_SCHEDULE_CONFIRM"] !== OMAR_SCHEDULE_CONFIRMATION) throw new Error("Exact Omar schedule confirmation is required");
if (rollbackArg && process.env["OMAR_TUTORIAL_SCHEDULE_CONFIRM"] !== OMAR_SCHEDULE_ROLLBACK_CONFIRMATION) throw new Error("Exact Omar schedule rollback confirmation is required");
if (rollbackArg && (!rollbackArg.startsWith("/var/backups/tutorial-omar-schedules/") || !rollbackArg.endsWith(".json") || rollbackArg.includes(".."))) throw new Error("Rollback backup path is outside the fixed Omar backup directory");

const client = postgres(databaseUrl, { max: 1, idle_timeout: 2, connect_timeout: 10 });
const selectRows = (tx: postgres.TransactionSql, lock: boolean) => lock
  ? tx<OmarScheduleChannelRow[]>`SELECT id,name,language,is_primary,accepts_tutorials,metadata FROM channels WHERE accepts_tutorials=true ORDER BY id FOR UPDATE`
  : tx<OmarScheduleChannelRow[]>`SELECT id,name,language,is_primary,accepts_tutorials,metadata FROM channels WHERE accepts_tutorials=true ORDER BY id`;

async function durableBackup(rows: readonly OmarScheduleChannelRow[]) {
  const backup = buildOmarScheduleBackup(rows);
  const directory = "/var/backups/tutorial-omar-schedules";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const suffix = backup.createdAt.replace(/[:.]/g, "-");
  const finalPath = `${directory}/${OMAR_SCHEDULE_BACKUP_VERSION.replaceAll("/", "-")}-${suffix}.json`;
  const partialPath = `${finalPath}.partial`;
  const text = JSON.stringify(backup);
  const file = await open(partialPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(partialPath, finalPath);
  const directoryHandle = await open(directory, constants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  return { path: finalPath, sha256: omarScheduleBackupSha256(backup) };
}

try {
  if (!commit && !rollbackArg) {
    const count = await client.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      const rows = await selectRows(tx, false);
      assertOmarSchedulePreconditions(rows);
      return rows.length;
    });
    console.log(JSON.stringify({ mode: "dry-run", database: "tutorial_studio", matchedChannels: count, schedulesPresent: 0, plannedChanges: count, databaseWrites: 0 }));
  } else if (commit) {
    let backup: { path: string; sha256: string } | null = null;
    const changed = await client.begin(async (tx) => {
      const before = await selectRows(tx, true);
      assertOmarSchedulePreconditions(before);
      backup = await durableBackup(before);
      const result = await tx<{ id: string }[]>`
        UPDATE channels SET metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{tutorialSchedule}',${client.json(OMAR_STANDARD_TUTORIAL_SCHEDULE)}::jsonb,true),updated_at=now()
        WHERE id IN ${client(OMAR_ENABLED_TUTORIAL_CHANNELS.map((row) => row.id))}
        RETURNING id
      `;
      if (result.length !== OMAR_ENABLED_TUTORIAL_CHANNELS.length) throw new Error("Updated channel count changed; transaction must roll back");
      const after = await selectRows(tx, false);
      assertOmarScheduleApplied(before, after);
      return result.length;
    });
    console.log(JSON.stringify({ mode: "commit", database: "tutorial_studio", matchedChannels: 5, changedChannels: changed, verifiedChannels: changed, backupPath: backup!.path, backupSha256: backup!.sha256, databaseWrites: changed }));
  } else {
    const raw = await readFile(rollbackArg!, "utf8");
    const backup = parseOmarScheduleBackup(JSON.parse(raw));
    const changed = await client.begin(async (tx) => {
      const current = await selectRows(tx, true);
      assertOmarScheduleRollbackPreconditions(current, backup);
      let restored = 0;
      for (const row of backup.channels) {
        const result = await tx<{ id: string }[]>`UPDATE channels SET metadata=${client.json((row.metadata ?? {}) as postgres.JSONValue)}::jsonb,updated_at=now() WHERE id=${row.id} RETURNING id`;
        restored += result.length;
      }
      if (restored !== 5) throw new Error("Rollback channel count changed; transaction must roll back");
      return restored;
    });
    console.log(JSON.stringify({ mode: "rollback", database: "tutorial_studio", restoredChannels: changed, backupSha256: createHash("sha256").update(raw).digest("hex"), databaseWrites: changed }));
  }
} finally {
  await client.end({ timeout: 2 });
}
