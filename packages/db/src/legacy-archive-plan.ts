import { createHash } from "node:crypto";
const SECRET_KEY =
  /(password|secret|credential|cookie|api[_-]?key|token|authorization|private[_-]?key)/i;
export function assertArchivePayloadSafe(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertArchivePayloadSafe(item);
    return;
  }
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key))
        throw new Error(
          "Credentials and password material are forbidden in the tutorial archive.",
        );
      assertArchivePayloadSafe(item);
    }
}
/** Builds an immutable source snapshot without reading/writing any service.
 * Preserve sourceJSON verbatim; do not dump it to logs or synced local files. */
export function prepareLegacyTutorialArchive(input: {
  sourceSystem: string;
  sourceTable: "tutorial_jobs" | "tutorial_derivatives";
  sourceJSON: string;
  knownUserIds: ReadonlySet<string>;
  parent?: { id: string; created_by: string; title: string };
}) {
  if (!["tutorial_jobs", "tutorial_derivatives"].includes(input.sourceTable))
    throw new Error("Only tutorial source tables are permitted.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.sourceSystem))
    throw new Error("Invalid source system identifier.");
  if (Buffer.byteLength(input.sourceJSON) > 16 * 1024 * 1024)
    throw new Error("Source row exceeds archive size limit.");
  const row = JSON.parse(input.sourceJSON) as Record<string, unknown>;
  if (!row || Array.isArray(row) || typeof row !== "object")
    throw new Error("Source row must be a JSON object.");
  assertArchivePayloadSafe(row);
  const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    );
  if (!uuid(row.id) || typeof row.status !== "string")
    throw new Error("Source identity and exact status are required.");
  const derivative = input.sourceTable === "tutorial_derivatives";
  if (
    derivative &&
    (!uuid(row.source_job_id) ||
      !input.parent ||
      input.parent.id !== row.source_job_id)
  )
    throw new Error("Derivative requires its exact source relationship.");
  const sourceOwner = derivative ? input.parent!.created_by : row.created_by;
  if (!uuid(sourceOwner)) throw new Error("Source owner identity is required.");
  const sourceParent = derivative
    ? String(row.source_job_id)
    : uuid(row.parent_job_id)
      ? row.parent_job_id
      : null;
  const sourceChannel = uuid(row.channel_id) ? row.channel_id : null;
  return {
    source_system: input.sourceSystem,
    source_table: input.sourceTable,
    source_id: row.id,
    source_parent_id: sourceParent,
    source_owner_id: sourceOwner,
    owner_user_id: input.knownUserIds.has(sourceOwner) ? sourceOwner : null,
    source_channel_id: sourceChannel,
    title: derivative
      ? `${input.parent!.title} · ${String(row.language ?? "unknown locale")}`
      : typeof row.title === "string"
        ? row.title
        : "Untitled legacy tutorial",
    language: typeof row.language === "string" ? row.language : null,
    source_status: row.status,
    needs_routing:
      !derivative &&
      !sourceChannel &&
      !["COMPLETED", "CANCELLED"].includes(row.status),
    source_json: input.sourceJSON,
    snapshot_sha256: createHash("sha256")
      .update(input.sourceJSON)
      .digest("hex"),
  };
}
