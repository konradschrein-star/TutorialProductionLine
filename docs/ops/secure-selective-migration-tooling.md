# Secure selective migration tooling — phase one

This tooling is **not an authorization to export the live source or perform a
cutover**. Development exercised synthetic data only. The fresh rehearsal DB
`tutorial_staging_bundle_rehearsal_20260908` contains schema but no committed
imported rows. The real CF database has not been copied by this task.

## Implemented scope

`scripts/migration/migrate-selective-cli.ts` provides explicit export, import and
separate provider-environment export modes. Its library is
`scripts/migration/secure-selective-bundle.ts`.

Export runs in one **REPEATABLE READ, READ ONLY** source transaction. It selects:

- Tutorial jobs and derivatives as original PostgreSQL-generated JSON text.
- Tutorial producer/uploader/Admin accounts plus referenced authors/reviewers,
  with explicit account columns and exact existing bcrypt bytes. It excludes
  unrelated user cookie ciphertext and does not select source environment keys.
- Tutorial-enabled channels and channel dependencies referenced by the selected
  tutorial jobs or account defaults; no unrelated content-job tables.
- Voice library identifiers/settings, tutorial settings and prompt presets.
- Relevant shared LLM/TTS/image/storage provider overlays and tutorial/global
  capability ordering, not actual environment credential values.
- Selected tutorial thumbnail/parent/archetype/bookmark/channel-branding rows,
  tutorial background/intro rows and tutorial-owned storage references.

Phase-one import applies **only accounts, voices, channels, tutorial settings,
presets, provider overlays, protected tutorial/derivative archive and eligible
mapped runtime jobs**. Branding, storage references, original system storage
configuration and unsupported settings remain preserved in the private source
bundle but **unapplied**. An explicit `--accept-phase-one yes` is mandatory. This
acknowledgment must not be presented as completing assets/Drive migration.

## Private file rules

- Run real export/import only on a Linux server, not the Windows/OneDrive checkout.
- Create a dedicated owner-owned mode-0700 directory directly under `/var/tmp` or
  `/tmp`, named `tutorial-migration-<unique suffix>`.
- Bundle writes use exclusive creation and mode 0600. Existing files are never
  overwritten. Read checks reject symlinks, hardlinks, wrong owners and group/
  world permissions. No raw bundle is printed, attached or placed in Git.
- Transfer the private file directly between servers over authenticated SSH with
  verified host keys. Verify its SHA-256 independently. Do not relay it through
  OneDrive, browser downloads, shared artifacts or conversation outputs.
- CLI output is aggregate counts, byte count and checksum only. Errors intentionally
  suppress PostgreSQL details because those can contain full private row values.
  Use safe schema/aggregate diagnostics to investigate a refused rehearsal.
- Retain the protected bundle until unapplied assets/settings have been handled
  and rollback policy permits cleanup. It contains password hashes and must be
  treated as credential-bearing even though password values were not changed.

## Invocation contract

Use the existing project runtime to execute the TypeScript CLI on the server.
Database URLs are supplied only through `SOURCE_DATABASE_URL` and
`TARGET_DATABASE_URL`, not command-line flags. Do not echo these environment values.

Export requires:

```
--mode export
--confirm-source-db <exact source database name>
--source-system <stable source identifier>
--bundle /var/tmp/tutorial-migration-<suffix>/source.json
```

Import requires:

```
--mode import
--confirm-empty-target tutorial_staging_<unique name>
--bundle /var/tmp/tutorial-migration-<suffix>/source.json
--sha256 <verified SHA-256>
--primary-channel-ids <explicit approved comma-separated channel UUIDs>
--accept-phase-one yes
--commit no
```

`--commit no` performs a full transactional rehearsal and deliberately rolls it
back. Only a separately approved run changes this to `--commit yes`. The target
database name must start with `tutorial_staging_`, and both CLI and library verify
the exact confirmation against the connected database. It must already have the
verified target schema including migrations 0095–0098. The importer refuses to
merge users, channels, jobs, archives, dispatches, media/thumbnail rows or provider
overlays into a nonempty target. Do not solve that refusal by truncating a database
that contains user work; create another fresh staging DB instead.

Workers, archive scanners, outbox dispatch and uploader processes must remain
absent/stopped during staging import. The tool neither starts them nor sends any
queue/provider request. It locks relevant target tables for its transaction and
leaves dispatch paused, uploader disabled/dry-run, channel automatic delivery
manual, and Drive auto-upload disabled.

## Preservation and safety decisions

- Existing UUIDs, roles, active state, bcrypt bytes, voice identifiers, model/TTS
  defaults, playback/hotkey settings and prompts are preserved. No roles are
  promoted, accounts reset or new placeholder owners invented.
- Primary channels are explicit input, not guessed from names. Language-only
  routing never picks a destination. Unrelated clip-library pointers are retained
  in channel migration metadata, not imported as unrelated format dependencies.
- Archive originals precede runtime projections within one transaction. Original
  JSON text is byte-preserved, including unsupported intro/settings history.
  The general archive rejects credential/token/password field names recursively;
  user password hashes go only into `users`, not into an archive payload.
- Unmapped, unsupported segment/stitch, missing-dependency and in-flight work
  remains archive-only or requires explicit migration/resume handling. Valid
  mapped supported work is not blocked by unrelated unmapped history.
- Legacy approvals do not become exact asset approval, reservations, uploaded
  state or public visibility. No dispatcher request is created.
- DB triggers may create job events/outbox rows during runtime INSERT. The
  importer removes only these same-transaction events for its own imported IDs,
  before they become externally visible, and records `migration_imported`
  instead. It does not disable foreign keys/triggers or erase existing history.
- No media byte transfer, path rewriting, Drive reconciliation or provider calls
  happen here. Existing paths are not treated as proof that files are present.
- Final source write-freeze, change reconciliation and production cutover remain
  separate operations. This importer intentionally does not implement a live
  incremental merge or a background dual-write migration.

## Separate provider credential artifact

`--mode export-env --allowlist <comma-separated names> --bundle <protected path>`
selects only explicitly named supported provider variables from the process
environment and writes a separate mode-0600 JSON artifact. Allowed names cover
DeepSeek, Fish, ElevenLabs, AI33, Anthropic, Gemini, OpenAI, Inworld and Minimax.
Database URLs, JWT/encryption secrets, application session keys and arbitrary
environment names are rejected. Absent requested values fail closed. Nothing is
printed except the artifact checksum and credential count.

The deployment owner must install those values into the target's protected
runtime environment without logging them; this tool does **not** overwrite a
target `.env` or copy broad source environment files. Drive/OAuth credentials need
their own explicitly reviewed transfer, not an expanded provider allowlist.

## Verification performed

`scripts/migration/test-secure-selective-bundle.ts` rehearsed a synthetic bundle
against a fresh isolated target schema inside a transaction. Assertions cover
exact hash/role/default-channel/voice preservation, explicit primary mapping,
byte-preserved archive, one eligible runtime job plus unmapped/in-flight/
derivative archive rows, zero dispatch/outbox rows, disabled execution controls,
nonempty-target refusal and rollback leaving the database empty. Windows refuses
private bundle creation, preventing accidental export into OneDrive.

Not yet exercised: a real source snapshot export, Linux filesystem/transfer
rehearsal, real credential installation, branding/storage phase-two import,
actual provider/media verification, source-delta reconciliation and team cutover.

# Optional asset-reference phase

## Private media planning (no transfer)

Version 3 separates parked cross-format `video_stitch_jobs` identifiers from actual missing tutorial parent/source IDs. Read-only source audit found 35 stitch references (34 existing external stitch rows, one dangling), not 35 lost tutorial parents. All 68 outside-root references in the v2 audit were nonexistent `/tmp` storage paths; v3 labels these stale temporary storage references without granting `/tmp` transfer access. Missing local media is grouped by safe path-field/status metadata and classified as required input, output not yet expected by current status, or requiring review. These are diagnostic categories, not automatic deletion/restoration decisions.

## Reviewed transfer tooling (not executed by development)

### Memory-only relay deployment mode

### Restricted direct-transfer option — review only

Read-only probes from source found that `root@167.233.145.218` already trusts the host key but has no accepted default authentication; source aliases `vps2`/`directory-engine` are not configured. No keys or authorization were changed. The running local relay must not be stopped or a second transfer started until root explicitly coordinates the handoff.

`restricted-direct-transfer-plan.ts` is a pure generator, not an installer. It returns an authorized-key line restricted to `from="65.108.6.149"`, `restrict`, an explicit UTC expiry within six hours, and the exact digest-pinned, network-disabled UID1000 Docker receiver command. It also returns an isolated source SSH config with `IdentitiesOnly`, strict host-key checking, no agent/port forwarding and a dedicated private known-host file. Sender supports `--ssh-config <protected source config>` via `ssh -F`, without modifying normal SSH configuration.

Root-reviewed setup sequence, only if separately authorized:

1. Confirm the source egress address really is the restricted address. Generate a **new one-use Ed25519 key on the source only**, in a new owner-only 0700 `/var/tmp/tutorial-migration-*` directory; private key/config/known_hosts must be 0600. Never copy the private key locally or to VPS2.
2. Obtain the VPS2 host-key entry from the **already verified local known_hosts**, preserving its exact identity/fingerprint. Place only that public host-key entry into the isolated source known_hosts. Do not use unverified `ssh-keyscan` output or disable checking.
3. Validate source `sshd`/target `sshd` supports the expiry/restrict options. Preserve the complete existing VPS2 authorized_keys file in a private server-side backup and append only the generated constrained public-key line. Never replace unrelated keys or grant this key a shell. The forced command overrides every client command and always invokes the restricted receiver. Leave media directory ownership UID1000 unchanged.
4. Run a one-file idempotent pilot through the isolated config. Only after the aggregate receiver result is correct should root stop the memory relay at a safe point and resume the same manifest directly; verified existing files are skipped and mismatches remain untouched. Never run concurrent receivers for the same plan.
5. Immediately after completion/failure, revoke **only the exact generated public-key blob/line** from authorized_keys, asserting exactly one match and preserving every other line byte-for-byte. Verify the key can no longer authenticate. Remove only the explicitly named source temporary private key/config/known_hosts files and the bounded private setup directory when empty; never delete a broad `.ssh` directory. Expiry is a backup control, not a substitute for revocation. Keep aggregate audit evidence and remove the server-side authorized_keys backup according to admin retention policy.

No actual key generation, append, config installation or direct transfer was performed by development. The pure-plan test uses a dummy public-key encoding only.

No new source-to-VPS2 SSH identity is required. `media-memory-relay-cli.ts` runs locally using existing `cf-vps-deploy` and `vps2` aliases with strict host-key checks. It pipes binary SSH stdout directly into the destination SSH stdin with backpressure; it never writes media to a local file, PowerShell pipeline or OneDrive. Both child processes terminate on failure. Only bounded validated numeric aggregates are returned; source diagnostics are never displayed.

Bundle the source/receiver `media-transfer-cli.ts` with `--bundle --platform=node --format=esm --target=node20` into `media-transfer-cli.mjs` at `/var/tmp/tutorial-migration-20260908-recovery/media-transfer-cli.mjs` on source and `/opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs` on VPS2. Top-level await requires ESM; CommonJS output is invalid. Receiver code must be readable by UID 1000. The relay runs a fixed Docker command with a **digest/ID-pinned local image**, `--user 1000:1000 --memory 256m --cpus 0.75`, no network, read-only root filesystem/code mount and the existing staging media directory bind-mounted at its original absolute path. Do not change its ownership to root.

Local invocation: `pnpm exec tsx scripts/migration/media-memory-relay-cli.ts --confirm-transfer tutorial-recovery-staging --manifest <protected server manifest path> --sha256 <manifest checksum> --receiver-image sha256:<local image ID>`. Strict argument validation prevents shell interpolation. Source `send-stream` mode emits only framed bytes on stdout and numeric completion counts on stderr. The receiver emits aggregate JSON only.

Offline tests cover binary non-text bytes, two-process failure termination, strict command arguments and UID-1000/no-network receiver flags. The actual ESM bundle also passed a six-byte synthetic Linux container pilot under UID1000, 256 MiB memory/0.75 CPU, no network and disposable tmpfs source/destination roots. A source-to-VPS2 SSH relay pilot remains required before real media transfer; development has not run that network transfer.

`media-transfer-cli.ts` is a separate Linux-only sender/receiver. Bundle it to the fixed receiver location `/opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs`. Sender requires `--mode send --confirm-transfer tutorial-recovery-staging --manifest <protected manifest> --sha256 <manifest checksum> --ssh-host <existing SSH alias>` and uses strict known-host checking and a fixed remote command. No private paths enter shell interpolation or logs. Receiver destination is fixed to `/opt/tutorial-recovery-staging/media`, mapping only manifest-verified files beneath `/opt/content-forge/media`. Provision this empty directory before starting.

Receiver checks whole-plan free bytes plus 10 GiB headroom, rejects symlink ancestors, writes exclusive 0600 sibling temporary files, hashes the incoming stream and requires the sender's stable SHA/size/stat attestation. It then links atomically with no clobber and removes the temporary name. Existing identical files are counted, mismatches never overwritten. Changed source files are skipped/counted; incomplete transport discards the current partial file. Previously committed verified files remain safe and reruns are idempotent. Source remains untouched. Child stderr and all file-level details are suppressed; only aggregate results are emitted. Synthetic tests use tiny local dummy files, never real media or SSH. Actual Linux transfer and filesystem durability rehearsal remains an execution gate.

`--mode media-plan --bundle <protected source bundle> --sha256 <source checksum> --media-roots /opt/content-forge/media --manifest <new protected manifest file>` reads source filesystem files without copying them. Run on the source server, not on staging, to measure source availability. Both artifacts use owner-private server temp paths; no paths or receipts are logged. The manifest contains private path/reason/receipt details, local SHA-256 and bytes; stdout contains only aggregate counts/checksum.

Manifest version 2 preserves **all non-completed/non-cancelled originals**, including unmapped, in-flight and unsupported archive-only work, plus active legacy derivatives and recursive source/parent/stitch dependencies (including completed child segments). Unreferenced historical generated videos remain excluded. `activeJobs` counts only runnable migration candidates; `preservedAwaitingRoutingOrResume`, `preservedActiveOriginals`, `preservedActiveDerivatives`, safe preservation reason/status counts and missing-reference categories explain preserved-but-not-runnable work. `excludedActiveJobs` is now zero. Nothing is routed, approved, resumed or enqueued. Source audio, raw recording, long audio, transcript, reusable branding/host/voice imagery and path-valued media metadata are retained and deduplicated. Write a NEW versioned private filename; exclusive-create prevents overwriting earlier manifests.

Files must remain inside explicit non-filesystem-root allowlists, with no symlink ancestors or hardlinks. SHA-256 is streamed from an open regular file, with identity/size/timestamp checks to reject concurrent changes. Missing files become `drive_restorable_candidate` only with an uploaded, verified source receipt carrying Drive MD5 and SHA-256; actual Drive availability is **not checked**, and restoration must verify bytes separately. Otherwise missing files remain `unverified_missing`. No workers, transfers, deletion, provider calls or live database writes are performed.

Pass `--include-assets yes` alongside the existing explicit phase-one acknowledgement to import supported branding and storage references in the same fresh-target transaction. This flag does **not** mean migration is complete: credentials, actual media bytes, unsupported tables/columns and any omitted source dependency closure remain separate acceptance gates.

Thumbnail parents are topologically ordered; missing parents/cycles or missing channel/archetype/bookmark dependencies fail the whole transaction. Original IDs and absolute media paths are unchanged. Tutorial storage can point to an archive-only source job without creating a fake runtime job. Source upload-session capabilities are deliberately cleared; all original source evidence remains in the protected bundle.

Every non-null Drive identity gets a 0097 history snapshot, preserving null verification/checksum values as unknown. Import never verifies media bytes or claims that a Drive file exists now (`mediaBytesVerified: 0`). Migration 0099 enforces append-only history against UPDATE, DELETE and TRUNCATE; INSERT and duplicate INSERT ON CONFLICT DO NOTHING remain supported. The migration runner includes 0099 after 0098.

Aggregate results include applied branding/storage counts, archive-owned storage count, Drive snapshot count, unsupported column count, absent-source table names and missing-target table counts. Missing target tables remain unapplied in the protected bundle. Keep that bundle until audited archival retention is established.

The updated exporter includes characters bound to selected channels or referenced by selected thumbnail persona/image paths, all their character images (original paths, poses and cycle ordering), and scoped channel bindings. Asset import requires a NEW protected snapshot with the character-closure marker; the earlier snapshot remains untouched. No credential/media payload enters local Git or logs. Source metadata-only inspection found three tutorial-channel characters with zero model-sheet/archetype references. Unusual non-null legacy model-sheet/archetype references are retained in dependency tables in the protected bundle but cause import to fail pending expanded dependency handling; they are never silently nulled. Missing source/target character tables are reported explicitly.

Workers, storage retention and upload scanners must remain stopped throughout rehearsal and acceptance. Import does not copy source system storage settings or enable automatic processing.
