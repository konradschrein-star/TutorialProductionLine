# Omar: sixteen English outputs, archive only

Prepared, not uploaded. Source production database, QA, delivery flags, and distribution inbox remain untouched.

Protected source manifest: `/var/tmp/omar-english-archive-Kfwm1O/manifest.json`.
SHA256: `6d82c6496630db90dfba341363c25818879b1dd58df5ac066d7bc00b8b42a07d`.
Sixteen files, 134,989,032 bytes: five QA-failed and eleven unmeasured. Manifest retains original basename, exact job ID, full SHA256/MD5, inode/stat token, and source-row revision.

Verified destination owner is the requested account. Existing `_Tutorials` parent: `1cztfSoY3vjFoHHfPQHccAGn6P797sHaL`. Execution will create one separate folder named `Recovery archive - Omar English - NOT APPROVED - 20260909`; it is not an upload bundle or distribution inbox. Files retain their original basename with job ID and NOT-APPROVED/QA classification prefixes. Drive artifact kind is `recovery_unapproved_final`, deliberately distinct from production final_video deduplication.

`scripts/migration/omar-english-archive-preflight.ts` creates an exclusive root-private manifest, hashing source bytes through O_NOFOLLOW and checking database revisions before/after. It contains no upload mode.

`scripts/migration/omar-english-archive-execute.ts` defaults to read-only rehearsal. The only execution flag is `--execute-reviewed-sixteen`, requiring the exact protected manifest and hash embedded in this singleton operation. Do not execute until root reviews and authorizes. Bundle as ESM, run only on `tutorial-vps`; no media/credential/ledger payload belongs on the local workstation.

Execution verifies identity and capacity, acquires an exclusive private ledger lock, fsyncs an intent before every create, uses DriveClient maxAttempts=1, and rechecks source revisions and stable bytes. Every uploaded object is read back for full SHA256/size/MD5 with metadata-version and parent fences. No database writes or cleanup occur. Folder creation acknowledgment loss leaves `folder_intent` and blocks automatic recreation. File acknowledgment loss uses preserveOne's durable receipt/session reconciliation; never delete the ledger or start a fresh manifest to bypass uncertainty. The hash-chained 0600 ledger can contain credential-bearing session URIs and must never be printed.

The folder is created without new permission grants; existing Drive permission inheritance remains applicable. Do not claim a new ACL boundary. Root must separately approve any later storage pointer/immutable receipt import; this archive command does not mark files delivered, approve QA, or make them eligible for publication.
