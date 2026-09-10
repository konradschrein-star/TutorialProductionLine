import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  inspectMediaFile,
  planPrivateMediaManifest,
  selectMediaReferences,
} from "./private-media-manifest";
import type { SourceBundle } from "./secure-selective-bundle";
const fixture = resolve("scripts/migration/test-private-media-manifest.ts");
const missing = resolve("scripts/migration/synthetic-does-not-exist.mp4");
const roots = [resolve("scripts/migration")];
const bundle: SourceBundle = {
  version: "tutorial-selective-bundle/1",
  sourceSystem: "synthetic",
  exportedAt: new Date().toISOString(),
  rawJobs: [
    JSON.stringify({
      id: "active",
      created_by: "owner",
      channel_id: "channel",
      language: "en",
      status: "READY_TO_RECORD",
      audio_path: fixture,
    }),
    JSON.stringify({
      id: "history",
      created_by: "owner",
      channel_id: "channel",
      language: "en",
      status: "COMPLETED",
      final_path: "/never-read-historical-video",
    }),
  ],
  rawDerivatives: [],
  tables: {
    users: [{ id: "owner" }],
    channels: [{ id: "channel" }],
    tts_voices: [],
    tutorial_settings: [],
    tutorial_prompt_presets: [],
    providers: [],
    provider_capability_links: [],
    character_images: [{ image_path: missing }],
    storage_artifacts: [
      {
        owner_kind: "tutorial_job",
        job_id: "active",
        vps_path: missing,
        kind: "raw_recording",
        state: "uploaded",
        drive_file_id: "synthetic",
        verified_at: "2020-01-01",
        drive_md5: "a".repeat(32),
        checksum_sha256: "b".repeat(64),
      },
    ],
  },
  unapplied: {
    brandingRows: 1,
    storageRows: 1,
    unsupportedSettingsColumns: [],
    characterClosureIncluded: true,
  },
};
const selected = selectMediaReferences(bundle);
assert.equal(selected.activeJobCount, 1);
assert.equal(selected.references.length, 2);
bundle.rawJobs.push(
  JSON.stringify({
    id: "unmapped",
    created_by: "owner",
    channel_id: null,
    language: "en",
    status: "READY_TO_RECORD",
    recording_path: fixture,
  }),
);
bundle.rawJobs.push(
  JSON.stringify({
    id: "inflight",
    created_by: "owner",
    channel_id: "channel",
    language: "en",
    status: "GENERATING_AUDIO",
    audio_path: fixture,
  }),
);
bundle.rawDerivatives.push(
  JSON.stringify({
    id: "locale",
    source_job_id: "active",
    status: "failed",
    audio_path: fixture,
  }),
);
const preserved = selectMediaReferences(bundle);
assert.equal(preserved.activeJobCount, 1);
assert.equal(preserved.preservedActiveOriginals, 3);
assert.equal(preserved.preservedAwaitingRoutingOrResume, 2);
assert.equal(preserved.preservedActiveDerivatives, 1);
assert.equal(preserved.excludedActiveJobs, 0);
assert.equal(
  preserved.preservationReasons.active_job_requires_admin_routing,
  1,
);
assert.equal(preserved.preservationReasons.requires_explicit_resume, 1);
assert.ok(
  preserved.references
    .find((row) => row.path === fixture)!
    .reasons.includes("derivative:locale"),
);
const local = await inspectMediaFile(fixture, roots);
assert.equal(local.state, "local_verified");
assert.equal(local.sha256?.length, 64);
assert.ok(local.bytes! > 0);
assert.equal(
  (await inspectMediaFile(fixture, [resolve("packages")])).state,
  "unsafe_path",
);
const manifest = await planPrivateMediaManifest(bundle, roots, "c".repeat(64));
assert.equal(manifest.counts.localFiles, 1);
assert.equal(manifest.counts.driveRestorableCandidates, 1);
assert.equal(manifest.driveAvailabilityChecked, false);
assert.equal(manifest.version, "tutorial-private-media-manifest/3");
bundle.tables.storage_artifacts![0]!.verified_at = null;
const unknown = await planPrivateMediaManifest(bundle, roots, "c".repeat(64));
assert.equal(unknown.counts.unverifiedMissing, 1);
const pending = structuredClone(bundle);
pending.rawJobs.push(
  JSON.stringify({
    id: "planned",
    created_by: "owner",
    channel_id: "channel",
    language: "en",
    status: "SPLICING",
    final_path: resolve("scripts/migration/not-yet-rendered-synthetic.mp4"),
  }),
);
pending.rawJobs.push(
  JSON.stringify({
    id: "required",
    created_by: "owner",
    channel_id: "channel",
    language: "en",
    status: "SPLICING",
    recording_path: resolve("scripts/migration/missing-required-synthetic.mp4"),
  }),
);
pending.rawJobs.push(
  JSON.stringify({
    id: "parked",
    created_by: "owner",
    channel_id: "channel",
    language: "en",
    status: "SENT_TO_STITCHER",
    stitch_job_id: "external-stitch-id",
  }),
);
const classified = await planPrivateMediaManifest(
  pending,
  roots,
  "c".repeat(64),
);
assert.equal(
  classified.counts.missingSemantics.output_not_yet_expected_by_status,
  1,
);
assert.equal(classified.counts.missingSemantics.required_input_missing, 1);
assert.equal(classified.counts.unresolvedSourceDependencies, 0);
assert.equal(classified.counts.parkedExternalStitchReferences, 1);
console.log(
  JSON.stringify({
    syntheticOnly: true,
    activeSelection: true,
    historicalVideoExcluded: true,
    localHashVerified: true,
    outsideRootRejected: true,
    driveEvidenceNotLiveAvailability: true,
    unverifiedReceiptRemainsMissing: true,
  }),
);
