import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import {
  sendMedia,
  receiveMedia,
  selectTransferEntries,
} from "./media-transfer";
const base = await mkdtemp(join(tmpdir(), "tutorial-media-synthetic-"));
const source = join(base, "source");
const target = join(base, "target");
await mkdir(source);
await mkdir(target);
const path = join(source, "sample.bin");
const bytes = Buffer.from("Synthetic media only");
await writeFile(path, bytes);
const entry = {
  path,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
async function transfer(row = entry) {
  const stream = new PassThrough();
  const receiver = receiveMedia(stream, target, 0);
  const sent = await sendMedia([row], stream, source);
  stream.end();
  return { sent, received: await receiver };
}
assert.equal((await transfer()).received.copied, 1);
assert.equal((await transfer()).received.alreadyIdentical, 1);
assert.equal(
  (await transfer({ ...entry, sha256: "0".repeat(64) })).received.sourceChanged,
  1,
);
await writeFile(join(target, "sample.bin"), "Keep destination mismatch");
assert.equal((await transfer()).received.existingMismatch, 1);
assert.equal(
  await readFile(join(target, "sample.bin"), "utf8"),
  "Keep destination mismatch",
);
await writeFile(path, "Changed source size");
assert.equal((await transfer()).sent.skippedChanged, 1);
assert.deepEqual(await readdir(target), ["sample.bin"]);
assert.throws(
  () =>
    selectTransferEntries(
      {
        version: "tutorial-private-media-manifest/2",
        files: [
          { ...entry, path: join(base, "escape"), state: "local_verified" },
        ],
      },
      source,
    ),
  /outside/,
);
const preflight = new PassThrough();
const rejected = receiveMedia(preflight, target, Number.MAX_SAFE_INTEGER);
const sent = sendMedia([], preflight, source);
await sent;
preflight.end();
await assert.rejects(rejected, /headroom/);
console.log(
  JSON.stringify({
    syntheticOnly: true,
    noNetwork: true,
    verifiedCopy: true,
    idempotentIdentical: true,
    mismatchNeverOverwritten: true,
    changedSourceSkipped: true,
    partialFilesCleaned: true,
    pathEscapeRejected: true,
    headroomGuard: true,
  }),
);
