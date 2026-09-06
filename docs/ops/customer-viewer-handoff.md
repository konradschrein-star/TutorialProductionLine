# Customer viewer handoff

Before starting the updated services on the VPS, apply the idempotent ship migrations and create/backfill the six-language manual thumbnail sets:

```bash
pnpm --filter @repo/db migrate:tutorial-ship
FORCE_RENDER=1 pnpm --filter @repo/worker-orchestrator backfill:manual-thumbnails
pnpm --filter @repo/hub-web build
```

The backfill only targets completed English source tutorials with a final video. It is safe to rerun; `FORCE_RENDER=1` deliberately replaces the rendered files while retaining the language-scoped records.

The viewer account can navigate the product but is centrally blocked from all non-GET API requests. Do not commit its password.

On the deployed VPS, set temporary shell environment variables and run:

```bash
export TUTORIAL_VIEWER_EMAIL='friend@example.com'
export TUTORIAL_VIEWER_NAME='Omar Viewer'
export TUTORIAL_VIEWER_PASSWORD='replace-with-a-unique-strong-password'
pnpm --filter @repo/db create:tutorial-viewer
unset TUTORIAL_VIEWER_PASSWORD
```

Send the URL, email, and password through a private channel. Ask the viewer to use a desktop browser. Rotate or deactivate the account after the evaluation window.

## Friend-operated settings

After the initial deployment, an administrator can maintain the following without opening the repository or editing `.env`:

- Script, voice, Drive, alert, and uploader credentials under **Settings → Connections & API keys**.
- Google Drive consent through **Connect Google Drive**. Add the callback URI shown by the deployment (`/api/storage/drive/oauth/callback`) to the OAuth application first.
- Drive enablement, folder names, scan interval, batch size, and daily budget.
- Uploader endpoint, method, pacing, scheduling timezone, visibility, retries, and release policy.
- A one-click health pass across Postgres, Redis, script generation, TTS, Drive, and uploader connectivity.

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY`, and `LOCAL_MEDIA_ROOT` remain bootstrap infrastructure settings. They intentionally cannot be changed by a logged-in browser session.

## Uploader contract

Create the uploader connection token in Settings. It authenticates three machine endpoints:

```dotenv
Authorization: Bearer <shared-random-secret>
```

- `GET /api/production/uploader-config` returns non-secret safety, scheduling, and pacing controls.
- `GET /api/production/uploader-jobs` returns a read-only manifest of Drive-delivered jobs and explicit blockers. It cannot claim or start a job.
- `POST /api/production/uploader-status` accepts idempotent status events containing `eventId`, `jobId`, `status`, optional `visibility`, `scheduledFor`, `youtubeVideoId`, `youtubeUrl`, `uploaderJobId`, and `occurredAt`.

The default is `enabled=false`, `executionMode=dry_run`, one concurrent transfer, and manual release required. Saving uploader settings does not start an upload. Live execution should use YouTube's supported OAuth/Data API and resumable upload flow; the Studio does not implement anti-detection or platform-evasion behavior.
