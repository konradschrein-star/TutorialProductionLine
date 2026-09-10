# Omar weekly schedule explicit delivery declaration

The standard Tutorial Studio upload plan was applied to Omar's five enabled tutorial channels on 2026-09-10, after Candidate29 deployment and acceptance.

## Applied scope

- Channels: USA (`en`), German (`de`), French (`fr`), Italian (`it`), and Swedish (`sv`).
- Timezone: UTC.
- Active days: Monday through Sunday.
- Daily capacity: 30 videos per channel.
- Daily window: 08:00–20:00 UTC.
- Database scope: exactly five `channels.metadata.tutorialSchedule` values and their `updated_at` timestamps.

No tutorial was approved, reserved, translated, regenerated, dispatched, uploaded, or published by this operation.

## Guardrails and rollback

- The command was dry-run first and matched exactly five expected channel identities with zero existing schedules.
- Commit required the exact confirmation token `SET_OMAR_STANDARD_WEEKLY_SCHEDULE_20260910`.
- A durable pre-change backup was written before the transaction committed:
  `/var/backups/tutorial-omar-schedules/omar-tutorial-schedule-backup-1-2026-09-10T03-21-02-516Z.json`
- Backup size: 1,276 bytes; mode: `0600`; owner: `root:root`.
- Backup SHA-256: `43b03347b318c36d3aa269ca146af2bd2f082696d0a04ceff04a4f3ced04c9b1`.
- The rollback implementation refuses to run unless all five current schedules still equal this exact standard policy and unrelated metadata still matches the backup.

## Post-write verification

A read-only database reconciliation found:

- 5/5 enabled tutorial channels have the exact standard schedule.
- 1,910 tutorial jobs, 8 users, 6 channels, 913 thumbnails, and 8,805 storage artifacts remain.
- Dispatches remain 1 `applied_reported`, 8 `succeeded`, and 7 `uncertain`; receipts remain 72.

An authenticated live browser check of the content calendar showed all five channels in UTC with `0 / 30` capacity cells for every day in the visible week. The emergency pause control remains available. No reservation was created during the check.
