import { storageError } from "../errors.js";
import {
  nextDelayMs,
  shouldRetry,
  realRetryDeps,
  type Attempt,
  type BackoffOptions,
  type RetryDeps,
} from "../retry.js";
import type { DriveClient, DriveFile } from "./client.js";

/**
 * Drive resumable upload driver.
 *
 * Chunk uploads cannot go through the generic retry helper: a chunk body is a
 * file stream, and a consumed stream cannot be replayed. So on a retryable
 * failure we re-ask the server for its offset and re-read from disk at that
 * offset. That is also what makes this survive a process restart — the caller
 * persists `sessionUri` and we pick up exactly where Drive says we stopped.
 */

export interface ResumableUploadArgs {
  localPath: string;
  totalBytes: number;
  /** Existing session URI to resume, if we have one persisted. */
  sessionUri?: string | undefined;
  filename: string;
  parentId: string;
  mimeType: string;
  jobId: string;
  kind: string;
  sourceSha256?: string;
  chunkSizeBytes: number;
  /** Persist a newly created session URI / progress so a restart can resume. */
  onProgress?: (info: {
    sessionUri: string;
    bytesUploaded: number;
    totalBytes: number;
  }) => Promise<void> | void;
}

export async function resumableUpload(
  client: DriveClient,
  args: ResumableUploadArgs,
  backoff: BackoffOptions,
  deps: RetryDeps = realRetryDeps,
): Promise<Attempt<DriveFile>> {
  if (args.totalBytes <= 0) {
    return {
      ok: false,
      error: storageError("local_file", `${args.localPath} is empty (0 bytes)`),
    };
  }

  let sessionUri = args.sessionUri;
  let offset = 0;

  if (sessionUri !== undefined) {
    const resumed = await client.queryResumableOffset(
      sessionUri,
      args.totalBytes,
    );
    if (resumed.ok) {
      if (resumed.value === "complete") {
        // The final chunk landed but we crashed before recording it. Find the
        // file rather than re-uploading a few hundred MB.
        const existing = await client.findExistingArtifact(
          args.jobId,
          args.kind,
          args.sourceSha256,
        );
        if (!existing.ok) return existing;
        if (existing.value !== null) return { ok: true, value: existing.value };
        // Session says complete but no file is findable — start over.
        sessionUri = undefined;
      } else {
        offset = resumed.value;
      }
    } else if (resumed.error.kind === "not_found") {
      // Expired session (Drive keeps them ~1 week). Start a fresh one.
      sessionUri = undefined;
    } else {
      return resumed;
    }
  }

  if (sessionUri === undefined) {
    const created = await client.createResumableSession({
      filename: args.filename,
      parentId: args.parentId,
      mimeType: args.mimeType,
      sizeBytes: args.totalBytes,
      jobId: args.jobId,
      kind: args.kind,
      ...(args.sourceSha256 ? { sourceSha256: args.sourceSha256 } : {}),
    });
    if (!created.ok) return created;
    sessionUri = created.value;
    offset = 0;
    await args.onProgress?.({
      sessionUri,
      bytesUploaded: 0,
      totalBytes: args.totalBytes,
    });
  }

  let attempt = 1;

  while (offset < args.totalBytes) {
    const end = Math.min(offset + args.chunkSizeBytes, args.totalBytes) - 1;

    const result = await client.uploadChunk({
      sessionUri,
      localPath: args.localPath,
      start: offset,
      end,
      totalBytes: args.totalBytes,
    });

    if (result.ok) {
      attempt = 1;
      if (result.value.done) {
        await args.onProgress?.({
          sessionUri,
          bytesUploaded: args.totalBytes,
          totalBytes: args.totalBytes,
        });
        return { ok: true, value: result.value.file };
      }
      offset = result.value.nextOffset;
      await args.onProgress?.({
        sessionUri,
        bytesUploaded: offset,
        totalBytes: args.totalBytes,
      });
      continue;
    }

    if (!shouldRetry(attempt, result.error, backoff)) {
      return result;
    }

    const delay = nextDelayMs(attempt, result.error, backoff, deps.rng);
    deps.onRetry?.({ attempt, delayMs: delay, error: result.error });
    await deps.sleep(delay);
    attempt += 1;

    // Re-sync with the server before re-sending: it may have accepted part of
    // the chunk we thought failed. Trusting our own offset here is how you get
    // corrupt files.
    const resync = await client.queryResumableOffset(
      sessionUri,
      args.totalBytes,
    );
    if (!resync.ok) {
      if (resync.error.kind === "not_found") {
        return {
          ok: false,
          error: storageError(
            "not_found",
            "resumable session disappeared mid-upload; will restart on next run",
          ),
        };
      }
      return resync;
    }
    if (resync.value === "complete") {
      const existing = await client.findExistingArtifact(args.jobId, args.kind, args.sourceSha256);
      if (!existing.ok) return existing;
      if (existing.value !== null) return { ok: true, value: existing.value };
      return {
        ok: false,
        error: storageError(
          "unknown",
          "Drive reported the upload complete but the file could not be found",
        ),
      };
    }
    offset = resync.value;
  }

  // Loop exited without a "done" response — should be unreachable, but never
  // report success we did not observe.
  return {
    ok: false,
    error: storageError(
      "unknown",
      `upload of ${args.localPath} reached ${offset}/${args.totalBytes} bytes without a completion response`,
    ),
  };
}
