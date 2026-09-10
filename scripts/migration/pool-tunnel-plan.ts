/** Pure dry plan. Never executes SSH, keygen, writes files, or installs trust. */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
export const SOURCE_POOL_PORTS = [8092, 8090] as const;
export const TUNNEL_ACCOUNT = "tutorial-pools";
export const TUNNEL_PRIVATE_DIRECTORY = "/opt/tutorial-recovery-private/pool-tunnel";
function ed25519Blob(blob: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) throw new Error("Invalid public key encoding");
  const bytes = Buffer.from(blob, "base64");
  if (bytes.length !== 51 || bytes.readUInt32BE(0) !== 11
    || bytes.subarray(4, 15).toString() !== "ssh-ed25519" || bytes.readUInt32BE(15) !== 32
    || bytes.toString("base64").replace(/=+$/, "") !== blob.replace(/=+$/, "")) throw new Error("Expected a canonical ed25519 public key");
  return bytes;
}
export function publicKeyFingerprint(blob: string) {
  return "SHA256:" + createHash("sha256").update(ed25519Blob(blob)).digest("base64").replace(/=+$/, "");
}
export function planPoolTunnel(input: {
  sourceIpv4: string;
  applicationPublicKey: string;
  existingVerifiedKnownHostLine: string;
  expectedHostFingerprint: string;
  existingLocalTrustConfirmed: boolean;
}) {
  const ip = input.sourceIpv4;
  const parts = ip.split(".").map(Number);
  if (isIP(ip) !== 4 || parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0]! >= 224
    || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168)) throw new Error("Expected reviewed non-private source IPv4");
  if (input.existingLocalTrustConfirmed !== true) throw new Error("Previously verified local host trust required; keyscan is not trust");
  if (/[\r\n\0]/.test(input.applicationPublicKey + input.existingVerifiedKnownHostLine)) throw new Error("Single public-key lines required");
  const key = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [\x20-\x7e]*)?$/.exec(input.applicationPublicKey);
  if (!key) throw new Error("Dedicated ed25519 application public key required");
  ed25519Blob(key[1]!);
  // Hashed known_hosts host fields are accepted: caller selects the exact already-
  // verified entry using ssh-keygen -F against its existing trusted local file.
  const known = /^(\S+) ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [\x20-\x7e]*)?$/.exec(input.existingVerifiedKnownHostLine);
  if (!known || known[1]!.startsWith("@")) throw new Error("Select one existing verified ed25519 known_hosts entry");
  if (publicKeyFingerprint(known[2]!) !== input.expectedHostFingerprint) throw new Error("Pinned host fingerprint mismatch");
  if (key[1] === known[2]) throw new Error("Application key must be distinct from the host key");
  const options = ["restrict", "port-forwarding", 'from="167.233.145.218"', 'command="/bin/false"',
    "no-agent-forwarding", "no-X11-forwarding", "no-pty", "no-user-rc",
    ...SOURCE_POOL_PORTS.map(port => `permitopen="127.0.0.1:${port}"`)];
  return {
    dryPlan: true as const,
    sourceIpv4: ip,
    account: TUNNEL_ACCOUNT,
    // argv is a plan only; no private key bytes or passphrase is accepted here.
    keyGenerationArgv: ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "tutorial-vps2-pools-only", "-f", `${TUNNEL_PRIVATE_DIRECTORY}/id_ed25519`],
    authorizedKeysEntry: `${options.join(",")} ssh-ed25519 ${key[1]} tutorial-vps2-pools-only\n`,
    knownHostsCandidate: `tutorial-source-pinned ssh-ed25519 ${known[2]}\n`,
    hostFingerprint: input.expectedHostFingerprint,
    sshdMatchCandidate: `Match User ${TUNNEL_ACCOUNT}\n  AuthorizedKeysFile /etc/ssh/authorized_keys/tutorial-pools\n  AuthenticationMethods publickey\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n  AllowTcpForwarding local\n  AllowStreamLocalForwarding no\n  PermitOpen ${SOURCE_POOL_PORTS.map(port => `127.0.0.1:${port}`).join(" ")}\n  PermitListen none\n  AllowAgentForwarding no\n  X11Forwarding no\n  PermitTTY no\n  PermitUserRC no\n  PermitTunnel no\n  MaxSessions 0\n  ForceCommand /bin/false\nMatch all\n`,
    endpointMap: { CLAUDE_POOL_URL: "http://provider-pool-tunnel:8092", GEMINI_POOL_URL: "http://provider-pool-tunnel:8090" },
    notPerformed: ["key generation", "account creation", "authorization installation", "known-host installation", "sshd reload", "container build/start", "network/firewall changes", "provider requests"],
  };
}
