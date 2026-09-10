SET ROLE tutorial;

INSERT INTO system_settings (id, storage)
VALUES (
  'singleton',
  '{"retentionDays":90,"maxUploadBytes":53687091200,"driveEnabled":true,"driveRootFolderName":"Content Forge","driveTutorialsFolderName":"_Tutorials","driveRequestsPerSecond":4,"driveBatchSize":5,"driveScanIntervalMinutes":5,"driveLookbackDays":14,"driveMaxAttempts":5,"driveDailyBudgetGb":500}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET storage = jsonb_set(
  coalesce(system_settings.storage, '{}'::jsonb),
  '{driveEnabled}',
  'true'::jsonb,
  true
), updated_at = now();

UPDATE tutorial_settings
SET drive_autoupload_enabled = true
WHERE id = 1;
