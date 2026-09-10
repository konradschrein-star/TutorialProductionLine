/** Run only on a protected Linux server. Never prints private payloads/errors. */
import postgres from "postgres";
import {
  planPrivateMediaManifest,
  writePrivateMediaManifest,
} from "./private-media-manifest";
import {
  collectSourceBundle,
  writeProtectedBundle,
  readProtectedBundle,
  importBundleIntoTransaction,
  assertFreshTargetName,
  selectProviderEnvironment,
  writeProtectedProviderEnvironment,
} from "./secure-selective-bundle";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!, process.argv[i + 1] ?? "");
const get = (name: string) => {
  const value = args.get(name);
  if (!value) throw new Error("Required migration argument missing.");
  return value;
};
class RehearsalRollback extends Error {}
let connection: ReturnType<typeof postgres> | undefined;
try {
  const mode = get("--mode");
  if (mode === "media-plan") {
    const checksum = get("--sha256");
    const bundle = await readProtectedBundle(get("--bundle"), checksum);
    const manifest = await planPrivateMediaManifest(
      bundle,
      get("--media-roots").split(","),
      checksum,
    );
    console.log(
      JSON.stringify(
        await writePrivateMediaManifest(get("--manifest"), manifest),
      ),
    );
  } else if (mode === "export-env") {
    const artifact = selectProviderEnvironment(
      process.env,
      get("--allowlist").split(","),
    );
    console.log(
      JSON.stringify(
        await writeProtectedProviderEnvironment(get("--bundle"), artifact),
      ),
    );
  } else if (mode === "export") {
    const url = process.env.SOURCE_DATABASE_URL ?? "";
    if (
      decodeURIComponent(new URL(url).pathname.slice(1)) !==
      get("--confirm-source-db")
    )
      throw new Error("Source confirmation mismatch.");
    connection = postgres(url, { max: 1 });
    const bundle = await connection.begin(
      "isolation level repeatable read read only",
      (tx) => collectSourceBundle(tx, get("--source-system")),
    );
    const result = await writeProtectedBundle(get("--bundle"), bundle);
    console.log(
      JSON.stringify({
        ...result,
        counts: {
          users: bundle.tables.users!.length,
          channels: bundle.tables.channels!.length,
          jobs: bundle.rawJobs.length,
          derivatives: bundle.rawDerivatives.length,
          unappliedBrandingRows: bundle.unapplied.brandingRows,
          unappliedStorageRows: bundle.unapplied.storageRows,
        },
      }),
    );
  } else if (mode === "import") {
    const url = process.env.TARGET_DATABASE_URL ?? "";
    const confirmedTargetName = assertFreshTargetName(
      url,
      get("--confirm-empty-target"),
    );
    if (get("--accept-phase-one") !== "yes")
      throw new Error("Phase-one acknowledgment required.");
    const commit = get("--commit");
    if (!["yes", "no"].includes(commit))
      throw new Error("Commit must be explicitly yes or no.");
    const bundle = await readProtectedBundle(get("--bundle"), get("--sha256"));
    const primaryInput = get("--primary-channel-ids");
    const primaryChannelIds = new Set(
      primaryInput === "none" ? [] : primaryInput.split(",").filter(Boolean),
    );
    connection = postgres(url, { max: 1 });
    let result: unknown;
    try {
      await connection.begin(async (tx) => {
        result = await importBundleIntoTransaction(tx, bundle, {
          acceptPhaseOne: true,
          includeAssets: args.get("--include-assets") === "yes",
          primaryChannelIds,
          confirmedTargetName,
        });
        if (commit === "no") throw new RehearsalRollback();
      });
    } catch (error) {
      if (!(error instanceof RehearsalRollback)) throw error;
    }
    console.log(
      JSON.stringify({ committed: commit === "yes", counts: result }),
    );
  } else throw new Error("Unsupported migration mode.");
} catch {
  // PostgreSQL errors can embed full SQL/row values. Never serialize them.
  console.error(
    "MIGRATION_FAILED: no private payload logged; inspect inputs and schema using safe aggregate diagnostics.",
  );
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
