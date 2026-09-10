/** Read-only source inspection. Paths/receipts are PRIVATE manifest data. */
import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute, parse, sep } from "node:path";
import { planTutorialImport } from "./selective-import-plan";
import {
  protectedPath,
  type SourceBundle,
  bundleFingerprint,
} from "./secure-selective-bundle";

type Row = Record<string, any>;
export interface MediaReference {
  path: string;
  reasons: string[];
  receipts: Row[];
  origins: { field: string; status: string; scope: string }[];
}
const BRANDING = [
  "thumbnails",
  "thumbnail_archetypes",
  "thumbnail_bookmarks",
  "channel_thumbnail_profiles",
  "tutorial_background_presets",
  "tutorial_intro_hosts",
  "characters",
  "character_images",
  "character_dependency_assets",
  "channels",
  "tutorial_settings",
  "tts_voices",
];
/** Only path-shaped metadata, never arbitrary descriptions/prompts/credentials. */
function paths(value: unknown, key = ""): string[] {
  if (typeof value === "string")
    return /(?:path|paths|image|images|persona|logo|base|archetype|background|audio|recording|video|file)$/i.test(
      key,
    ) && isAbsolute(value)
      ? [value]
      : [];
  if (Array.isArray(value)) return value.flatMap((item) => paths(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([field, item]) => paths(item, field));
}
export function selectMediaReferences(bundle: SourceBundle) {
  if (!bundle.unapplied.characterClosureIncluded)
    throw new Error("New character-closure snapshot required.");
  const jobs: Row[] = bundle.rawJobs.map((raw) => JSON.parse(raw));
  const byId = new Map(jobs.map((row) => [String(row.id), row]));
  const ctx = {
    targetJobColumns: new Set(jobs.flatMap((row) => Object.keys(row))),
    userIds: new Set(bundle.tables.users!.map((row) => String(row.id))),
    channelIds: new Set(bundle.tables.channels!.map((row) => String(row.id))),
    presetIds: new Set(
      bundle.tables.tutorial_prompt_presets!.map((row) => String(row.id)),
    ),
    sourceJobIds: new Set(byId.keys()),
  };
  const active = jobs.filter(
    (row) =>
      !["COMPLETED", "CANCELLED"].includes(String(row.status).toUpperCase()),
  );
  const selected = new Set(active.map((row) => String(row.id)));
  const activeJobCount = active.filter(
    (row) => planTutorialImport(row, ctx).disposition === "runtime_candidate",
  ).length;
  const preservationReasons: Record<string, number> = {};
  const preservationStatuses: Record<string, number> = {};
  const safeStatuses = new Set([
    "QUEUED",
    "GENERATING_SCRIPT",
    "GENERATING_AUDIO",
    "READY_TO_RECORD",
    "AWAITING_UPLOAD",
    "SPLICING",
    "FAILED_SCRIPT",
    "FAILED_AUDIO",
    "FAILED_SPLICE",
    "AWAITING_RECORDINGS",
    "RECORDED",
    "READY_TO_STITCH",
    "SENT_TO_STITCHER",
  ]);
  for (const row of active) {
    const plan = planTutorialImport(row, ctx);
    if (plan.disposition === "runtime_candidate") continue;
    const status = safeStatuses.has(String(row.status))
      ? String(row.status)
      : "OTHER";
    preservationStatuses[status] = (preservationStatuses[status] ?? 0) + 1;
    for (const reason of new Set([
      ...plan.blockers,
      ...plan.archiveOnlyReasons,
      ...(plan.disposition === "requires_explicit_resume"
        ? ["requires_explicit_resume"]
        : []),
    ]))
      preservationReasons[reason] = (preservationReasons[reason] ?? 0) + 1;
  }
  const derivatives: Row[] = bundle.rawDerivatives
    .map((raw) => JSON.parse(raw))
    .filter(
      (row) =>
        !["COMPLETED", "CANCELLED"].includes(String(row.status).toUpperCase()),
    );
  const unresolvedSourceIds: string[] = [];
  for (const row of derivatives) {
    if (row.source_job_id && byId.has(String(row.source_job_id)))
      selected.add(String(row.source_job_id));
    else
      unresolvedSourceIds.push(
        String(row.source_job_id ?? "missing_derivative_source"),
      );
  }
  for (const id of selected) {
    const row = byId.get(id)!;
    // stitch_job_id points to parked video_stitch_jobs, not tutorial_jobs.
    for (const field of ["source_job_id", "parent_job_id"])
      if (row[field]) {
        if (!byId.has(String(row[field])))
          unresolvedSourceIds.push(String(row[field]));
        else selected.add(String(row[field]));
      }
    // Parked long-form originals may depend on already completed child raw
    // segments. Preserve those bytes without making the workflow runnable.
    for (const child of jobs)
      if (String(child.parent_job_id ?? "") === id)
        selected.add(String(child.id));
  }
  const result = new Map<string, MediaReference>();
  const add = (
    path: string,
    reason: string,
    origin?: { field: string; status: string; scope: string },
  ) => {
    const item = result.get(path) ?? {
      path,
      reasons: [],
      receipts: [],
      origins: [],
    };
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    if (origin) item.origins.push(origin);
    result.set(path, item);
  };
  const addJobPaths = (row: Row, scope: string) => {
    const status = String(row.status).toUpperCase();
    const safeStatus = new Set([
      ...safeStatuses,
      "COMPLETED",
      "CANCELLED",
      "FAILED",
      "RENDERING",
    ]).has(status)
      ? status
      : "OTHER";
    const safeFields = new Set([
      "audio_path",
      "long_audio_path",
      "recording_path",
      "final_path",
      "transcript_path",
      "output_video_path",
      "video_path",
      "subtitles_path",
      "thumbnail_path",
      "raw_recording_path",
    ]);
    for (const [field, value] of Object.entries(row))
      for (const path of paths(value, field))
        add(path, `${scope}:${row.id}`, {
          field: safeFields.has(field) ? field : "OTHER",
          status: safeStatus,
          scope,
        });
  };
  for (const id of selected) addJobPaths(byId.get(id)!, "job");
  for (const row of derivatives) addJobPaths(row, "derivative");
  for (const table of BRANDING)
    for (const row of bundle.tables[table] ?? []) {
      // All selected reusable branding; generated historical thumbnail outputs
      // are not needed by active jobs, but their reference images remain needed.
      const content =
        table === "thumbnails" && !selected.has(String(row.subject_id))
          ? {
              reference_paths: row.reference_paths,
              extra_reference_paths: row.extra_reference_paths,
            }
          : row;
      for (const path of paths(content)) add(path, `branding:${table}`);
    }
  for (const row of bundle.tables.storage_artifacts ?? []) {
    if (row.owner_kind !== "tutorial_job") continue;
    if (selected.has(String(row.job_id)) && typeof row.vps_path === "string")
      add(row.vps_path, `storage:${row.kind}`);
    const item = result.get(row.vps_path);
    if (item)
      item.receipts.push({
        artifactId: row.id,
        driveFileId: row.drive_file_id,
        state: row.state,
        verifiedAt: row.verified_at,
        driveMd5: row.drive_md5,
        checksumSha256: row.checksum_sha256,
        bytes: row.bytes,
      });
  }
  return {
    references: [...result.values()],
    activeJobCount,
    excludedActiveJobs: 0,
    preservedAwaitingRoutingOrResume: active.length - activeJobCount,
    preservedActiveOriginals: active.length,
    preservedActiveDerivatives: derivatives.length,
    preservationReasons,
    preservationStatuses,
    sourceDependencyJobs: selected.size - active.length,
    unresolvedSourceIds,
    parkedExternalStitchReferences: [
      ...new Set(
        [...selected].map((id) => byId.get(id)?.stitch_job_id).filter(Boolean),
      ),
    ],
  };
}
function within(path: string, root: string) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
export async function inspectMediaFile(path: string, roots: string[]) {
  const absolute = resolve(path);
  if (
    !isAbsolute(path) ||
    !roots.some((root) => within(absolute, resolve(root)))
  )
    return { state: "unsafe_path" as const };
  try {
    // Check every ancestor, including the allowlisted root; don't follow symlinks.
    const parts = absolute
      .slice(parse(absolute).root.length)
      .split(sep)
      .filter(Boolean);
    let cursor = parse(absolute).root;
    for (const part of parts) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink())
        return { state: "unsafe_path" as const };
    }
    if ((await realpath(absolute)) !== absolute)
      return { state: "unsafe_path" as const };
    const file = await open(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1)
        return { state: "unsafe_path" as const };
      const hash = createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false }))
        hash.update(chunk);
      const after = await file.stat();
      const current = await lstat(absolute);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.isSymbolicLink() ||
        (await realpath(absolute)) !== absolute
      )
        return { state: "changed_during_read" as const };
      return {
        state: "local_verified" as const,
        bytes: after.size,
        sha256: hash.digest("hex"),
      };
    } finally {
      await file.close();
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") return { state: "missing" as const };
    return { state: "unreadable" as const };
  }
}
export async function planPrivateMediaManifest(
  bundle: SourceBundle,
  roots: string[],
  sourceBundleSha256: string,
) {
  if (
    !roots.length ||
    roots.some(
      (root) =>
        !isAbsolute(root) || resolve(root) === parse(resolve(root)).root,
    )
  )
    throw new Error("Explicit non-root media allowlist required.");
  const selection = selectMediaReferences(bundle);
  const files = [];
  const counts = {
    activeJobs: selection.activeJobCount,
    preservedActiveOriginals: selection.preservedActiveOriginals,
    preservedAwaitingRoutingOrResume:
      selection.preservedAwaitingRoutingOrResume,
    preservedActiveDerivatives: selection.preservedActiveDerivatives,
    preservationReasons: selection.preservationReasons,
    preservationStatuses: selection.preservationStatuses,
    missingReferenceCategories: {} as Record<string, number>,
    missingByFieldAndStatus: {} as Record<string, number>,
    missingSemantics: {} as Record<string, number>,
    staleTemporaryStorageReferences: 0,
    excludedActiveJobs: selection.excludedActiveJobs,
    sourceDependencyJobs: selection.sourceDependencyJobs,
    references: selection.references.length,
    localFiles: 0,
    localBytes: 0,
    driveRestorableCandidates: 0,
    unverifiedMissing: 0,
    unsafeOrUnreadable: 0,
    unresolvedSourceDependencies: selection.unresolvedSourceIds.length,
    parkedExternalStitchReferences:
      selection.parkedExternalStitchReferences.length,
  };
  for (const reference of selection.references) {
    const inspection = await inspectMediaFile(reference.path, roots);
    let state: string = inspection.state;
    if (
      state === "unsafe_path" &&
      reference.path.startsWith("/tmp/") &&
      reference.reasons.every((reason) => reason.startsWith("storage:"))
    ) {
      try {
        await lstat(reference.path);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          state = "stale_temporary_storage_reference";
          counts.staleTemporaryStorageReferences++;
        }
      }
    }
    if (state === "local_verified") {
      counts.localFiles++;
      counts.localBytes += inspection.bytes!;
    } else if (state === "missing") {
      const candidate = reference.receipts.some(
        (receipt) =>
          receipt.state === "uploaded" &&
          receipt.driveFileId &&
          receipt.verifiedAt &&
          /^[a-f0-9]{32}$/i.test(receipt.driveMd5 ?? "") &&
          /^[a-f0-9]{64}$/i.test(receipt.checksumSha256 ?? ""),
      );
      state = candidate ? "drive_restorable_candidate" : "unverified_missing";
      if (candidate) counts.driveRestorableCandidates++;
      else counts.unverifiedMissing++;
      for (const category of new Set(
        reference.reasons.map((reason) =>
          reason.startsWith("branding:")
            ? "branding"
            : reason.startsWith("derivative:")
              ? "derivative_media"
              : reason.startsWith("storage:")
                ? "storage_media"
                : "original_or_source_media",
        ),
      ))
        counts.missingReferenceCategories[category] =
          (counts.missingReferenceCategories[category] ?? 0) + 1;
      for (const origin of reference.origins) {
        const key = `${origin.scope}:${origin.field}:${origin.status}`;
        counts.missingByFieldAndStatus[key] =
          (counts.missingByFieldAndStatus[key] ?? 0) + 1;
      }
      const planned =
        reference.origins.length > 0 &&
        reference.origins.every(
          (origin) =>
            (["final_path", "output_video_path", "video_path"].includes(
              origin.field,
            ) &&
              !["COMPLETED", "OTHER"].includes(origin.status)) ||
            (["audio_path", "long_audio_path"].includes(origin.field) &&
              [
                "QUEUED",
                "GENERATING_SCRIPT",
                "GENERATING_AUDIO",
                "FAILED_SCRIPT",
                "FAILED_AUDIO",
              ].includes(origin.status)) ||
            (["recording_path", "raw_recording_path"].includes(origin.field) &&
              [
                "QUEUED",
                "GENERATING_SCRIPT",
                "GENERATING_AUDIO",
                "READY_TO_RECORD",
              ].includes(origin.status)),
        );
      const required = reference.origins.some(
        (origin) =>
          ([
            "audio_path",
            "long_audio_path",
            "recording_path",
            "raw_recording_path",
          ].includes(origin.field) &&
            [
              "AWAITING_UPLOAD",
              "SPLICING",
              "RECORDED",
              "READY_TO_STITCH",
              "SENT_TO_STITCHER",
              "COMPLETED",
              "FAILED_SPLICE",
            ].includes(origin.status)) ||
          (["audio_path", "long_audio_path"].includes(origin.field) &&
            origin.status === "READY_TO_RECORD"),
      );
      const semantics = required
        ? "required_input_missing"
        : planned
          ? "output_not_yet_expected_by_status"
          : "requires_review";
      counts.missingSemantics[semantics] =
        (counts.missingSemantics[semantics] ?? 0) + 1;
    } else if (state !== "stale_temporary_storage_reference")
      counts.unsafeOrUnreadable++;
    files.push({ ...reference, ...inspection, state });
  }
  return {
    version: "tutorial-private-media-manifest/3",
    sourceBundleSha256,
    generatedAt: new Date().toISOString(),
    roots,
    counts,
    unresolvedSourceIds: selection.unresolvedSourceIds,
    parkedExternalStitchReferences: selection.parkedExternalStitchReferences,
    driveAvailabilityChecked: false,
    files,
  };
}
export async function writePrivateMediaManifest(
  path: string,
  manifest: Awaited<ReturnType<typeof planPrivateMediaManifest>>,
) {
  const absolute = await protectedPath(path, false);
  const serialized = JSON.stringify(manifest);
  const handle = await open(absolute, "wx", 0o600);
  try {
    await handle.writeFile(serialized);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    checksum: bundleFingerprint(serialized),
    bytes: Buffer.byteLength(serialized),
    counts: manifest.counts,
  };
}
