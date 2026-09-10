import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { tutorialJobs, tutorialSourceRevision, type DrizzleClient } from "@repo/db";
import { fingerprintStorageSource, withTutorialMedia } from "@repo/storage";
import { runVideoQaGate, SCREEN_RECORDING_QA_THRESHOLDS } from "@repo/media-core";

export const TUTORIAL_QA_VERSION = "tutorial-output-qa/1";
type InputState = { recordingPath: string | null; audioPath: string | null; recordedAt: string | null; scriptDigest: string };
type Identity = { version: string; sourceRevision: string; completedAt: string; sha256: string; bytes: number; finalPath: string } & Partial<InputState>;
type Verdict = Awaited<ReturnType<typeof runVideoQaGate>>;
export async function measureExactTutorialOutput(input: { path: string; sourceRevision: string; completedAt: string; previous: unknown; previousStatus: string | null; inputState?: InputState }, ports = { fingerprint: fingerprintStorageSource, measure: (path: string) => runVideoQaGate(path, { requireAudio: true }, SCREEN_RECORDING_QA_THRESHOLDS) }) {
  const before = await ports.fingerprint(input.path);
  const identity: Identity = { version: TUTORIAL_QA_VERSION, sourceRevision: input.sourceRevision, completedAt: input.completedAt, sha256: before.sha256, bytes: before.bytes, finalPath: input.path, ...input.inputState };
  const previous = input.previous as { identity?: Identity; checks?: unknown[] } | null;
  if (["passed", "failed"].includes(input.previousStatus ?? "") && previous?.identity && (Object.keys(identity) as Array<keyof Identity>).every(key => previous.identity![key] === identity[key]) && Array.isArray(previous.checks) && previous.checks.length > 0) return { cached: true as const, status: input.previousStatus!, detail: input.previous };
  const verdict: Verdict = await ports.measure(input.path);
  const after = await ports.fingerprint(input.path);
  if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) throw new Error("Output changed during QA; measurement discarded");
  return { cached: false as const, status: verdict.passed ? "passed" : "failed", detail: { identity, summary: verdict.summary, checks: verdict.checks.map(check => ({ id: check.id, status: check.status, detail: check.detail, ...(check.measured ?? {}) })) } };
}

/** Local files only: no Drive/provider calls, no historical sweep, no status promotion.
 * Same advisory media lock as consumers/retention. Reads use its pinned tx;
 * revision-conditional writes occur after releasing media locks.
 * Failures are isolated from rendering and remain explicitly unverified.
 */
export async function ensureTutorialOutputQa(db: DrizzleClient, jobId: string, mediaRoot = process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media"): Promise<"passed" | "failed" | "unverified"> {
  let observed: { path: string; completedAt: Date } | undefined;
  try {
    const [initial] = await db.select().from(tutorialJobs).where(eq(tutorialJobs.id, jobId));
    if (!initial?.final_path || initial.status !== "COMPLETED" || !initial.completed_at) return "unverified";
    observed = { path: initial.final_path, completedAt: initial.completed_at };
    const measured = await db.transaction(async tx => withTutorialMedia(db, { jobId, kind: null, path: initial.final_path! }, { allowedRoots: [mediaRoot], maxBytes: 8 * 1024 ** 3, transaction: tx }, async path => {
      const [current] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, jobId));
      if (!current || current.status !== "COMPLETED" || current.final_path !== initial.final_path || current.completed_at?.getTime() !== initial.completed_at!.getTime()) return null;
      const result = await measureExactTutorialOutput({ path, sourceRevision: tutorialSourceRevision(current), completedAt: current.completed_at!.toISOString(), previous: current.output_qa_detail, previousStatus: current.output_qa_status, inputState: { recordingPath: current.recording_path, audioPath: current.audio_path, recordedAt: current.recorded_at?.toISOString() ?? null, scriptDigest: createHash("md5").update(current.script_text ?? "").digest("hex") } }).catch(() => ({ cached: false, status: null, detail: { summary: "Automated output checks unavailable; retry required", checks: [] } }));
      return { current, result, path };
    }));
    if (!measured) return "unverified";
    const { current, result, path } = measured;
    // Release media locks BEFORE touching the job row: publication takes job
    // then media locks. Atomic input predicates replace the inverse lock order.
    const saved = await db.update(tutorialJobs).set({ output_qa_status: result.status, output_qa_detail: result.detail, output_qa_checked_at: result.cached ? current.output_qa_checked_at : new Date() }).where(and(
      eq(tutorialJobs.id, jobId), eq(tutorialJobs.status, "COMPLETED"),
      eq(tutorialJobs.final_path, path), eq(tutorialJobs.completed_at, current.completed_at!),
      current.recording_path === null ? isNull(tutorialJobs.recording_path) : eq(tutorialJobs.recording_path, current.recording_path),
      current.audio_path === null ? isNull(tutorialJobs.audio_path) : eq(tutorialJobs.audio_path, current.audio_path),
      current.script_text === null ? isNull(tutorialJobs.script_text) : eq(tutorialJobs.script_text, current.script_text),
      current.recorded_at === null ? isNull(tutorialJobs.recorded_at) : eq(tutorialJobs.recorded_at, current.recorded_at),
    )).returning({ id: tutorialJobs.id });
    if (!saved.length) return "unverified";
    return result.status === "passed" ? "passed" : result.status === "failed" ? "failed" : "unverified";
  } catch {
    if (observed) {
      // Do not leave an older green badge on a currently unavailable output.
      // Never overwrite a newer render's evidence after a failed lease/read.
      await db.update(tutorialJobs).set({ output_qa_status: null, output_qa_detail: { summary: "Local output unavailable for automated checks", checks: [] }, output_qa_checked_at: new Date() }).where(and(eq(tutorialJobs.id, jobId), eq(tutorialJobs.final_path, observed.path), eq(tutorialJobs.completed_at, observed.completedAt))).catch(() => undefined);
    }
    // No raw FFmpeg errors/file paths in logs. No fake failure of a valid render.
    console.warn(JSON.stringify({ message: "Tutorial output QA unavailable; remains unverified", jobId }));
    return "unverified";
  }
}
