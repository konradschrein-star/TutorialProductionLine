/** Synthetic, in-memory bundle + fresh isolated target transaction rehearsals. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  assertFreshTargetName,
  importBundleIntoTransaction,
  selectProviderEnvironment,
  writeProtectedBundle,
  type SourceBundle,
} from "./secure-selective-bundle";
const databaseName = "tutorial_staging_bundle_rehearsal_20260908";
const url = `postgresql://recovery:local-test-only@127.0.0.1:55438/${databaseName}`;
if (process.env.TARGET_DATABASE_URL !== url)
  throw new Error("Explicit synthetic staging target only");
const db = postgres(url, { max: 1 });
const userId = randomUUID();
const channelId = randomUUID();
const voiceId = randomUUID();
const presetId = randomUUID();
const jobId = randomUUID();
const thumbnailParentId = randomUUID();
const storageId = randomUUID();
const characterId = randomUUID();
const hash = "$2b$10$" + "A".repeat(53);
const source = {
  id: jobId,
  created_by: userId,
  channel_id: channelId,
  title: "Synthetic completed source",
  mode: "THREE_MIN",
  status: "COMPLETED",
  language: "English",
  script_provider: "deepseek",
  tts_provider: "fish_audio",
  tts_voice: "unchanged-provider-voice-id",
  prompt_preset_id: presetId,
  description: "Synthetic description",
  tags: ["synthetic"],
  script_text: "Synthetic explanation",
  created_at: "2020-01-01T00:00:00Z",
  completed_at: "2020-01-01T01:00:00Z",
  va_review_status: "approved",
  keyword_ref: "synthetic-migration-keyword",
  final_path: "/synthetic/not-copied.mp4",
  intro_config: { original: "preserved only in private archive" },
};
const unassigned = {
  ...source,
  id: randomUUID(),
  channel_id: null,
  status: "READY_TO_RECORD",
};
const inflight = { ...source, id: randomUUID(), status: "GENERATING_AUDIO" };
const bundle: SourceBundle = {
  version: "tutorial-selective-bundle/1",
  sourceSystem: "synthetic_cf",
  exportedAt: new Date().toISOString(),
  rawJobs: [source, unassigned, inflight].map((row) => JSON.stringify(row)),
  rawDerivatives: [
    JSON.stringify({
      id: randomUUID(),
      source_job_id: jobId,
      language: "ja",
      status: "COMPLETED",
      final_path: "/synthetic/ja.mp4",
    }),
  ],
  tables: {
    users: [
      {
        id: userId,
        name: "Synthetic producer",
        email: "synthetic-only@example.test",
        role: "TUTORIAL_VA",
        password_hash: hash,
        is_active: true,
        default_tutorial_channel_id: channelId,
      },
    ],
    channels: [
      {
        id: channelId,
        youtube_channel_id: "UC_SYNTHETIC_MIGRATION_ONLY",
        name: "Synthetic tutorial channel",
        language: "en",
        accepts_tutorials: true,
        voice_id: voiceId,
        metadata: { branding: "unchanged" },
      },
    ],
    tts_voices: [
      {
        id: voiceId,
        name: "Synthetic original voice",
        provider: "Fish",
        voice_id: "unchanged-provider-voice-id",
        language: "en",
        settings: '{"speed":1}',
      },
    ],
    tutorial_prompt_presets: [
      {
        id: presetId,
        category: "THREE_MIN",
        name: "Synthetic original prompt",
        system_prompt: "Preserve this prompt",
        is_default: true,
        created_by: userId,
      },
    ],
    tutorial_settings: [
      {
        id: 1,
        default_script_provider: "deepseek",
        default_tts_provider: "fish_audio",
        default_tts_voice: "unchanged-provider-voice-id",
        record_hotkey: "Space",
        drive_autoupload_enabled: true,
      },
    ],
    providers: [],
    provider_capability_links: [],
    thumbnails: [
      {
        id: randomUUID(),
        subject_kind: "tutorial_job",
        subject_id: jobId,
        prompt_mode: "programmatic",
        prompt_used: "synthetic",
        parent_thumbnail_id: thumbnailParentId,
        status: "completed",
      },
      {
        id: thumbnailParentId,
        subject_kind: "tutorial_job",
        subject_id: jobId,
        prompt_mode: "programmatic",
        prompt_used: "synthetic",
        status: "completed",
      },
    ],
    characters: [
      {
        id: characterId,
        name: "Synthetic host",
        description: "Keep original host",
        role: "host",
        channel_id: channelId,
      },
    ],
    character_images: [
      {
        id: randomUUID(),
        character_id: characterId,
        image_path: "/opt/content-forge/media/host.png",
        pose: "pointing",
        sort_order: 7,
      },
    ],
    character_channels: [
      {
        id: randomUUID(),
        character_id: characterId,
        channel_id: channelId,
        role: "host",
        is_primary: true,
      },
    ],
    storage_artifacts: [
      {
        id: storageId,
        owner_kind: "tutorial_job",
        job_id: unassigned.id,
        kind: "final_video",
        filename: "synthetic.mp4",
        vps_path: "/opt/content-forge/media/synthetic.mp4",
        drive_file_id: "synthetic-drive-id",
        state: "uploaded",
        verified_at: null,
        checksum_sha256: null,
        resumable_session_uri: "synthetic-session-not-resumed",
      },
    ],
  },
  unapplied: {
    brandingRows: 5,
    storageRows: 1,
    unsupportedSettingsColumns: [],
    characterClosureIncluded: true,
  },
};
class ExpectedRollback extends Error {}
const options = {
  acceptPhaseOne: true,
  includeAssets: true,
  primaryChannelIds: new Set([channelId]),
  confirmedTargetName: databaseName,
};
try {
  assert.equal(assertFreshTargetName(url, databaseName), databaseName);
  assert.throws(() =>
    assertFreshTargetName(
      "postgresql://localhost/content_forge",
      "content_forge",
    ),
  );
  assert.throws(() => assertFreshTargetName(url, "different"));
  assert.throws(() =>
    selectProviderEnvironment({ DATABASE_URL: "never-export" }, [
      "DATABASE_URL",
    ]),
  );
  assert.deepEqual(
    selectProviderEnvironment({ FISH_API_KEY: "synthetic-key" }, [
      "FISH_API_KEY",
    ]).values,
    { FISH_API_KEY: "synthetic-key" },
  );
  if (process.platform !== "linux")
    await assert.rejects(
      writeProtectedBundle("C:/Users/konra/OneDrive/forbidden.json", bundle),
      /Linux server/,
    );
  await assert.rejects(
    db.begin((tx) =>
      importBundleIntoTransaction(tx, bundle, {
        ...options,
        acceptPhaseOne: false,
      }),
    ),
    /phase-one/,
  );
  await assert.rejects(
    db.begin((tx) =>
      importBundleIntoTransaction(tx, bundle, {
        ...options,
        confirmedTargetName: "wrong",
      }),
    ),
    /confirmation/,
  );
  let counts: any;
  const brokenClosure = structuredClone(bundle);
  brokenClosure.tables.thumbnails![0]!.parent_thumbnail_id = randomUUID();
  await assert.rejects(
    db.begin((tx) => importBundleIntoTransaction(tx, brokenClosure, options)),
    /closure incomplete/,
  );
  const cyclicClosure = structuredClone(bundle);
  cyclicClosure.tables.thumbnails![1]!.parent_thumbnail_id =
    cyclicClosure.tables.thumbnails![0]!.id;
  await assert.rejects(
    db.begin((tx) => importBundleIntoTransaction(tx, cyclicClosure, options)),
    /Cyclic/,
  );
  const unrelatedStorage = structuredClone(bundle);
  unrelatedStorage.tables.storage_artifacts![0]!.owner_kind = "content_job";
  await assert.rejects(
    db.begin((tx) =>
      importBundleIntoTransaction(tx, unrelatedStorage, options),
    ),
    /outside/,
  );
  try {
    await db.begin(async (tx) => {
      await tx.unsafe(
        await readFile(
          "packages/db/src/migrations/0099_storage_versions_append_only.sql",
          "utf8",
        ),
      );
      counts = await importBundleIntoTransaction(tx, bundle, options);
      const [user] =
        await tx`SELECT password_hash,role,default_tutorial_channel_id FROM users WHERE id=${userId}`;
      assert.equal(user!.password_hash, hash);
      assert.equal(user!.role, "TUTORIAL_VA");
      assert.equal(user!.default_tutorial_channel_id, channelId);
      const [channel] =
        await tx`SELECT voice_id,metadata,is_primary,uploader_channel_key FROM channels WHERE id=${channelId}`;
      assert.equal(channel!.voice_id, voiceId);
      assert.equal(channel!.metadata.branding, "unchanged");
      assert.equal(channel!.metadata.tutorialDelivery.mode, "manual");
      assert.equal(channel!.uploader_channel_key, null);
      assert.equal(channel!.is_primary, true);
      const [settings] =
        await tx`SELECT default_script_provider,default_tts_provider,default_tts_voice,record_hotkey,drive_autoupload_enabled FROM tutorial_settings`;
      assert.equal(settings!.default_script_provider, "deepseek");
      assert.equal(settings!.default_tts_provider, "fish_audio");
      assert.equal(settings!.default_tts_voice, source.tts_voice);
      assert.equal(settings!.record_hotkey, "Space");
      assert.equal(settings!.drive_autoupload_enabled, false);
      const [runtime] =
        await tx`SELECT status,language,publication_approval,is_uploaded,scheduled_for,tts_voice FROM tutorial_jobs WHERE id=${jobId}`;
      assert.equal(runtime!.status, "COMPLETED");
      assert.equal(runtime!.language, "en");
      assert.equal(runtime!.tts_voice, source.tts_voice);
      assert.equal(runtime!.publication_approval, null);
      assert.equal(runtime!.scheduled_for, null);
      assert.equal(runtime!.is_uploaded, false);
      const [archive] =
        await tx`SELECT source_json FROM tutorial_legacy_archive WHERE source_id=${jobId}`;
      assert.equal(archive!.source_json, bundle.rawJobs[0]);
      const [outbox] =
        await tx`SELECT count(*)::int AS count FROM tutorial_keyword_outbox`;
      assert.equal(outbox!.count, 0);
      const [dispatch] =
        await tx`SELECT count(*)::int AS count FROM tutorial_upload_dispatches`;
      assert.equal(dispatch!.count, 0);
      const [control] =
        await tx`SELECT tutorial_dispatch_paused,uploader FROM system_settings`;
      assert.equal(control!.tutorial_dispatch_paused, true);
      assert.equal(control!.uploader.enabled, false);
      assert.equal(counts.runtimeJobs, 1);
      assert.equal(counts.archives, 4);
      assert.equal(counts.archiveOnly, 3);
      assert.equal(counts.needsResume, 1);
      assert.equal(counts.importedBrandingRows, 5);
      assert.equal(counts.importedStorageRows, 1);
      assert.equal(counts.archiveOwnedStorageRows, 1);
      assert.equal(counts.mediaBytesVerified, 0);
      assert.equal(counts.unappliedStorageRows, 0);
      const [asset] =
        await tx`SELECT vps_path,resumable_session_uri FROM storage_artifacts WHERE id=${storageId}`;
      assert.equal(asset!.vps_path, "/opt/content-forge/media/synthetic.mp4");
      assert.equal(asset!.resumable_session_uri, null);
      const [history] =
        await tx`SELECT verified_at,checksum_sha256 FROM storage_artifact_versions WHERE artifact_id=${storageId}`;
      assert.equal(history!.verified_at, null);
      assert.equal(history!.checksum_sha256, null);
      const [host] =
        await tx`SELECT image_path,pose,sort_order FROM character_images WHERE character_id=${characterId}`;
      assert.equal(host!.image_path, "/opt/content-forge/media/host.png");
      assert.equal(host!.pose, "pointing");
      assert.equal(host!.sort_order, 7);
      await tx`INSERT INTO storage_artifact_versions(artifact_id,drive_file_id,vps_path) VALUES(${storageId},'synthetic-drive-id','/ignored-duplicate') ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO storage_artifact_versions(artifact_id,drive_file_id,vps_path) VALUES(${storageId},'synthetic-new-identity','/unchanged-path')`;
      for (const sql of [
        "UPDATE storage_artifact_versions SET vps_path='/tampered'",
        "DELETE FROM storage_artifact_versions",
        "TRUNCATE storage_artifact_versions",
      ]) {
        await assert.rejects(
          tx.savepoint((inner) => inner.unsafe(sql)),
          /append-only/,
        );
      }
      await assert.rejects(
        importBundleIntoTransaction(tx, bundle, options),
        /not empty/,
      );
      throw new ExpectedRollback();
    });
  } catch (error) {
    if (!(error instanceof ExpectedRollback)) throw error;
  }
  const [empty] =
    await db`SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM tutorial_jobs)+(SELECT count(*) FROM tutorial_legacy_archive) AS count`;
  assert.equal(Number(empty!.count), 0);
  console.log(
    JSON.stringify({
      syntheticOnly: true,
      committed: false,
      privateFileGuard: true,
      exactHashesRolesVoicesPreserved: true,
      explicitPrimaryMapping: true,
      originalJSONArchivedFirst: true,
      unmappedAndInflightArchiveOnly: true,
      noApprovalOrDispatchOrOutbox: true,
      paused: true,
      freshTargetGuard: true,
      transactionRollbackVerified: true,
      counts,
    }),
  );
} finally {
  await db.end();
}
