# Verified tutorial cache eviction — implementation awaiting rollout review

The new storage service is **not wired to any worker, interval, route or startup**.
The legacy tutorial-retention watchdog remains forced dry-run. Neither this source
change nor the offline tests authorize enabling deletion on a live server.

The service is `packages/storage/src/verified-cache-eviction.ts`.
`runVerifiedTutorialCacheSweep` is a bounded explicit one-shot entry point;
`evictVerifiedTutorialCache` is its single-file, independently tested core.
No Drive upload, replacement, deletion, or database archive-receipt mutation occurs.
There is no recursive directory cleanup.

## Gates

- NEW `TUTORIAL_VERIFIED_CACHE_EVICTION_ENABLED=true` is required. Default disabled.
  Inherited `TUTORIAL_RETENTION_ENABLED` has no effect.
- `TUTORIAL_VERIFIED_CACHE_RETENTION_HOURS` defaults to 24, minimum 1.
  Both completed-at and local file mtime must be older than the retention cutoff.
- Only `final_video` is admitted. Raw recordings, selected thumbnails and all other
  kinds remain hard-disabled until their entire consumer/restore surface is audited.
- Caller supplies explicit canonical allowed roots, a positive file-size cap, and
  `serviceOwnedRoots: true`. These must be private service-owned directories.
  Node cannot make path traversal plus unlink atomic against a hostile actor
  replacing ancestor directories; arbitrary user-writable roots are not supported.
- Default batch 20; maximum 100. Invalid safety options retain files.

## Proof before each unlink

1. Validate the absolute, non-root target under canonical roots; reject traversal,
   symlink/junction ancestors and non-file targets.
2. Acquire PostgreSQL transaction-scoped `pg_try_advisory_xact_lock` on the exact
   same `tutorial-media:<canonical-path>` key as materializing consumers.
   A held lease skips immediately. Never wait on a consumer lock cycle.
3. On the same pinned transaction, acquire job and artifact row locks with
   `FOR UPDATE SKIP LOCKED`. Confirm current job is still COMPLETED, old enough,
   and references the candidate final path.
4. Require one exact uploaded tutorial-owner/job/kind/current-path receipt with
   positive size, SHA256, verified timestamp and Drive ID.
5. Open the local regular file without following symlinks where supported.
   Reject hard links, empty/oversized/recent files. Hash SHA256 and MD5 through
   that descriptor and match the receipt's current bytes.
6. Read fresh metadata by the exact Drive ID. Require explicitly not trashed,
   matching size, and matching Drive SHA256 or MD5. Missing hashes, remote outage,
   wrong ID or any present mismatching digest retain the local file.
7. Re-read job/receipt under the held locks. Rehash local bytes, compare inode,
   device, size, mtime, ctime and link count, revalidate ancestors, then compare
   the path's current lstat identity to the open descriptor.
8. Unlink that one exact file while all locks remain held. Never touch its Drive
   revision, archive receipt, job state, neighboring files or directories.

Failure results are sanitized reason codes, not paths, credentials or raw remote
errors. Successful eviction reports bytes freed. Restoration remains the existing
leased materializer's responsibility using the unchanged archive receipt.

## Evidence and rollout constraints

38 offline tests use fake remote/DB ports and actual isolated temporary files:
disabled legacy-only settings, exact success, SHA/MD5, unsupported kinds,
unfinished/young jobs, missing/mismatched receipt, missing/trashed/changed remote,
held locks, same-size byte mutation, inode replacement, job race, hard links,
symlink/junction ancestors, traversal/root rejection, pinned TRY-lock key and
SKIP LOCKED row rechecks. Only those test-owned files were removed.

Storage TypeScript build passes. There has been no live Drive verification,
live deletion, background invocation or deployment of this service. Before any
opt-in: audit final-video consumers and writers for the shared canonical lease,
review service-owned directory permissions, run a staging integration rehearsal,
and build/deploy a new image explicitly containing this source. The concurrently
built candidate2 image must not be assumed to contain this implementation.
