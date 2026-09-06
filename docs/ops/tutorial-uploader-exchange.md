# Tutorial Studio to uploader exchange

Tutorial Studio and the uploader remain separate applications. Their only
shared boundary is the versioned `tutorial-uploader-job/1` / receipt JSON
protocol transported through two app-owned Google Drive folders. This does not
use the YouTube Data API.

## Automatic language scope

English is the source tutorial. Unattended translation is compiled to exactly
four targets: German (`de`), French (`fr`), Italian (`it`), and Swedish (`sv`).
Together with English, these are the five production channels. The automatic
API and batch tooling cannot widen that set through browser storage or
environment variables. Other languages remain
available only as explicit, single-language manual translations.

Each Studio channel also needs an explicit `uploader_channel_key` matching the
isolated profile key configured in the uploader (for example `tutorial_usa`).
A blank mapping blocks dispatch. Studio never guesses a destination from a
language, YouTube channel id, name, or handle.

## Tutorial Studio configuration

The exchange publisher uses the same OAuth-backed Drive client as finished-job
delivery and additionally requires:

```text
TUTORIAL_EXCHANGE_DRIVE_INBOX_ID=<app-owned inbox folder id>
TUTORIAL_EXCHANGE_DRIVE_RECEIPT_FOLDER_ID=<app-owned receipt folder id>
TUTORIAL_EXCHANGE_BATCH_SIZE=10                 # optional
TUTORIAL_EXCHANGE_MAX_JOB_BYTES=34359738368     # optional, 32 GiB
TUTORIAL_EXCHANGE_POLL_INTERVAL_MS=15000         # optional, minimum 5000
```

Folder identifiers and OAuth credentials stay in deployment configuration;
they are never written into job JSON, receipts, application logs, or the
Tutorial Studio database.

Apply migrations `0085_tutorial_uploader_exchange.sql` and
`0086_channel_uploader_mapping.sql` out of band before deploying this code,
following this repository's current production migration runbook.

## Dispatch and state model

An authorized operator queues one language variant from **Tutorial Studio →
Uploads**. Dispatch fails closed unless all of these are true:

- the tutorial variant is complete and has nonempty localized title,
  description, and tags;
- the final MP4 exists and is nonempty;
- exactly one completed thumbnail is selected and its rendered file exists;
- the channel has an explicit uploader profile key;
- the operator explicitly declares private/unlisted visibility, audience, and
  monetization; monetization `on` also requires the per-video no-sensitive-
  content suitability attestation.

The dispatch row snapshots the exact video path, thumbnail row, thumbnail path,
metadata, destination, and declarations. Later selection or metadata changes
cannot silently alter that request. A repeated click returns the original
dispatch rather than creating a second upload.

The Drive publisher validates and hashes both local assets before creating any
remote object. It writes the video and thumbnail first and `job.json` last.
That marker is immutable and makes the folder ready for the separate uploader.
Retries compare exact sizes, SHA-256 digests, canonical manifest bytes, and the
stored revision identity.

Uploader receipts are ingested as an append-only, contiguous journal. Tutorial
Studio advances its projection only when identity, manifest hash, deterministic
filename, receipt bytes, and sequence all agree. `uncertain` is terminal and
requires operator reconciliation; it is never retried as though nothing might
have happened. Only a verified `succeeded` receipt that names every requested
attribute plus `thumbnail` marks `tutorial_jobs.is_uploaded` and stores the
observed YouTube URL.

## Activation checklist

1. Deploy the two database migrations and application build.
2. Configure both Drive folder ids and verify the existing OAuth Drive health.
3. Map only the English channel to its uploader profile for the first canary.
4. Queue one private video with its exact selected thumbnail.
5. Verify the immutable Drive job bundle is materialized by the uploader.
6. Verify the saved-page readback receipt appears in Tutorial Studio and the
   exact thumbnail/metadata are present on the private YouTube video.
7. Add the remaining channel mappings after their isolated sessions exist.
8. Arm the uploader's hourly scheduler only after the canary passes.

Until steps 1–6 pass, the connector is code-complete but deliberately unarmed;
it must not be described as a live autonomous uploader.
