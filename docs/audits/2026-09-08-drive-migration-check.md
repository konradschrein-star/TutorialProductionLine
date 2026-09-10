# Drive / migration verification — 8 September 2026

Read-only inspection of Content Forge at `cf-vps-deploy`, and VPS2 capacity.
No live files, database rows, accounts, provider settings or deployments changed.

## Confirmed remote copies

Queried Google Drive by the stored file ID using the existing server-side OAuth
configuration. All **2,844 final videos and 1,150 thumbnails** recorded as uploaded
were readable, not trashed, and matched recorded size and MD5. Compared SHA-256
when both sides supplied it. These checks confirm current remote metadata against
the recorded upload; they do not compare freshly hashed current local bytes.

## Unresolved historical exceptions

- 4,037 source jobs have status COMPLETED.
- 1,196 completed jobs lack a confirmed final-video storage record.
- Only five of those jobs still have their final video at the recorded local path;
  five have their recorded raw and narration paths present.
- 508 have known Drive folders, all checked: none contained a video candidate.
- 688 have no recorded Drive folder. Copies elsewhere are not ruled out.
- The source records 1,174 skipped video uploads; many error messages explicitly
  state that local files were missing before delivery. These are historical source
  records, not errors generated or losses caused by this recovery work.
- Counts do not establish permanent loss, and do not authorize deletion.

## Capacity and migration boundary

VPS2 has about 86 GB free. Source tutorial storage is about 256 GiB; a recursive
read-only inventory found 28,878,922,056 bytes in nonterminal job directories and
245,729,183,359 in other directories. Active-directory bytes are an estimate, not
a complete dependency closure: source recordings, locale work, custom artwork and
archived narration still need mapping.

## Recovery safeguards and remaining blockers

Legacy consumers stream and hash local files without restoring archived media.
The old retention predicate trusts an uploaded row and Drive ID without verifying
the current source revision or checking active consumers. The recovery branch now
forces this legacy sweep to report candidates only, even when inherited settings
request deletion. Actual-deleted/freed counters stay zero; proposed counters are
separate. Staging explicitly disables retention and all automatic dispatch.

Before eviction: revision-specific archive catalog; verified streaming restoration;
active-consumer leases; current local/remote checksum equality; dependency checks;
bounded cache policy; regression and real-byte restore pilot. Retain old Drive
revisions until replacement is verified and its identity durably recorded.

Reproducible read-only probes: `scripts/audit-source-drive.mjs` (`--all` and
`--missing-folders`) and `scripts/audit-source-media.mjs`, executed over SSH stdin
on the source host. Credentials are loaded there and never printed or exported.

## Subsequent implementation and byte verification

### User clarification: Drive-first migration

The user confirmed that final videos and thumbnails belong in Google Drive under
`konrad.schrein@gmail.com`, not in a permanent VPS archive. The 33 GB active-media
preservation relay was stopped on clarification; its receiver container exited.
Approximately 1 GB of already-copied staging media remains untouched. No temporary
SSH authorization was installed, and no source media was removed. Verify the
existing OAuth account identity and Drive capacity before archiving additional
source files. VPS2 should materialize only necessary working files on demand.

The 1,196 historical exceptions below refer to Content Forge on VPS1, not Omar's
installation. Five still have their recorded local final file; 1,191 have neither
a confirmed final-video upload record nor a file at their recorded local final
path. This is an unresolved location/recovery count, not proof of permanent loss.

### English-original classification after user clarification

Read-only `scripts/audit-source-originals.mjs` classifies source `tutorial_jobs`,
including its legacy `English` language label. The source stores translations
in a separate derivatives table, so these exceptions must not simply be called
missing translations.

| Source class | Completed | No recorded Drive final | Local final among exceptions |
| --- | ---: | ---: | ---: |
| Explicit English originals | 2,198 | 22 | 5 |
| Original language unknown | 1,671 | 1,052 | 0 |
| Segment children | 168 | 122 | 0 |

Thus 17 explicitly English originals remain unlocated at their recorded final
paths and without recorded Drive delivery. Unknown-language rows require further
classification; they cannot be dismissed as replaceable translations. No files
were changed by this classification. Missing translations can be regenerated and
do not block migration, per the user; do not delete existing translations.

- Immutable revision history, checksum-verified materialization and shared media
  leases are implemented. Approval capture, approved downloads, thumbnail image
  serving, translation and splicing use the new helpers. This is not yet a
  certification of every legacy consumer or writer.
- The new final-video cache eviction service is explicitly opt-in, defaults off
  and is not wired to a scheduler. It passed 38 offline tests. Raw recordings and
  thumbnails are retained until their complete restore/lease paths are verified.
- A real Drive media GET restored one 100,349-byte thumbnail on the source host.
  Its bytes matched the stored size and SHA-256. The new private probe file is
  `/tmp/cf-drive-restore-pilot-49zFJH/thumbnail.bin` (0600, parent 0700). No existing
  source media or Drive objects were changed. This verifies one actual byte
  restore, not every historical file or the deployed target's OAuth setup.
- VPS2 now has isolated staging PostgreSQL/Redis and protected migration
  artifacts. No application workers, live account migration or team cutover has
  occurred. Therefore the initial read-only scope above applies to the audit,
  not to all later staging provisioning.
