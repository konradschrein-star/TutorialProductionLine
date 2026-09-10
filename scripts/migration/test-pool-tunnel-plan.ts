import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planPoolTunnel, publicKeyFingerprint } from "./pool-tunnel-plan";
const blob = (fill: number) => Buffer.concat([Buffer.from([0,0,0,11]), Buffer.from("ssh-ed25519"), Buffer.from([0,0,0,32]), Buffer.alloc(32, fill)]).toString("base64");
const host = blob(1), application = blob(2);
const input = { sourceIpv4: "203.0.113.8", applicationPublicKey: `ssh-ed25519 ${application} synthetic`,
  existingVerifiedKnownHostLine: `synthetic-known-host ssh-ed25519 ${host}`, expectedHostFingerprint: publicKeyFingerprint(host), existingLocalTrustConfirmed: true };
const plan = planPoolTunnel(input);
let checks = 0;
function test(run: () => void) { run(); checks++; }
test(() => assert.equal(plan.dryPlan, true));
test(() => {
  assert.match(plan.authorizedKeysEntry, /^restrict,port-forwarding,from="167\.233\.145\.218",command="\/bin\/false"/);
  assert.match(plan.authorizedKeysEntry, /permitopen="127.0.0.1:8092",permitopen="127.0.0.1:8090"/);
  assert.doesNotMatch(plan.authorizedKeysEntry, /8094|11434|5051|\*/);
});
test(() => {
  for (const required of ["AllowTcpForwarding local", "PermitListen none", "AllowStreamLocalForwarding no", "MaxSessions 0", "ForceCommand /bin/false"])
    assert.ok(plan.sshdMatchCandidate.includes(required));
});
test(() => assert.equal(plan.knownHostsCandidate, `tutorial-source-pinned ssh-ed25519 ${host}\n`));
test(() => assert.deepEqual(Object.keys(plan.endpointMap), ["CLAUDE_POOL_URL", "GEMINI_POOL_URL"]));
for (const sourceIpv4 of ["", "127.0.0.1", "10.0.0.1", "172.20.0.1", "192.168.0.1", "169.254.1.1", "::1", "1.2.3.4\n", "-oProxyCommand=bad", "999.1.1.1"])
  test(() => assert.throws(() => planPoolTunnel({ ...input, sourceIpv4 })));
test(() => assert.throws(() => planPoolTunnel({ ...input, existingLocalTrustConfirmed: false })));
test(() => assert.throws(() => planPoolTunnel({ ...input, expectedHostFingerprint: publicKeyFingerprint(application) })));
test(() => assert.throws(() => planPoolTunnel({ ...input, applicationPublicKey: `ssh-ed25519 ${host}` })));
test(() => assert.throws(() => planPoolTunnel({ ...input, applicationPublicKey: `${input.applicationPublicKey}\nssh-ed25519 ${host}` })));
test(() => assert.throws(() => planPoolTunnel({ ...input, existingVerifiedKnownHostLine: `@cert-authority * ssh-ed25519 ${host}` })));
test(() => assert.throws(() => planPoolTunnel({ ...input, applicationPublicKey: "ssh-rsa AAAA" })));
test(() => assert.throws(() => publicKeyFingerprint("AAAA")));
test(() => assert.equal(planPoolTunnel({ ...input, existingVerifiedKnownHostLine: `|1|synthetic|hash ssh-ed25519 ${host}` }).knownHostsCandidate, plan.knownHostsCandidate));
const compose = await readFile(new URL("../../deploy/recovery/docker-compose.pool-tunnel.yml", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../../deploy/recovery/pool-tunnel/entrypoint.sh", import.meta.url), "utf8");
test(() => {
  assert.doesNotMatch(compose, /^\s+(ports|network_mode|privileged):/m);
  for (const expected of ["internal: true", "internal: false", "user: '1000:1000'", "read_only: true", "create_host_path: false", "profiles: [provider-pools]"])
    assert.ok(compose.includes(expected));
});
test(() => {
  for (const expected of ["-N -T -n -4", "StrictHostKeyChecking=yes", "ExitOnForwardFailure=yes", "ServerAliveInterval=30", "IdentityAgent=none", "HostKeyAlias=tutorial-source-pinned"])
    assert.ok(entrypoint.includes(expected));
  assert.doesNotMatch(entrypoint, /ssh-keyscan|\beval\b|8094|11434|5051/);
});
console.log(JSON.stringify({ syntheticOnly: true, checks, liveKeysCreated: false, tunnelStarted: false }));
