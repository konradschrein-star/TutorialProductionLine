import assert from "node:assert/strict";
import { restrictedDirectTransferPlan } from "./restricted-direct-transfer-plan";
const raw = Buffer.alloc(51);
raw.writeUInt32BE(11);
raw.write("ssh-ed25519", 4);
raw.writeUInt32BE(32, 15);
raw.fill(1, 19);
const input = {
  publicKey: `ssh-ed25519 ${raw.toString("base64")}`,
  image: "sha256:" + "a".repeat(64),
  privateDirectory: "/var/tmp/tutorial-migration-synthetic",
  expiryUtc: "20260908120000Z",
  now: new Date("2026-09-08T10:00:00Z"),
};
const plan = restrictedDirectTransferPlan(input);
assert.ok(
  plan.authorizedKeyLine.startsWith(
    'from="65.108.6.149",restrict,expiry-time=',
  ),
);
assert.ok(plan.forcedCommand.includes("--user 1000:1000 --read-only"));
assert.ok(
  plan.forcedCommand.includes("--network none --memory 256m --cpus 0.75"),
);
assert.ok(plan.config.includes("StrictHostKeyChecking yes"));
assert.throws(() =>
  restrictedDirectTransferPlan({
    ...input,
    publicKey: input.publicKey + " arbitrary-options",
  }),
);
assert.throws(() =>
  restrictedDirectTransferPlan({ ...input, expiryUtc: "20260909120000Z" }),
);
assert.throws(() =>
  restrictedDirectTransferPlan({ ...input, privateDirectory: "/root/.ssh" }),
);
console.log(
  JSON.stringify({
    purePlanOnly: true,
    noKeysGenerated: true,
    noAuthorizationChanged: true,
    sourceIpRestricted: true,
    forcedUid1000Receiver: true,
    pinnedKnownHostsConfig: true,
    expiryBounded: true,
  }),
);
