import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveMediaKey, UnsafeMediaPathError } from "../media-path";
const temporary: string[] = [];
async function fixture() { const base = await mkdtemp(join(tmpdir(), "media-path-test-")); temporary.push(base); const root = join(base, "media"); await mkdir(join(root, "thumbnail-library"), { recursive: true }); await writeFile(join(root, "thumbnail-library", "test.png"), "synthetic test bytes"); return { base, root }; }
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
it("resolves normal library assets with native Windows or Linux separators", async () => { const { root } = await fixture(); expect(await resolveMediaKey(root, ["thumbnail-library", "test.png"])).toBe(await realpath(join(root, "thumbnail-library", "test.png"))); });
it.each([["..", "secret"], ["../secret"], ["..\\secret"], ["/etc/passwd"], ["C:\\secret"], ["test.png:stream"], ["."], [""]])("rejects traversal or host path segments %j", async (...segments) => { const { root } = await fixture(); await expect(resolveMediaKey(root, segments)).rejects.toBeInstanceOf(UnsafeMediaPathError); });
it("rejects a directory symlink escaping into a sibling with the same prefix", async () => { const { root, base } = await fixture(); const outside = join(base, "media-private"); await mkdir(outside); await writeFile(join(outside, "private.png"), "private"); await symlink(outside, join(root, "escape"), "junction"); await expect(resolveMediaKey(root, ["escape", "private.png"])).rejects.toBeInstanceOf(UnsafeMediaPathError); });
it("fails missing files without inventing a resolved location", async () => { const { root } = await fixture(); await expect(resolveMediaKey(root, ["missing.png"])).rejects.toMatchObject({ code: "ENOENT" }); });
