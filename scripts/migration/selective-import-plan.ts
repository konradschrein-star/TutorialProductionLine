/** Pure migration planning only. No database, filesystem, logging or network I/O.
 * Input may contain private account data: never serialize a real plan to logs,
 * a repository, OneDrive or an unencrypted local staging file. */
type Row = Record<string, unknown>;
const ROLES = new Set(["ADMIN", "MANAGER", "PRODUCTION_VA", "UPLOADER_VA", "VIEWER", "DRAMA_OPERATOR", "TUTORIAL_VA", "INVESTOR", "TUTORIAL_VISITOR"]);
const USER_COLUMNS = ["id", "email", "name", "role", "password_hash", "is_active", "default_tutorial_channel_id", "created_at", "updated_at"];
const UNSUPPORTED_WORKFLOWS = new Set(["AWAITING_RECORDINGS", "READY_TO_STITCH", "SENT_TO_STITCHER"]);
const IN_FLIGHT = new Set(["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "SPLICING"]);
const KNOWN_STATUS = new Set(["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "READY_TO_RECORD", "AWAITING_UPLOAD", "SPLICING", "COMPLETED", "FAILED_SCRIPT", "FAILED_AUDIO", "FAILED_SPLICE", "CANCELLED", "AWAITING_RECORDINGS", "RECORDED", "READY_TO_STITCH", "SENT_TO_STITCHER"]);
export interface ImportContext {
  targetJobColumns: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string>;
  presetIds: ReadonlySet<string>;
  sourceJobIds: ReadonlySet<string>;
  /** Only Admin-approved new-root remaps; longest prefix wins. No implicit remap. */
  pathMappings?: ReadonlyArray<{ from: string; to: string }>;
}
function select(row: Row, columns: ReadonlySet<string> | string[]): Row {
  const allowed = columns instanceof Set ? columns : new Set(columns);
  return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)));
}
export function planUserImport(source: Row, channelIds: ReadonlySet<string>) {
  const blockers: string[] = [];
  if (!ROLES.has(String(source.role))) blockers.push("unsupported_role_no_promotion");
  if (typeof source.password_hash !== "string" || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(source.password_hash)) blockers.push("password_hash_not_supported_bcrypt");
  if (source.default_tutorial_channel_id && !channelIds.has(String(source.default_tutorial_channel_id))) blockers.push("default_channel_missing");
  // Preserve exact UUID, existing bcrypt bytes, role and active state. Cookies
  // belong to another security domain and are deliberately not projected.
  return { row: select(source, USER_COLUMNS), blockers };
}
function remapPath(value: unknown, mappings: ImportContext["pathMappings"]) {
  if (typeof value !== "string") return value;
  const mapping = [...(mappings ?? [])].sort((a, b) => b.from.length - a.from.length).find(({ from }) => value === from || value.startsWith(`${from}/`));
  return mapping ? `${mapping.to}${value.slice(mapping.from.length)}` : value;
}
export function planTutorialImport(source: Row, context: ImportContext) {
  const blockers: string[] = [];
  const archiveOnlyReasons: string[] = [];
  if (!context.userIds.has(String(source.created_by))) blockers.push("creator_missing");
  if (source.channel_id && !context.channelIds.has(String(source.channel_id))) blockers.push("channel_missing");
  if (source.prompt_preset_id && !context.presetIds.has(String(source.prompt_preset_id))) blockers.push("prompt_preset_missing");
  if (source.parent_job_id && !context.sourceJobIds.has(String(source.parent_job_id))) blockers.push("parent_job_missing");
  if (!KNOWN_STATUS.has(String(source.status))) archiveOnlyReasons.push("unsupported_legacy_status");
  if (source.parent_job_id || source.stitch_job_id || UNSUPPORTED_WORKFLOWS.has(String(source.status))) archiveOnlyReasons.push("parked_segment_or_stitch_workflow");
  if (!source.channel_id) archiveOnlyReasons.push(source.status === "COMPLETED" || source.status === "CANCELLED" ? "historical_unmapped_channel" : "active_job_requires_admin_routing");
  const row = select(source, context.targetJobColumns);
  if (row.language === "English") row.language = "en";
  if (!row.language) archiveOnlyReasons.push("language_unknown_no_inference");
  for (const field of ["audio_path", "recording_path", "final_path", "long_audio_path", "transcript_path"]) if (field in row) row[field] = remapPath(row[field], context.pathMappings);
  // Legacy review is historical evidence only. It did not bind exact bytes.
  // Keep the complete original row separately, including its review fields.
  for (const field of ["publication_approval", "localization_source_revision", "scheduled_for", "uploader_status", "uploader_job_id", "uploader_event_id", "uploader_last_callback_at", "upload_verified_at", "youtube_visibility", "youtube_published_at", "uploaded_at", "uploaded_by", "youtube_upload_url", "source_job_id"]) if (context.targetJobColumns.has(field)) row[field] = null;
  if (context.targetJobColumns.has("is_uploaded")) row.is_uploaded = false;
  return {
    // Must be stored losslessly in protected target migration archive BEFORE
    // any transformed runtime row is inserted. This module performs no writes.
    archive: { sourceTable: "tutorial_jobs", sourceId: String(source.id), sourceRow: structuredClone(source) },
    row,
    blockers,
    archiveOnlyReasons,
    disposition: blockers.length ? "blocked_dependency" : archiveOnlyReasons.length ? "archive_only" : IN_FLIGHT.has(String(source.status)) ? "requires_explicit_resume" : "runtime_candidate",
    approvedForDispatch: false as const,
  };
}
export function planDerivativeArchive(source: Row, sourceJobIds: ReadonlySet<string>) {
  // Do not manufacture locale jobs: the old format lacks routing, metadata,
  // exact approval and new localization provenance. Keep source relationship.
  return { archive: { sourceTable: "tutorial_derivatives", sourceId: String(source.id), sourceRow: structuredClone(source) }, sourceJobId: source.source_job_id, disposition: "archive_only", blockers: sourceJobIds.has(String(source.source_job_id)) ? [] : ["derivative_source_missing"] };
}
