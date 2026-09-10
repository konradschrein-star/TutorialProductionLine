# Preserve the five local English originals to Drive

This is a bounded **copy-only recovery tool**, not a production uploader. Source
inspection on 9 September found five explicit completed English originals still
local among the recorded Drive exceptions, totaling **58,224,531 bytes**. That
count is not a fresh checksum verification. No real upload has been run by this
implementation task.

## Authority and receipt target

- Run only on the verified Content Forge source host, not Windows/OneDrive/VPS2.
- The operator supplies exactly five explicit UUIDs in a private JSON array and
  an **existing destination folder ID** in the expected owner's My Drive. The
  command does not choose or create a folder. No sharing or permission changes.
- Default preflight reads source rows using a read-only PostgreSQL transaction,
  validates regular nonsymlink single-link files under the tutorial media root,
  hashes SHA256/MD5 with stable inode/stat checks, checks source revision again,
  and verifies OAuth owner, destination ownership/write capability, and capacity.
- Source rows, titles and credentials never go to stdout. Private manifests and
  receipts stay in an owner-only `/var/tmp/tutorial-migration-*` directory (0700),
  files0600. The manifest also contains private paths. Never copy these into Git,
  OneDrive or chat.
- **Receipt destination is a source-side append-only JSONL ledger**, not the live
  database. This needs no production migration. Entries bind manifest SHA, exact
  tutorial UUID, exact Drive ID, source SHA/size, sequence, timestamp and previous
  record hash. Resumable session URLs are sensitive and appear only in this ledger.
- No production settings/status/approval/scheduling/dispatch/database rows change.
  No QA gate is used: a defective original still deserves preservation.

## Build and prepare

Bundle `scripts/migration/preserve-english-finals-cli.ts` as Node ESM `.mjs` using
the repository's esbuild installation, `--bundle --platform=node --format=esm
--packages=external`. The resulting bundle imports only Node builtins; dotenv is
resolved explicitly from the existing source installation at runtime. Copy code
only over the already verified SSH alias. The source must provide its existing
Docker/psql, Node, dotenv, and OAuth config; never export credentials locally.

Create a fresh protected directory and private JSON UUID array on the source.
The reviewed five UUIDs are available from the read-only source audit; do not
replace this allowlist with an unbounded job query. Preflight fails if membership,
completion, original/English classification, files, revisions or ownership differ.

```sh
node /private-code/preserve-english-finals-cli.mjs \
  --allowlist /var/tmp/tutorial-migration-preserve/allowlist.json \
  --folder-id EXISTING_APPROVED_DRIVE_FOLDER_ID \
  --out /var/tmp/tutorial-migration-preserve/manifest-v1.json
```

`--out` is exclusive-create; it never overwrites a prior manifest. Record the
aggregate counts, byte total and manifest SHA returned. First inspect these and
confirm the intended destination before execution. No Drive writes occur above.

Revalidate the exact manifest without uploading:

```sh
node /private-code/preserve-english-finals-cli.mjs \
  --manifest /var/tmp/tutorial-migration-preserve/manifest-v1.json \
  --sha256 EXACT_PREFLIGHT_SHA256
```

## Explicit preservation execution — operator only

```sh
node /private-code/preserve-english-finals-cli.mjs \
  --manifest /var/tmp/tutorial-migration-preserve/manifest-v1.json \
  --sha256 EXACT_PREFLIGHT_SHA256 \
  --receipts /var/tmp/tutorial-migration-preserve/receipts-v1.jsonl \
  --execute-preservation --confirm-count 5
```

This writes only new Drive objects (or verifies exact existing ones) and appends
private receipts. Filenames use UUIDs, not private titles. Uploads are sequential,
8MiB chunks, reuse the existing Drive client's authenticated resumable operations,
and store intent before creation and session before streaming. Every chunk checks
source stat identity and streams from a pinned `O_NOFOLLOW` descriptor via Linux
`/proc/self/fd`, not a pathname that can be replaced after inspection. Ancestors
must not be writable by group/others. Successful objects undergo an actual full remote-byte
SHA256 readback, plus fresh local hashes and source-row revision recheck, before
`verified` is recorded. No local media is rewritten or removed.

No blind retry follows an uncertain create. Re-running with the same manifest
and ledger resumes known sessions or verifies known exact IDs. Missing/ambiguous
object identity, expired sessions, changed source or partial ledgers stop that
file for explicit reconciliation. Unverified remote objects remain untouched.
Exact existing objects can be reused from another folder: the manifest's folder
is the requested destination for new objects, not proof of an existing object's
parent. Resolve parents by exact Drive ID during the separate receipt import.
Exit2 means at least one file remains uncertain; exit1 means preflight/setup
stopped. Aggregate output never claims database import or team cutover.

An exclusive `.lock` file prevents concurrent ledger writers. If a process dies,
first confirm no preservation process is alive, inspect the private ledger, then
explicitly remove only that stale lock. Never remove a live process's lock.

## After successful preservation

1. Require all five exact files `verified`, plus expected summed bytes. Keep the
   manifest, ledger and all source media.
2. Review/import ledger identities into staging `storage_artifacts` and immutable
   `storage_artifact_versions` through a separate audited migration; this CLI does
   **not** make Studio's Drive badges true. Import must preserve original source
   path/job identity and distinguish archive-only historical jobs from runtime.
3. Exercise exact-ID restoration on staging using the preserved revision and
   compare SHA/size. Do not imply this proves all historical media restored.
4. Keep retention/eviction disabled. No permission to delete follows from copying.

Tests: `pnpm exec tsx --test scripts/migration/__tests__/preserve-english-finals.test.ts`.
They cover strict selection, account/capacity guards, durable-intent sequencing,
exact-ID repeat verification, uncertain creation, session resumption, changed
source/corrupt remote bytes, and credential-safe session URLs. Test ports are fake;
the real source check performed during implementation was read-only.
