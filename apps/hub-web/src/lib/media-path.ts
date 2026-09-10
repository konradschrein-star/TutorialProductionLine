import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class UnsafeMediaPathError extends Error {}
/** URL keys are path segments, never host filesystem paths. */
export async function resolveMediaKey(root: string, segments: string[]): Promise<string> {
  if (!segments.length || segments.some(part => !part || part === "." || part === ".." || /[\\/\u0000:]/.test(part))) throw new UnsafeMediaPathError("Invalid media key");
  const rootPath = resolve(root);
  const target = resolve(rootPath, ...segments);
  const contained = (base: string, file: string) => {
    const key = relative(base, file);
    return key !== "" && key !== ".." && !key.startsWith(`..${sep}`) && !isAbsolute(key);
  };
  if (!contained(rootPath, target)) throw new UnsafeMediaPathError("Media key escapes root");
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(target)]);
  if (!contained(realRoot, realTarget)) throw new UnsafeMediaPathError("Media symlink escapes root");
  return realTarget;
}
