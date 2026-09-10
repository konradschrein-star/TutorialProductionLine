/** Local binary relay only: no media filesystem operations, no key creation. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pipeline } from "node:stream/promises";

function aggregate(text: string, keys: string[]) {
  const parsed = JSON.parse(text);
  const result: Record<string, number> = {};
  if (Object.keys(parsed).length !== keys.length)
    throw new Error("Unexpected aggregate fields.");
  for (const key of keys) {
    if (!Number.isSafeInteger(parsed[key]) || parsed[key] < 0)
      throw new Error("Invalid aggregate.");
    result[key] = parsed[key];
  }
  return result;
}
/** Exported for synthetic child-process tests; caller supplies already-spawned streams. */
export async function relayChildren(
  source: ChildProcessWithoutNullStreams,
  destination: ChildProcessWithoutNullStreams,
) {
  let sourceReport = "",
    destinationReport = "";
  let overflow = false;
  const bounded = (current: string, chunk: Buffer) => {
    if (current.length + chunk.length > 4096) {
      overflow = true;
      source.kill();
      destination.kill();
      return current;
    }
    return current + chunk.toString("utf8");
  };
  source.stderr.on("data", (chunk) => {
    sourceReport = bounded(sourceReport, chunk);
  });
  destination.stdout.on("data", (chunk) => {
    destinationReport = bounded(destinationReport, chunk);
  });
  // SSH/docker diagnostics may contain private locations. Never relay or log.
  destination.stderr.resume();
  source.stdin.end();
  const done = (child: ChildProcessWithoutNullStreams) =>
    new Promise<void>((resolve, reject) => {
      child.once("error", () => reject(new Error("SSH process failed.")));
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("SSH process failed.")),
      );
    });
  const timeout = setTimeout(
    () => {
      source.kill();
      destination.kill();
    },
    8 * 60 * 60 * 1000,
  );
  try {
    await Promise.all([
      done(source),
      done(destination),
      pipeline(source.stdout, destination.stdin),
    ]);
    if (overflow) throw new Error("Aggregate limit exceeded.");
    return {
      source: aggregate(sourceReport, ["sent", "skippedChanged"]),
      destination: aggregate(destinationReport, [
        "copied",
        "alreadyIdentical",
        "existingMismatch",
        "sourceChanged",
        "bytesCopied",
      ]),
    };
  } catch {
    source.kill();
    destination.kill();
    throw new Error("Memory relay failed; private details suppressed.");
  } finally {
    clearTimeout(timeout);
  }
}
export function relayCommands(
  manifest: string,
  checksum: string,
  image: string,
) {
  if (
    !/^\/var\/tmp\/tutorial-migration-[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.json$/.test(
      manifest,
    ) ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    !/^sha256:[a-f0-9]{64}$/.test(image)
  )
    throw new Error("Strict relay arguments required.");
  const source = `node /var/tmp/tutorial-migration-20260908-recovery/media-transfer-cli.mjs --mode send-stream --confirm-transfer tutorial-recovery-staging --manifest ${manifest} --sha256 ${checksum}`;
  const destination = `docker run -i --rm --network none --memory 256m --cpus 0.75 --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node --mount type=bind,source=/opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs,target=/opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs,readonly --mount type=bind,source=/opt/tutorial-recovery-staging/media,target=/opt/tutorial-recovery-staging/media ${image} /opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs --mode receive --confirm-target tutorial-recovery-staging`;
  return { source, destination };
}
export async function runMemoryRelay(
  manifest: string,
  checksum: string,
  image: string,
) {
  const commands = relayCommands(manifest, checksum, image);
  const ssh = (alias: string, command: string) =>
    spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=10",
        alias,
        command,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  return relayChildren(
    ssh("cf-vps-deploy", commands.source),
    ssh("vps2", commands.destination),
  );
}
