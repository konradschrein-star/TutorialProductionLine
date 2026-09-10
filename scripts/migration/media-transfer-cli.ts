/** Bundle on Linux servers only. Fixed receiver command: no private shell paths. */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { protectedPath, bundleFingerprint } from "./secure-selective-bundle";
import {
  selectTransferEntries,
  sendMedia,
  receiveMedia,
} from "./media-transfer";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!, process.argv[i + 1] ?? "");
try {
  if (process.platform !== "linux") throw new Error("Linux server required.");
  if (args.get("--mode") === "receive") {
    if (args.get("--confirm-target") !== "tutorial-recovery-staging")
      throw new Error("Explicit staging confirmation required.");
    console.log(JSON.stringify(await receiveMedia(process.stdin)));
  } else if (["send", "send-stream"].includes(args.get("--mode") ?? "")) {
    if (args.get("--confirm-transfer") !== "tutorial-recovery-staging")
      throw new Error("Explicit transfer confirmation required.");
    const text = await readFile(
      await protectedPath(args.get("--manifest") ?? "", true),
      "utf8",
    );
    if (
      !/^[a-f0-9]{64}$/.test(args.get("--sha256") ?? "") ||
      bundleFingerprint(text) !== args.get("--sha256")
    )
      throw new Error("Manifest checksum mismatch.");
    const entries = selectTransferEntries(JSON.parse(text));
    if (args.get("--mode") === "send-stream") {
      process.stdout.on("error", () => {
        process.exitCode = 1;
      });
      const counts = await sendMedia(entries, process.stdout);
      process.stderr.write(JSON.stringify(counts) + "\n");
    } else {
      const host = args.get("--ssh-host") ?? "";
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(host))
        throw new Error("Configured SSH alias required.");
      const child = spawn(
        "ssh",
        [
          ...(args.has("--ssh-config")
            ? ["-F", await protectedPath(args.get("--ssh-config")!, true)]
            : []),
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          host,
          "node /opt/tutorial-recovery-staging/tools/media-transfer-cli.mjs --mode receive --confirm-target tutorial-recovery-staging",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      // Remote errors may contain private paths; discard them, emit aggregate only.
      child.stderr.resume();
      child.stdin.on("error", () => {});
      let remote = "";
      child.stdout.on("data", (chunk) => {
        if (remote.length < 8192) remote += chunk.toString();
      });
      const completion = once(child, "close");
      try {
        const sent = await Promise.race([
          sendMedia(entries, child.stdin),
          completion.then(() => {
            throw new Error("Receiver ended before source completed.");
          }),
        ]);
        child.stdin.end();
        const [code] = await completion;
        if (code !== 0) throw new Error("Receiver failed.");
        const received = JSON.parse(remote);
        const safe: Record<string, number> = {};
        for (const key of [
          "copied",
          "alreadyIdentical",
          "existingMismatch",
          "sourceChanged",
          "bytesCopied",
        ]) {
          if (!Number.isSafeInteger(received[key]) || received[key] < 0)
            throw new Error("Receiver response invalid.");
          safe[key] = received[key];
        }
        console.log(JSON.stringify({ source: sent, destination: safe }));
      } catch {
        child.kill();
        throw new Error("Transfer incomplete.");
      }
    }
  } else throw new Error("Unsupported mode.");
} catch {
  console.error(
    "MEDIA_TRANSFER_FAILED: private details suppressed; no existing destination files overwritten.",
  );
  process.exitCode = 1;
}
