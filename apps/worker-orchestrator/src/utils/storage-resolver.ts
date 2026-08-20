import { join } from "node:path";

/**
 * Resolve a clip_library's `storage_key` to a concrete filesystem path or
 * CDN URL. Lets the orchestrator stay on the VPS while the bytes move to a
 * home NAS later — only the resolver changes when we wire a new backend.
 *
 * Today only `local` is wired; `nas` and `s3` throw NotImplementedError so
 * a misconfigured library fails loud rather than silently corrupting paths.
 */
export interface StorageLibrary {
  storage_backend: "local" | "nas" | "s3";
  storage_root: string | null;
}

export function resolveStoragePath(
  library: StorageLibrary,
  storage_key: string,
): string {
  if (library.storage_backend === "local") {
    const root =
      library.storage_root ??
      process.env["LOCAL_MEDIA_ROOT"] ??
      "/opt/content-forge/media";
    return join(root, storage_key);
  }
  throw new Error(
    `storage_backend '${library.storage_backend}' not yet wired — only 'local' is supported today`,
  );
}

export function resolveCdnUrl(
  library: StorageLibrary,
  storage_key: string,
): string {
  if (library.storage_backend !== "local") {
    throw new Error(
      `storage_backend '${library.storage_backend}' not yet wired for CDN URL resolution`,
    );
  }
  const cdnBase = process.env["MEDIA_CDN_BASE"];
  if (cdnBase) return `${cdnBase}/media/${storage_key}`;
  const host = process.env["MEDIA_HOST"] ?? "localhost";
  const port = process.env["MEDIA_PORT"] ?? "3000";
  return `http://${host}:${port}/media/${storage_key}`;
}
