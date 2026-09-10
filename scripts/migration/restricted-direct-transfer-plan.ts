/** Pure plan only: no SSH, key generation, files, authorized_keys or config writes. */
import { relayCommands } from "./media-memory-relay";
export function restrictedDirectTransferPlan(input: {
  publicKey: string;
  image: string;
  privateDirectory: string;
  expiryUtc: string;
  now?: Date;
}) {
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(input.publicKey))
    throw new Error(
      "Bare Ed25519 public key required; comments/options rejected.",
    );
  const raw = Buffer.from(input.publicKey.split(" ")[1]!, "base64");
  if (
    raw.length !== 51 ||
    raw.readUInt32BE(0) !== 11 ||
    raw.subarray(4, 15).toString() !== "ssh-ed25519" ||
    raw.readUInt32BE(15) !== 32
  )
    throw new Error("Invalid Ed25519 public-key encoding.");
  if (
    !/^\/var\/tmp\/tutorial-migration-[A-Za-z0-9_-]+$/.test(
      input.privateDirectory,
    )
  )
    throw new Error("Dedicated private source directory required.");
  if (!/^\d{14}Z$/.test(input.expiryUtc))
    throw new Error("Explicit UTC expiry required.");
  const e = input.expiryUtc;
  const expiry = new Date(
    `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}T${e.slice(8, 10)}:${e.slice(10, 12)}:${e.slice(12, 14)}Z`,
  );
  const remaining = expiry.getTime() - (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 6 * 60 * 60 * 1000
  )
    throw new Error("Expiry must be within six hours.");
  const command = relayCommands(
    `${input.privateDirectory}/manifest.json`,
    "0".repeat(64),
    input.image,
  ).destination;
  const authorizedKeyLine = `from="65.108.6.149",restrict,expiry-time="${e}",command="${command}" ${input.publicKey}`;
  const directory = input.privateDirectory;
  const config = `Host tutorial-transfer\n  HostName 167.233.145.218\n  User root\n  Port 22\n  IdentityFile ${directory}/direct-transfer-ed25519\n  UserKnownHostsFile ${directory}/known_hosts\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n  BatchMode yes\n  ConnectTimeout 10\n  ForwardAgent no\n  ClearAllForwardings yes\n  RequestTTY no\n`;
  return {
    authorizedKeyLine,
    config,
    sourceAddress: "65.108.6.149",
    targetAddress: "167.233.145.218",
    forcedCommand: command,
    expiryUtc: e,
    requiresRootReview: true,
  };
}
