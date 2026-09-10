export const tutorialShipPrerequisite =
  "0068_tutorial_ship_schema_prerequisites.sql" as const;

export const tutorialShipMigrations = [
  tutorialShipPrerequisite,
  "0069_tutorial_uploads_tracking.sql",
  "0064_channel_is_primary.sql",
  "0076_tutorial_channel_network.sql",
  "0077_thumbnail_generation_mode.sql",
  "0079_tutorial_uploader_lifecycle.sql",
  "0080_user_presence.sql",
  "0081_thumbnail_library_assets.sql",
  "0082_thumbnail_rotation_settings.sql",
  "0083_uploader_settings.sql",
  "0084_tutorial_thumbnail_copy.sql",
  "0085_tutorial_uploader_exchange.sql",
  "0086_channel_uploader_mapping.sql",
  "0087_tutorial_uploader_verified_projection.sql",
  "0088_office_thumbnail_backgrounds.sql",
  "0089_tutorial_thumbnail_drafts.sql",
  "0090_tutorial_dispatch_pause.sql",
  "0091_tutorial_publication_approval.sql",
  "0092_tutorial_localization_revision.sql",
  "0093_tutorial_job_events.sql",
  "0094_tutorial_observation_idempotency.sql",
  "0095_tutorial_scheduled_delivery.sql",
  "0096_tutorial_keyword_outbox.sql",
  "0097_storage_artifact_versions.sql",
  "0098_tutorial_legacy_archive.sql",
  "0099_storage_versions_append_only.sql",
  "0100_thumbnail_workspace.sql",
  "0101_tutorial_thumbnail_fanout.sql",
  "0102_tutorial_thumbnail_ai_batches.sql",
  "0103_tutorial_thumbnail_retry_audit.sql",
  "0104_user_tutorial_preferences.sql",
  "0105_tutorial_keyword_identity_v2.sql",
] as const;

/**
 * Resolve the audited migration suffix while always reconciling the baseline
 * prerequisites first.  Existing installations commonly deploy only a suffix
 * (`--from 0105...`); skipping the reconciliation there would recreate the
 * exact clean/existing schema split this bootstrap fixes.
 */
export function resolveTutorialShipMigrationPlan(args: string[]): string[] {
  if (args.length === 0) return [...tutorialShipMigrations];
  if (
    args.length !== 2 ||
    args[0] !== "--from" ||
    !tutorialShipMigrations.includes(
      args[1] as (typeof tutorialShipMigrations)[number],
    )
  ) {
    throw new Error(
      "Usage: apply-tutorial-ship-migrations.ts [--from exact-migration-filename.sql]",
    );
  }

  const requested = args[1]!;
  const start = tutorialShipMigrations.indexOf(
    requested as (typeof tutorialShipMigrations)[number],
  );
  const suffix = tutorialShipMigrations.slice(start);
  return requested === tutorialShipPrerequisite
    ? [...suffix]
    : [tutorialShipPrerequisite, ...suffix];
}
