import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { storageArtifacts, tutorialJobs, type DrizzleClient } from "@repo/db";
import { validateMediaTarget } from "./materializer.js";
import { DriveClient, type DriveFile } from "./drive/client.js";
import { loadStorageConfigFromDatabase } from "./runtime-config.js";

/** Deliberately final-video only. Raw/thumbnail consumers have not all been
 * certified for restore. Adding their names here requires a separate review. */
export interface CacheCandidate { jobId: string; kind: string; path: string }
export interface CacheSnapshot {
  jobId: string; status: string; completedAt: Date | null; currentPath: string | null;
  receipt: null | { ownerKind: string; jobId: string; kind: string; path: string;
    state: string; sha256: string | null; size: number | null; verifiedAt: Date | null; driveId: string | null };
}
export interface CacheLeaseContext {
  /** Reads on the SAME transaction that holds path + job + artifact row locks. */
  snapshot(): Promise<CacheSnapshot | null>;
  remote(fileId: string): Promise<DriveFile | null>;
}
export interface CacheEvictionPorts {
  /** Non-blocking path advisory TRY lock, then job/artifact SKIP LOCKED row
   * locks. Return null when any lock is held. Never wait on a consumer cycle. */
  tryLease<T>(canonicalPath: string, candidate: CacheCandidate, work: (context: CacheLeaseContext) => Promise<T>): Promise<T | null>;
}
export interface CacheEvictionOptions {
  allowedRoots: readonly string[];
  /** Required operational assertion: no untrusted actor can replace ancestors.
   * Node cannot provide openat2/unlinkat atomic protection against hostile dirs. */
  serviceOwnedRoots: true;
  maxBytes: number;
  retentionHours?: number;
  now?: number;
  env?: Record<string, string | undefined>;
}
export interface CacheEvictionResult {
  outcome: "evicted" | "retained";
  reason: string;
  bytesFreed: number;
}
const kept = (reason: string): CacheEvictionResult => ({ outcome: "retained", reason, bytesFreed: 0 });
const unchanged = (a: Stats, b: Stats) => a.isFile() && b.isFile() && a.nlink === 1 && b.nlink === 1
  && a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const eligible = (candidate: CacheCandidate, state: CacheSnapshot | null, cutoff: number): state is CacheSnapshot =>
  !!state && state.jobId === candidate.jobId && state.status === "COMPLETED"
  && !!state.completedAt && Number.isFinite(state.completedAt.getTime()) && state.completedAt.getTime() <= cutoff
  && state.currentPath === candidate.path;
const exactReceipt = (candidate: CacheCandidate, state: CacheSnapshot, now: number) => {
  const r = state.receipt;
  return !!r && r.ownerKind === "tutorial_job" && r.jobId === candidate.jobId && r.kind === candidate.kind
    && r.path === candidate.path && r.state === "uploaded" && !!r.driveId
    && !!r.verifiedAt && Number.isFinite(r.verifiedAt.getTime()) && r.verifiedAt.getTime() <= now
    && !!r.sha256 && /^[a-f0-9]{64}$/i.test(r.sha256) && Number.isSafeInteger(r.size) && r.size! > 0;
};

/** One file, no recursion, no Drive write/delete, no database receipt mutation.
 * Fail closed on every unrecognized state. Not scheduled/wired by this module. */
export async function evictVerifiedTutorialCache(candidate: CacheCandidate, ports: CacheEvictionPorts, options: CacheEvictionOptions): Promise<CacheEvictionResult> {
  if ((options.env ?? process.env)["TUTORIAL_VERIFIED_CACHE_EVICTION_ENABLED"] !== "true") return kept("disabled");
  if (candidate.kind !== "final_video") return kept("consumer-restore-not-certified");
  const now = options.now ?? Date.now();
  const hours = options.retentionHours ?? Number((options.env ?? process.env)["TUTORIAL_VERIFIED_CACHE_RETENTION_HOURS"] ?? 24);
  if (options.serviceOwnedRoots !== true || !Number.isFinite(now) || !Number.isFinite(hours) || hours < 1
    || !Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) return kept("invalid-safety-options");
  const cutoff = now - hours * 3600000;
  try {
    const path = await validateMediaTarget(candidate.path, options.allowedRoots);
    const result = await ports.tryLease(path, candidate, async context => {
      const state = await context.snapshot();
      if (!eligible(candidate, state, cutoff)) return kept("job-not-current-completed");
      if (!exactReceipt(candidate, state, now)) return kept("missing-exact-verified-receipt");
      const receipt = state.receipt!;
      await validateMediaTarget(path, options.allowedRoots);
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > options.maxBytes
          || before.mtimeMs > cutoff || before.size !== receipt.size) return kept("local-file-not-eligible");
        const digest = async () => {
          const sha = createHash("sha256"), md5 = createHash("md5");
          let count = 0;
          // Explicit start resets the descriptor offset for the second check.
          for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
            count += chunk.length;
            if (count > before.size) throw new Error("local revision changed");
            sha.update(chunk); md5.update(chunk);
          }
          return { size: count, sha: sha.digest("hex"), md5: md5.digest("hex") };
        };
        const local = await digest();
        if (local.sha !== receipt.sha256!.toLowerCase() || local.size !== receipt.size
          || !unchanged(before, await file.stat())) return kept("local-fingerprint-changed");
        // Fresh exact-ID Drive metadata, never a historical upload flag.
        const remote = await context.remote(receipt.driveId!);
        if (!remote || remote.id !== receipt.driveId || remote.trashed !== false
          || Number(remote.size) !== local.size || (!remote.sha256Checksum && !remote.md5Checksum)
          || (remote.sha256Checksum && remote.sha256Checksum.toLowerCase() !== local.sha)
          || (remote.md5Checksum && remote.md5Checksum.toLowerCase() !== local.md5)) return kept("remote-revision-not-verified");
        const latest = await context.snapshot();
        if (!eligible(candidate, latest, cutoff) || !exactReceipt(candidate, latest, now)
          || JSON.stringify(latest) !== JSON.stringify(state)) return kept("job-or-receipt-changed");
        const final = await digest();
        if (final.sha !== local.sha || final.md5 !== local.md5 || final.size !== local.size
          || !unchanged(before, await file.stat())) return kept("local-fingerprint-changed");
        await validateMediaTarget(path, options.allowedRoots);
        if (!unchanged(before, await lstat(path))) return kept("path-identity-changed");
        await unlink(path);
        return { outcome: "evicted" as const, reason: "exact-remote-revision-verified", bytesFreed: local.size };
      } finally { await file.close(); }
    });
    return result ?? kept("active-consumer-or-row-lock");
  } catch {
    // No raw paths, config, tokens or remote errors in sweep diagnostics.
    return kept("verification-or-filesystem-unavailable");
  }
}

export function createDatabaseCacheEvictionPorts(db: DrizzleClient): CacheEvictionPorts {
  return { tryLease: async (path, candidate, work) => db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`tutorial-media:${path}`}, 0)) as acquired`);
    if ((lock as unknown as Array<{ acquired: boolean }>)[0]?.acquired !== true) return null;
    const read = async (): Promise<CacheSnapshot | null> => {
      const jobs = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, candidate.jobId)).limit(1).for("update", { skipLocked: true });
      if (jobs.length !== 1) return null;
      const job = jobs[0]!;
      // A path reused as raw input is not final-only cache, even on this job.
      if (job.recording_path === candidate.path) return null;
      const receipts = await tx.select().from(storageArtifacts).where(and(
        eq(storageArtifacts.owner_kind, "tutorial_job"), eq(storageArtifacts.job_id, candidate.jobId),
        eq(storageArtifacts.kind, "final_video"), eq(storageArtifacts.vps_path, candidate.path),
      )).limit(2).for("update", { skipLocked: true });
      const r = receipts.length === 1 ? receipts[0]! : null;
      return { jobId: job.id, status: job.status, completedAt: job.completed_at, currentPath: job.final_path,
        receipt: r ? { ownerKind: r.owner_kind, jobId: r.job_id, kind: r.kind, path: r.vps_path, state: r.state,
          sha256: r.checksum_sha256, size: r.bytes, verifiedAt: r.verified_at, driveId: r.drive_file_id } : null };
    };
    return work({ snapshot: read, remote: async id => {
      const config = await loadStorageConfigFromDatabase(tx);
      if (!config.enabled) return null;
      const result = await new DriveClient(config.drive).getFile(id);
      return result.ok ? result.value : null;
    } });
  }) };
}

/** Explicit one-shot entry point only. NO interval/startup registration. */
export async function runVerifiedTutorialCacheSweep(db: DrizzleClient, options: CacheEvictionOptions & { batchSize?: number }): Promise<CacheEvictionResult[]> {
  if ((options.env ?? process.env)["TUTORIAL_VERIFIED_CACHE_EVICTION_ENABLED"] !== "true") return [kept("disabled")];
  const hours = options.retentionHours ?? Number((options.env ?? process.env)["TUTORIAL_VERIFIED_CACHE_RETENTION_HOURS"] ?? 24);
  if (!Number.isFinite(hours) || hours < 1) return [kept("invalid-safety-options")];
  const batch = options.batchSize ?? 20;
  if (!Number.isInteger(batch) || batch < 1 || batch > 100) return [kept("invalid-batch-size")];
  const candidates = await db.select({ jobId: tutorialJobs.id, path: tutorialJobs.final_path }).from(tutorialJobs).where(and(
    eq(tutorialJobs.status, "COMPLETED"), isNotNull(tutorialJobs.completed_at), isNotNull(tutorialJobs.final_path),
    lt(tutorialJobs.completed_at, new Date((options.now ?? Date.now()) - hours * 3600000)),
  )).limit(batch);
  const ports = createDatabaseCacheEvictionPorts(db);
  const results: CacheEvictionResult[] = [];
  for (const candidate of candidates) results.push(await evictVerifiedTutorialCache({ jobId: candidate.jobId, path: candidate.path!, kind: "final_video" }, ports, options));
  return results;
}
