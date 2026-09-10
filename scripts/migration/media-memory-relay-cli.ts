import { runMemoryRelay } from "./media-memory-relay";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!, process.argv[i + 1] ?? "");
try {
  if (args.get("--confirm-transfer") !== "tutorial-recovery-staging")
    throw new Error("Confirmation required.");
  console.log(
    JSON.stringify(
      await runMemoryRelay(
        args.get("--manifest") ?? "",
        args.get("--sha256") ?? "",
        args.get("--receiver-image") ?? "",
      ),
    ),
  );
} catch {
  console.error(
    "MEMORY_RELAY_FAILED: private details suppressed; no media files written locally.",
  );
  process.exitCode = 1;
}
