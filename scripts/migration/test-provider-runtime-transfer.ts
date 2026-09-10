/** No DB, provider or network requests. All values and optional temp files are synthetic. */
import assert from "node:assert/strict";
import { mkdtemp, chmod, writeFile, readFile, stat, rm, symlink, link, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bundleFingerprint } from "./secure-selective-bundle";
import {
  selectProviderRuntime, mergeProviderRuntime, renderRuntimeEnv, parseRuntimeEnv,
  writeProviderRuntimeBundle, readProviderRuntimeBundle, writeMergedRuntimeCandidate, DISABLED_TARGET_GUARDS,
} from "./provider-runtime-transfer";

let checks = 0;
const test = (run: () => void) => { run(); checks++; };
const source = { FISH_API_KEY: "synthetic-fish-$literal", DEFAULT_VOICE_DE: "11111111-1111-4111-8111-111111111111",
  CLAUDE_POOL_API_KEY: "synthetic-pool", CLAUDE_POOL_URL: "http://127.0.0.1:8092" };
const bundle = selectProviderRuntime(source, Object.keys(source), "synthetic_source");
const target = { JWT_SECRET: "synthetic-session", DATABASE_URL: "postgresql://synthetic@postgres/synthetic",
  SECRETS_ENCRYPTION_KEY: "synthetic-encryption", REDIS_URL: "redis://redis:6379", CF_API_TOKEN: "synthetic-token",
  STORAGE_DRIVE_ENABLED: "true", TUTORIAL_RETENTION_ENABLED: "true" };
const map = { CLAUDE_POOL_URL: "http://protected-pool-bridge:8092" };
test(() => assert.throws(() => mergeProviderRuntime(target, bundle), /explicit protected target mapping/));
const merged = mergeProviderRuntime(target, bundle, map);
test(() => {
  for (const name of ["JWT_SECRET", "DATABASE_URL", "SECRETS_ENCRYPTION_KEY", "REDIS_URL", "CF_API_TOKEN"]) assert.equal(merged[name], target[name as keyof typeof target]);
  for (const name of DISABLED_TARGET_GUARDS) assert.equal(merged[name], "false");
  assert.equal(merged.FISH_API_KEY, source.FISH_API_KEY);
  assert.equal(merged.CLAUDE_POOL_URL, map.CLAUDE_POOL_URL);
});
test(() => assert.deepEqual(parseRuntimeEnv(renderRuntimeEnv(merged)), merged));
test(() => assert.equal(renderRuntimeEnv({ FISH_API_KEY: "$OTHER_ENV" }), "FISH_API_KEY='$OTHER_ENV'\n"));
for (const name of ["JWT_SECRET", "DATABASE_URL", "SECRETS_ENCRYPTION_KEY", "SESSION_SECRET", "AI33_API_KEY_BACKUP", "AI33_VOICE_EN", "CLAUDE_POOL_MODEL", "A-B", "__proto__"]) {
  test(() => assert.throws(() => selectProviderRuntime({ [name]: "synthetic" }, [name], "source")));
}
for (const value of ["line\nbreak", "line\rbreak", "nul\0byte", "tab\tbyte", "line\u2028break", "delete\u007fbyte"]) {
  test(() => assert.throws(() => selectProviderRuntime({ FISH_API_KEY: value }, ["FISH_API_KEY"], "source")));
}
test(() => assert.throws(() => selectProviderRuntime(source, ["FISH_API_KEY", "FISH_API_KEY"], "source")));
test(() => assert.throws(() => selectProviderRuntime({}, ["FISH_API_KEY"], "source")));
test(() => assert.throws(() => selectProviderRuntime(source, ["FISH_API_KEY"], "../unsafe")));
test(() => assert.throws(() => mergeProviderRuntime(target, bundle, { DATABASE_URL: "http://other" })));
for (const url of ["http://localhost:8092", "http://localhost.:8092", "http://child.localhost.:8092", "http://127.1:8092", "http://[::1]:8092", "http://[::ffff:127.0.0.1]:8092", "http://user:secret@example.test", "https://example.test?key=secret", "file:///tmp/socket"]) {
  test(() => assert.throws(() => mergeProviderRuntime(target, bundle, { CLAUDE_POOL_URL: url })));
}
for (const value of ["has'quote", "has\\escape"]) test(() => assert.throws(() => renderRuntimeEnv({ FISH_API_KEY: value })));
test(() => assert.throws(() => parseRuntimeEnv("JWT_SECRET=one\nJWT_SECRET=two\n")));
test(() => assert.throws(() => parseRuntimeEnv("JWT_SECRET=$OTHER\n")));
test(() => assert.throws(() => parseRuntimeEnv("export JWT_SECRET=value\n")));
test(() => assert.throws(() => mergeProviderRuntime(target, { ...bundle, values: { JWT_SECRET: "forged" } }, {})));

let privateChecks = 0;
if (process.platform === "linux") {
  const directory = await mkdtemp("/tmp/tutorial-migration-provider-test-");
  await chmod(directory, 0o700);
  try {
    const bundlePath = join(directory, "providers.json");
    const receipt = await writeProviderRuntimeBundle(bundlePath, bundle);
    assert.equal((await stat(bundlePath)).mode & 0o777, 0o600); privateChecks++;
    await assert.rejects(writeProviderRuntimeBundle(bundlePath, bundle)); privateChecks++;
    assert.deepEqual(await readProviderRuntimeBundle(bundlePath, receipt.checksum), JSON.parse(JSON.stringify(bundle))); privateChecks++;
    await assert.rejects(readProviderRuntimeBundle(bundlePath, "0".repeat(64))); privateChecks++;
    const current = renderRuntimeEnv(target), currentPath = join(directory, "existing-runtime-copy.env");
    await writeFile(currentPath, current, { flag: "wx", mode: 0o600 });
    const outputPath = join(directory, "candidate-runtime.env");
    const result = await writeMergedRuntimeCandidate({ existingRuntimeCopyPath: currentPath, existingRuntimeSha256: bundleFingerprint(current),
      bundlePath, bundleSha256: receipt.checksum, outputPath, endpointMap: map });
    assert.equal(bundleFingerprint(await readFile(outputPath, "utf8")), result.checksum);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(await readFile(currentPath, "utf8"), current); privateChecks++;
    await assert.rejects(writeMergedRuntimeCandidate({ existingRuntimeCopyPath: currentPath, existingRuntimeSha256: bundleFingerprint(current),
      bundlePath, bundleSha256: receipt.checksum, outputPath, endpointMap: map })); privateChecks++;
    await chmod(bundlePath, 0o644); await assert.rejects(readProviderRuntimeBundle(bundlePath, receipt.checksum)); privateChecks++;
    await chmod(bundlePath, 0o600);
    await symlink(bundlePath, join(directory, "linked.json"));
    await assert.rejects(readProviderRuntimeBundle(join(directory, "linked.json"), receipt.checksum)); privateChecks++;
    const hardlinkPath = join(directory, "hardlinked.json");
    await link(bundlePath, hardlinkPath);
    await assert.rejects(readProviderRuntimeBundle(bundlePath, receipt.checksum)); privateChecks++;
    await unlink(hardlinkPath);
    await chmod(directory, 0o755);
    await assert.rejects(writeProviderRuntimeBundle(join(directory, "unsafe-parent.json"), bundle)); privateChecks++;
    await chmod(directory, 0o700);
  } finally {
    if (!resolve(directory).startsWith("/tmp/tutorial-migration-provider-test-")) throw new Error("Unsafe synthetic cleanup");
    await rm(directory, { recursive: true, force: true });
  }
} else {
  await assert.rejects(writeProviderRuntimeBundle("/tmp/tutorial-migration-provider-test-/blocked.json", bundle), /Linux server/);
}
console.log(JSON.stringify({ syntheticOnly: true, pureChecks: checks, privateFileChecks: privateChecks, transferred: false, activated: false }));
