/** Server-side migration primitives. Sensitive bundles must never enter Git,
 * synced folders or logs. This module itself never prints rows or credentials. */
import { createHash } from "node:crypto";
import { lstat, open, realpath, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prepareLegacyTutorialArchive } from "../../packages/db/dist/legacy-archive-plan.js";
import { planTutorialImport, planUserImport } from "./selective-import-plan";
type Row = Record<string, any>;
export interface SourceBundle {
  version: "tutorial-selective-bundle/1";
  sourceSystem: string;
  exportedAt: string;
  tables: Record<string, Row[]>;
  rawJobs: string[];
  rawDerivatives: string[];
  unapplied: {
    brandingRows: number;
    storageRows: number;
    unsupportedSettingsColumns: string[];
    absentSourceTables?: string[];
    characterClosureIncluded?: boolean;
  };
}
const CORE_TABLES = [
  "users",
  "channels",
  "tts_voices",
  "tutorial_prompt_presets",
  "tutorial_settings",
  "providers",
  "provider_capability_links",
] as const;
const BRANDING_TABLES = [
  "thumbnails",
  "thumbnail_archetypes",
  "channel_thumbnail_profiles",
  "channel_thumbnail_archetypes",
  "thumbnail_bookmarks",
  "tutorial_background_presets",
  "tutorial_intro_hosts",
  "characters",
  "character_images",
  "character_channels",
];
export function bundleFingerprint(serialized: string) {
  return createHash("sha256").update(serialized).digest("hex");
}
export function assertFreshTargetName(url: string, confirmation: string) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^tutorial_staging_[a-z0-9_]+$/.test(name) || confirmation !== name)
    throw new Error(
      "Explicit fresh tutorial_staging_* database confirmation required.",
    );
  return name;
}

/** Production bundle files are Linux-only, newly created, and owner-private. */
export async function protectedPath(path: string, existing: boolean) {
  if (process.platform !== "linux" || typeof process.getuid !== "function")
    throw new Error(
      "Sensitive migration files are supported only in protected Linux server temp directories.",
    );
  const absolute = resolve(path);
  const directory = await realpath(dirname(absolute));
  if (
    !/^(\/var\/tmp|\/tmp)\/tutorial-migration-[A-Za-z0-9_-]+$/.test(directory)
  )
    throw new Error(
      "Use a dedicated protected tutorial-migration-* server temp directory.",
    );
  if (dirname(absolute) !== directory)
    throw new Error("Symlinked bundle directory rejected.");
  const parent = await lstat(directory);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 0o077) !== 0
  )
    throw new Error(
      "Bundle directory must be owned by the current user and mode 0700.",
    );
  if (existing) {
    const info = await lstat(absolute);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o077) !== 0 ||
      info.nlink !== 1
    )
      throw new Error("Bundle must be an unlinked regular owner-only file.");
  }
  return absolute;
}
export async function writeProtectedBundle(path: string, bundle: SourceBundle) {
  const absolute = await protectedPath(path, false);
  const text = JSON.stringify(bundle);
  const handle = await open(absolute, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { checksum: bundleFingerprint(text), bytes: Buffer.byteLength(text) };
}
export async function readProtectedBundle(
  path: string,
  expectedSha256: string,
): Promise<SourceBundle> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error("Expected bundle SHA-256 is required.");
  const absolute = await protectedPath(path, true);
  const text = await readFile(absolute, "utf8");
  if (bundleFingerprint(text) !== expectedSha256)
    throw new Error("Bundle checksum mismatch.");
  const bundle = JSON.parse(text);
  validateBundle(bundle);
  return bundle;
}
function validateBundle(bundle: SourceBundle) {
  if (
    bundle.version !== "tutorial-selective-bundle/1" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(bundle.sourceSystem) ||
    !Array.isArray(bundle.rawJobs) ||
    !Array.isArray(bundle.rawDerivatives)
  )
    throw new Error("Unsupported bundle format.");
  for (const table of CORE_TABLES)
    if (!Array.isArray(bundle.tables?.[table]))
      throw new Error("Bundle is missing a core dependency table.");
}

/** The caller creates one REPEATABLE READ READ ONLY transaction around this. */
export async function collectSourceBundle(
  tx: any,
  sourceSystem: string,
): Promise<SourceBundle> {
  const present = new Set(
    (
      await tx`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    ).map((row: Row) => row.table_name),
  );
  for (const table of [
    "users",
    "channels",
    "tts_voices",
    "tutorial_settings",
    "tutorial_prompt_presets",
    "tutorial_jobs",
  ])
    if (!present.has(table))
      throw new Error("Source does not match the tutorial schema.");
  const rawJobs = (
    await tx`SELECT row_to_json(t)::text AS raw FROM tutorial_jobs t ORDER BY id`
  ).map((row: Row) => row.raw as string);
  const rawDerivatives = present.has("tutorial_derivatives")
    ? (
        await tx`SELECT row_to_json(t)::text AS raw FROM tutorial_derivatives t ORDER BY id`
      ).map((row: Row) => row.raw as string)
    : [];
  const jobs = rawJobs.map((raw: string) => JSON.parse(raw));
  const jobIds = jobs.map((row: Row) => row.id);
  const presets = await tx`SELECT * FROM tutorial_prompt_presets`;
  const referencedUsers = [
    ...new Set(
      [
        ...jobs.flatMap((row: Row) => [row.created_by, row.va_reviewed_by]),
        ...presets.map((row: Row) => row.created_by),
      ].filter(Boolean),
    ),
  ];
  // Explicit projection: no encrypted YouTube cookie blobs or unrelated user state.
  const users =
    await tx`SELECT id,email,name,role,password_hash,is_active,default_tutorial_channel_id,created_at,updated_at FROM users WHERE role IN ('ADMIN','TUTORIAL_VA','PRODUCTION_VA','UPLOADER_VA') OR id = ANY(${referencedUsers}::uuid[])`;
  const channelIds = [
    ...new Set(
      [
        ...jobs.map((row: Row) => row.channel_id),
        ...users.map((row: Row) => row.default_tutorial_channel_id),
      ].filter(Boolean),
    ),
  ];
  const channels =
    await tx`SELECT * FROM channels WHERE accepts_tutorials=true OR id = ANY(${channelIds}::uuid[])`;
  const voices = await tx`SELECT * FROM tts_voices`;
  const settings = await tx`SELECT * FROM tutorial_settings`;
  const usedProviderKeys = [
    ...new Set(
      [
        ...jobs.flatMap((row: Row) => [
          row.script_provider,
          row.tts_provider,
          row.tts_provider_used,
        ]),
        ...settings.flatMap((row: Row) => [
          row.default_script_provider,
          row.default_tts_provider,
        ]),
      ].filter(Boolean),
    ),
  ];
  const providers = present.has("providers")
    ? await tx`SELECT * FROM providers WHERE key=ANY(${usedProviderKeys}::text[]) OR capabilities && ARRAY['llm','tts','image','storage']::text[]`
    : [];
  const providerKeys = providers.map((row: Row) => row.key);
  const links = present.has("provider_capability_links")
    ? await tx`SELECT * FROM provider_capability_links WHERE provider_key=ANY(${providerKeys}::text[]) AND (consumer IS NULL OR consumer LIKE 'tutorial%')`
    : [];
  const tables: SourceBundle["tables"] = {
    users,
    channels,
    tts_voices: voices,
    tutorial_prompt_presets: presets,
    tutorial_settings: settings,
    providers,
    provider_capability_links: links,
  };
  // Retain the selected tutorial branding/storage closure in the private bundle.
  // Phase one reports it as UNAPPLIED rather than pretending branding migrated.
  const thumbnails = present.has("thumbnails")
    ? await tx`WITH RECURSIVE selected AS (SELECT * FROM thumbnails WHERE subject_kind='tutorial_job' AND subject_id=ANY(${jobIds}::uuid[]) UNION SELECT t.* FROM thumbnails t JOIN selected s ON t.id=s.parent_thumbnail_id) SELECT * FROM selected`
    : [];
  tables.thumbnails = thumbnails;
  const scopedChannels = channels.map((row: Row) => row.id);
  tables.channel_thumbnail_profiles = present.has("channel_thumbnail_profiles")
    ? await tx`SELECT * FROM channel_thumbnail_profiles WHERE channel_id=ANY(${scopedChannels}::uuid[])`
    : [];
  tables.channel_thumbnail_archetypes = present.has(
    "channel_thumbnail_archetypes",
  )
    ? await tx`SELECT * FROM channel_thumbnail_archetypes WHERE channel_id=ANY(${scopedChannels}::uuid[])`
    : [];
  const archetypeIds = [
    ...new Set(
      [
        ...thumbnails.map((row: Row) => row.archetype_id),
        ...tables.channel_thumbnail_archetypes.map((row) => row.archetype_id),
      ].filter(Boolean),
    ),
  ];
  tables.thumbnail_archetypes = present.has("thumbnail_archetypes")
    ? await tx`SELECT * FROM thumbnail_archetypes WHERE id=ANY(${archetypeIds}::uuid[]) OR channel_id=ANY(${scopedChannels}::uuid[])`
    : [];
  const bookmarkIds = thumbnails
    .map((row: Row) => row.from_bookmark_id)
    .filter(Boolean);
  tables.thumbnail_bookmarks = present.has("thumbnail_bookmarks")
    ? await tx`SELECT * FROM thumbnail_bookmarks WHERE id=ANY(${bookmarkIds}::uuid[])`
    : [];
  // Preserve channel hosts and characters actually referenced in thumbnail
  // persona paths, without copying unrelated format cast libraries.
  const personaPaths = [
    ...new Set(
      thumbnails
        .flatMap((row: Row) => [
          row.reference_paths?.persona,
          ...(row.extra_reference_paths ?? []),
        ])
        .filter(Boolean),
    ),
  ];
  tables.character_channels = present.has("character_channels")
    ? await tx`SELECT * FROM character_channels WHERE channel_id=ANY(${scopedChannels}::uuid[])`
    : [];
  const boundCharacters = tables.character_channels.map(
    (row) => row.character_id,
  );
  const pathCharacters = present.has("character_images")
    ? await tx`SELECT DISTINCT character_id FROM character_images WHERE image_path=ANY(${personaPaths}::text[]) OR original_path=ANY(${personaPaths}::text[])`
    : [];
  const selectedCharacterIds = [
    ...new Set([
      ...boundCharacters,
      ...pathCharacters.map((row: Row) => row.character_id),
    ]),
  ];
  tables.characters = present.has("characters")
    ? await tx`SELECT * FROM characters WHERE id=ANY(${selectedCharacterIds}::uuid[]) OR channel_id=ANY(${scopedChannels}::uuid[])`
    : [];
  const characterIds = tables.characters.map((row) => row.id);
  tables.character_images = present.has("character_images")
    ? await tx`SELECT * FROM character_images WHERE character_id=ANY(${characterIds}::uuid[])`
    : [];
  // Rare legacy model-sheet/archetype dependencies are retained separately.
  // They are not silently nulled when phase-two target support is incomplete.
  const sheetIds = tables.characters
    .map((row) => row.reference_sheet_asset_id)
    .filter(Boolean);
  const characterArchetypes = tables.characters
    .map((row) => row.archetype_id)
    .filter(Boolean);
  tables.character_dependency_assets =
    present.has("assets") && sheetIds.length
      ? await tx`WITH RECURSIVE selected AS (SELECT * FROM assets WHERE id=ANY(${sheetIds}::uuid[]) UNION SELECT a.* FROM assets a JOIN selected s ON a.id=s.parent_asset_id) SELECT * FROM selected`
      : [];
  tables.character_dependency_archetypes =
    present.has("archetypes") && characterArchetypes.length
      ? await tx`SELECT * FROM archetypes WHERE id=ANY(${characterArchetypes}::uuid[])`
      : [];
  // Background/host rows are tutorial-format assets; preserve shared references.
  for (const table of ["tutorial_background_presets", "tutorial_intro_hosts"])
    tables[table] = present.has(table)
      ? await tx.unsafe(`SELECT * FROM ${table}`)
      : [];
  tables.storage_artifacts = present.has("storage_artifacts")
    ? await tx`SELECT * FROM storage_artifacts WHERE owner_kind='tutorial_job' AND job_id=ANY(${jobIds}::uuid[])`
    : [];
  tables.system_settings = present.has("system_settings")
    ? await tx`SELECT id,storage,notifications,updated_at,updated_by FROM system_settings`
    : [];
  return {
    version: "tutorial-selective-bundle/1",
    sourceSystem,
    exportedAt: new Date().toISOString(),
    tables,
    rawJobs,
    rawDerivatives,
    unapplied: {
      brandingRows: BRANDING_TABLES.reduce(
        (n, table) => n + (tables[table]?.length ?? 0),
        0,
      ),
      storageRows: tables.storage_artifacts.length,
      unsupportedSettingsColumns: [
        "silence_cap_enabled",
        "silence_cap_max_ms",
        "silence_cap_threshold_db",
        "derivative_config",
      ].filter((column) => settings.some((row: Row) => column in row)),
      absentSourceTables: [...BRANDING_TABLES, "assets", "archetypes"].filter(
        (table) => !present.has(table),
      ),
      characterClosureIncluded: true,
    },
  };
}

const CONTROL_TABLES = [
  "users",
  "channels",
  "tts_voices",
  "tutorial_prompt_presets",
  "tutorial_jobs",
  "tutorial_legacy_archive",
  "tutorial_upload_dispatches",
  "encrypted_secrets",
  "storage_artifacts",
  "thumbnails",
  "tutorial_keyword_outbox",
  "tutorial_job_events",
];
/** Entire phase-one import is one transaction. No queue or provider dependency. */
export async function importBundleIntoTransaction(
  tx: any,
  bundle: SourceBundle,
  options: {
    acceptPhaseOne: boolean;
    includeAssets?: boolean;
    primaryChannelIds: ReadonlySet<string>;
    confirmedTargetName: string;
  },
) {
  validateBundle(bundle);
  const [database] = await tx`SELECT current_database() AS name`;
  if (
    !/^tutorial_staging_[a-z0-9_]+$/.test(database.name) ||
    options.confirmedTargetName !== database.name
  )
    throw new Error("Explicit fresh staging database confirmation required.");
  if (!options.acceptPhaseOne)
    throw new Error(
      "Explicit phase-one acknowledgment required: branding, storage and credentials are not applied.",
    );
  await tx.unsafe(
    `LOCK TABLE ${[...CONTROL_TABLES, "providers", "provider_capability_links", "tutorial_settings", "system_settings"].join(",")} IN ACCESS EXCLUSIVE MODE`,
  );
  // Fresh schema, not a merge into existing source/staging production data.
  for (const table of CONTROL_TABLES) {
    const [row] = await tx.unsafe(
      `SELECT count(*)::integer AS count FROM ${table}`,
    );
    if (row.count !== 0)
      throw new Error(
        "Target is not empty; selective import refuses to merge or overwrite.",
      );
  }
  const targetColumns: Record<string, Set<string>> = {};
  for (const row of await tx`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`)
    (targetColumns[row.table_name] ??= new Set()).add(row.column_name);
  for (const table of [
    ...CORE_TABLES,
    "tutorial_legacy_archive",
    "tutorial_legacy_archive_events",
    "tutorial_jobs",
  ])
    if (!targetColumns[table])
      throw new Error(
        "Target schema is incomplete; apply verified schema/migrations first.",
      );
  const insert = async (
    table: string,
    source: Row,
    allowed = targetColumns[table]!,
  ) => {
    const row = Object.fromEntries(
      Object.entries(source).filter(([key]) => allowed.has(key)),
    );
    // JSON roundtrip happens inside PostgreSQL: preserves arrays and scalar types.
    const fields = Object.keys(row);
    if (!fields.length)
      throw new Error("No supported columns for imported row.");
    await tx.unsafe(
      `INSERT INTO ${table} (${fields.map((key) => `"${key}"`).join(",")}) SELECT ${fields.map((key) => `r."${key}"`).join(",")} FROM jsonb_populate_record(NULL::${table}, $1::text::jsonb) r`,
      [JSON.stringify(row)],
    );
  };
  const counts = {
    users: 0,
    channels: 0,
    voices: 0,
    presets: 0,
    runtimeJobs: 0,
    archives: 0,
    archiveOnly: 0,
    needsResume: 0,
    unappliedBrandingRows: bundle.unapplied.brandingRows,
    unappliedStorageRows: bundle.unapplied.storageRows,
    importedBrandingRows: 0,
    importedStorageRows: 0,
    driveHistoryRows: 0,
    archiveOwnedStorageRows: 0,
    mediaBytesVerified: 0,
    unsupportedAssetColumns: 0,
    unappliedAssetTables: {} as Record<string, number>,
    absentSourceTables: bundle.unapplied.absentSourceTables ?? [],
  };
  const channelIds = new Set(
    bundle.tables.channels!.map((row) => String(row.id)),
  );
  const userIds = new Set(bundle.tables.users!.map((row) => String(row.id)));
  const voiceIds = new Set(
    bundle.tables.tts_voices!.map((row) => String(row.id)),
  );
  const presetIds = new Set(
    bundle.tables.tutorial_prompt_presets!.map((row) => String(row.id)),
  );
  const sourceJobs = bundle.rawJobs.map((raw) => JSON.parse(raw));
  const sourceJobIds = new Set(sourceJobs.map((row) => String(row.id)));
  for (const channelId of options.primaryChannelIds)
    if (!channelIds.has(channelId))
      throw new Error("Explicit primary channel not present in source scope.");
  for (const voice of bundle.tables.tts_voices!) {
    await insert("tts_voices", voice);
    counts.voices++;
  }
  for (const channel of bundle.tables.channels!) {
    if (channel.voice_id && !voiceIds.has(channel.voice_id))
      throw new Error(
        "Referenced voice is absent; import cannot replace a voice.",
      );
    const primary = options.primaryChannelIds.has(channel.id);
    if (
      primary &&
      (!channel.accepts_tutorials ||
        !["en", "English"].includes(channel.language))
    )
      throw new Error(
        "Primary channel requires explicit original-English tutorial configuration.",
      );
    await insert("channels", {
      ...channel,
      is_primary: primary,
      clip_library_id: null,
      uploader_channel_key: null,
      metadata: {
        ...(channel.metadata ?? {}),
        tutorialDelivery: { mode: "manual" },
        migrationSource: bundle.sourceSystem,
        migrationOriginalClipLibraryId: channel.clip_library_id ?? null,
      },
    });
    counts.channels++;
  }
  for (const user of bundle.tables.users!) {
    const plan = planUserImport(user, channelIds);
    if (plan.blockers.length)
      throw new Error(
        "Account dependency or password-format validation failed.",
      );
    await insert("users", plan.row);
    counts.users++;
  }
  for (const preset of bundle.tables.tutorial_prompt_presets!) {
    if (preset.created_by && !userIds.has(preset.created_by))
      throw new Error("Preset creator dependency missing.");
    await insert("tutorial_prompt_presets", preset);
    counts.presets++;
  }
  // Registry tables may be code-seeded in an otherwise empty schema. Do not
  // overwrite those rows silently: empty registry required for this phase.
  for (const table of ["providers", "provider_capability_links"]) {
    const [existing] = await tx.unsafe(
      `SELECT count(*)::integer AS count FROM ${table}`,
    );
    if (existing.count)
      throw new Error(
        "Provider overlay is not empty; explicit reconciliation required.",
      );
    for (const row of bundle.tables[table]!) await insert(table, row);
  }
  if (bundle.tables.tutorial_settings!.length > 1)
    throw new Error("Invalid tutorial settings singleton.");
  for (const settings of bundle.tables.tutorial_settings!) {
    // A freshly bootstrapped singleton may exist; only settings id=1 is replaced,
    // after every user/content table was verified empty inside this transaction.
    await tx`DELETE FROM tutorial_settings WHERE id=1`;
    await insert("tutorial_settings", {
      ...settings,
      drive_autoupload_enabled: false,
      thumbnail_generation_mode: "manual",
    });
  }
  const context = {
    targetJobColumns: targetColumns.tutorial_jobs!,
    userIds,
    channelIds,
    presetIds,
    sourceJobIds,
  };
  const importedJobIds: string[] = [];
  for (let index = 0; index < sourceJobs.length; index++) {
    const source = sourceJobs[index];
    const plan = planTutorialImport(source, context);
    const snapshot = prepareLegacyTutorialArchive({
      sourceSystem: bundle.sourceSystem,
      sourceTable: "tutorial_jobs",
      sourceJSON: bundle.rawJobs[index]!,
      knownUserIds: userIds,
    });
    // Archive original bytes BEFORE any runtime projection, within same transaction.
    await insert("tutorial_legacy_archive", snapshot);
    counts.archives++;
    if (plan.disposition !== "runtime_candidate") {
      counts.archiveOnly++;
      if (plan.disposition === "requires_explicit_resume") counts.needsResume++;
      continue;
    }
    await insert("tutorial_jobs", plan.row);
    counts.runtimeJobs++;
    importedJobIds.push(String(source.id));
    await tx`UPDATE tutorial_legacy_archive SET runtime_job_id=${source.id} WHERE source_system=${bundle.sourceSystem} AND source_table='tutorial_jobs' AND source_id=${source.id} AND snapshot_sha256=${snapshot.snapshot_sha256}`;
  }
  for (const raw of bundle.rawDerivatives) {
    const source = JSON.parse(raw);
    const parent = sourceJobs.find((row) => row.id === source.source_job_id);
    if (!parent) throw new Error("Derivative source dependency missing.");
    await insert(
      "tutorial_legacy_archive",
      prepareLegacyTutorialArchive({
        sourceSystem: bundle.sourceSystem,
        sourceTable: "tutorial_derivatives",
        sourceJSON: raw,
        knownUserIds: userIds,
        parent,
      }),
    );
    counts.archives++;
    counts.archiveOnly++;
  }
  if (options.includeAssets) {
    if (!bundle.unapplied.characterClosureIncluded)
      throw new Error(
        "Asset import requires a new character-closure source snapshot; never overwrite the earlier bundle.",
      );
    const assetTables = [...BRANDING_TABLES, "storage_artifact_versions"];
    for (const table of assetTables) {
      if (!targetColumns[table]) continue;
      await tx.unsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      const [existing] = await tx.unsafe(
        `SELECT count(*)::integer AS count FROM ${table}`,
      );
      if (existing.count) throw new Error("Asset target is not empty.");
    }
    // Never invent missing closure IDs or strip a broken FK to make import pass.
    const ids = (table: string) =>
      new Set((bundle.tables[table] ?? []).map((row) => String(row.id)));
    const archetypes = ids("thumbnail_archetypes");
    const bookmarks = ids("thumbnail_bookmarks");
    const thumbnails = ids("thumbnails");
    const characterIds = ids("characters");
    const check = (value: unknown, allowed: Set<string>) => {
      if (value && !allowed.has(String(value)))
        throw new Error("Asset dependency closure incomplete.");
    };
    const orderedThumbnails: Row[] = [];
    const pending = new Map(
      (bundle.tables.thumbnails ?? []).map((row) => [String(row.id), row]),
    );
    while (pending.size) {
      let progressed = false;
      for (const [id, row] of pending) {
        check(row.parent_thumbnail_id, thumbnails);
        if (
          row.parent_thumbnail_id &&
          pending.has(String(row.parent_thumbnail_id))
        )
          continue;
        orderedThumbnails.push(row);
        pending.delete(id);
        progressed = true;
      }
      if (!progressed) throw new Error("Cyclic thumbnail lineage rejected.");
    }
    for (const table of [
      "characters",
      "character_images",
      "character_channels",
      "thumbnail_archetypes",
      "thumbnail_bookmarks",
      "channel_thumbnail_profiles",
      "channel_thumbnail_archetypes",
      "tutorial_background_presets",
      "tutorial_intro_hosts",
      "thumbnails",
    ]) {
      const rows =
        table === "thumbnails"
          ? orderedThumbnails
          : (bundle.tables[table] ?? []);
      if (!targetColumns[table]) {
        if (rows.length) counts.unappliedAssetTables[table] = rows.length;
        continue; // Retained in protected bundle; counted unapplied.
      }
      for (const row of rows) {
        if (
          table === "characters" &&
          (row.archetype_id || row.reference_sheet_asset_id)
        )
          throw new Error(
            "Legacy character model-sheet/archetype dependency requires explicit expanded import; retained in protected bundle.",
          );
        check(row.character_id, characterIds);
        check(row.channel_id, channelIds);
        check(row.archetype_id, archetypes);
        check(row.from_bookmark_id, bookmarks);
        if (table === "thumbnails" && row.subject_kind === "tutorial_job")
          check(row.subject_id, sourceJobIds);
        counts.unsupportedAssetColumns += Object.keys(row).filter(
          (key) => !targetColumns[table]!.has(key),
        ).length;
        await insert(table, row);
        counts.importedBrandingRows++;
      }
    }
    const runtimeIds = new Set(importedJobIds);
    for (const row of bundle.tables.storage_artifacts ?? []) {
      if (
        row.owner_kind !== "tutorial_job" ||
        !sourceJobIds.has(String(row.job_id))
      )
        throw new Error(
          "Storage owner is outside the archived tutorial scope.",
        );
      check(row.channel_id, channelIds);
      check(row.source_job_id, sourceJobIds);
      counts.unsupportedAssetColumns += Object.keys(row).filter(
        (key) => !targetColumns.storage_artifacts!.has(key),
      ).length;
      // Retain paths/remote evidence verbatim; do not resume a source upload session.
      await insert("storage_artifacts", {
        ...row,
        resumable_session_uri: null,
      });
      counts.importedStorageRows++;
      if (!runtimeIds.has(String(row.job_id))) counts.archiveOwnedStorageRows++;
      if (row.drive_file_id) {
        if (!targetColumns.storage_artifact_versions)
          throw new Error("Drive history migration 0097 required.");
        await insert("storage_artifact_versions", {
          artifact_id: row.id,
          drive_file_id: row.drive_file_id,
          vps_path: row.vps_path,
          bytes: row.bytes,
          checksum_sha256: row.checksum_sha256,
          drive_md5: row.drive_md5,
          verified_at: row.verified_at,
        });
        counts.driveHistoryRows++;
      }
    }
    counts.unappliedBrandingRows -= counts.importedBrandingRows;
    counts.unappliedStorageRows -= counts.importedStorageRows;
  }
  await tx`INSERT INTO system_settings(id,tutorial_dispatch_paused,uploader) VALUES('singleton',true,'{"enabled":false,"executionMode":"dry_run"}') ON CONFLICT(id) DO UPDATE SET tutorial_dispatch_paused=true,uploader='{"enabled":false,"executionMode":"dry_run"}'`;
  // Source-history imports are not new production milestones. Remove only
  // trigger events generated inside THIS fresh-target transaction, before any
  // observer can see them. No FK/trigger disabling and no historical deletion.
  if (importedJobIds.length) {
    await tx`DELETE FROM tutorial_keyword_outbox WHERE tutorial_job_id=ANY(${importedJobIds}::uuid[])`;
    await tx`DELETE FROM tutorial_job_events WHERE tutorial_job_id=ANY(${importedJobIds}::uuid[])`;
    for (const jobId of importedJobIds)
      await tx`INSERT INTO tutorial_job_events(tutorial_job_id,event_type,payload) VALUES(${jobId},'migration_imported',${tx.json({ sourceSystem: bundle.sourceSystem, sourceId: jobId, approved: false, enqueued: false })})`;
  }
  return counts;
}

const PROVIDER_ENV_ALLOWLIST = new Set([
  "DEEPSEEK_API_KEY",
  "FISH_API_KEY",
  "ELEVENLABS_API_KEY",
  "AI33_API_KEY",
  "AI33_API_KEY_2",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "INWORLD_API_KEY",
  "INWORLD_BASIC_AUTH",
  "MINIMAX_API_KEY",
]);
export function selectProviderEnvironment(
  source: Record<string, string | undefined>,
  requested: string[],
) {
  if (
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((name) => !PROVIDER_ENV_ALLOWLIST.has(name))
  )
    throw new Error(
      "Only explicit supported provider credential names may be transferred.",
    );
  const values: Record<string, string> = {};
  for (const name of requested) {
    const value = source[name];
    if (!value)
      throw new Error("A requested source provider credential is absent.");
    values[name] = value;
  }
  return { version: "tutorial-provider-environment/1", values };
}
export async function writeProtectedProviderEnvironment(
  path: string,
  selected: ReturnType<typeof selectProviderEnvironment>,
) {
  const absolute = await protectedPath(path, false);
  const text = JSON.stringify(selected);
  const file = await open(absolute, "wx", 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  return {
    checksum: bundleFingerprint(text),
    credentialCount: Object.keys(selected.values).length,
  };
}
