import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { relayChildren, relayCommands } from "./media-memory-relay";
const child = (code: string) =>
  spawn(process.execPath, ["-e", code], { stdio: ["pipe", "pipe", "pipe"] });
const result = await relayChildren(
  child(
    "process.stdout.write(Buffer.from([0,255,10,13,128]));process.stderr.write(JSON.stringify({sent:1,skippedChanged:0}));",
  ),
  child(
    "let n=0;process.stdin.on('data',b=>n+=b.length);process.stdin.on('end',()=>console.log(JSON.stringify({copied:1,alreadyIdentical:0,existingMismatch:0,sourceChanged:0,bytesCopied:n})));",
  ),
);
assert.equal(result.destination.bytesCopied, 5);
await assert.rejects(
  relayChildren(
    child(
      "process.stderr.write('private-unexpected-diagnostic');process.exit(1)",
    ),
    child("process.stdin.resume()"),
  ),
  /private details suppressed/,
);
assert.throws(
  () =>
    relayCommands(
      "/tmp/bad; echo secret",
      "a".repeat(64),
      "sha256:" + "b".repeat(64),
    ),
  /Strict/,
);
const commands = relayCommands(
  "/var/tmp/tutorial-migration-synthetic/pilot.json",
  "a".repeat(64),
  "sha256:" + "b".repeat(64),
);
assert.ok(commands.destination.includes("--user 1000:1000"));
assert.ok(commands.destination.includes("--network none"));
assert.ok(commands.destination.includes("--memory 256m --cpus 0.75"));
assert.ok(commands.source.includes("media-transfer-cli.mjs"));
assert.ok(!commands.destination.includes(".cjs"));
console.log(
  JSON.stringify({
    syntheticOnly: true,
    binaryMemoryRelay: true,
    noMediaFiles: true,
    failureTerminatesBoth: true,
    fixedAliasesAndCommands: true,
    nodeUid1000: true,
  }),
);
