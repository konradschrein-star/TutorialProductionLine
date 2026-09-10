# Empty media-directory preparation

`scripts/migration/prepare-media-directories.mjs` reads a private JSON array of artifact paths on stdin. It must run on Linux as UID1000 with the staging media bind mounted at `/opt/content-forge/media`. It has no database/provider access and never creates or changes media files.

Default invocation is dry-run. Explicit mutation requires `--create-empty-directories EXACT_REVIEWED_PLAN_HASH`; the current filesystem is replanned and a changed hash aborts. Directory creation uses individual nonrecursive mkdir calls with mode0700; existing directories are never chmod/chowned. Symlinks, non-directory ancestors, traversal, noncanonical paths, other roots, depth>24, >50,000 input paths and >100,000 directories are rejected. A blocked path prevents the entire apply operation. Recheck ancestors immediately before each mkdir. Run during controlled migration without a concurrent directory mover; Node's pathname API is not a substitute for Linux openat2 against a malicious same-UID process.

The exact read-only source for this migration is the existing staging DB:

```sql
BEGIN READ ONLY;
SELECT coalesce(json_agg(a.vps_path ORDER BY a.vps_path),'[]')
FROM storage_artifacts a JOIN tutorial_jobs j ON j.id=a.job_id
WHERE a.owner_kind='tutorial_job'
  AND a.kind IN ('thumbnail','final_video') AND a.vps_path IS NOT NULL;
COMMIT;
```

Use fixed container `tutorial-recovery-staging-postgres-1`, database `tutorial_staging_cf_20260908`, user `tutorial_staging`. Keep resulting paths private: pipe them in memory into the existing web container as UID1000 or retain them in a protected server file. Do not print JSON paths or copy them to OneDrive. This selects mapped existing artifact references only; it does not invent folders from every historical archive row.

Actual dry-run in existing `tutorial-recovery-staging-web-1`: **3,094 safe paths, 3 existing directories, 3,093 planned directories, zero blocked paths/directories**. Plan hash: `3791e37f75ca4aa68a20600efb01928d24313e6ee75af9b1c8ab7036873ced88`. Created directories: zero. Database writes: zero. Re-run after any independently created directory; the reviewed hash deliberately changes with the existing/planned set.

Creating this skeleton does not mean media exists locally, is verified or is approved. It merely supplies safe parent directories for the existing exact-byte materializer. No Drive restore, public upload, retention change or materializer guard relaxation is part of this operation.
