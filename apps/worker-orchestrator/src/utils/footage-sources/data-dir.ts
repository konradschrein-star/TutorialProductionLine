import { join } from "node:path";

/**
 * Resolve the directory where footage sources write their downloads.
 *
 * Order of precedence:
 *   1. `FOOTAGE_DATA_DIR` env var (absolute path)
 *   2. `${LOCAL_MEDIA_ROOT}/footage`
 *   3. `/tmp/footage` (dev/test only)
 *
 * Read at call time so tests can override via `process.env` between cases.
 */
export function footageDataDir(): string {
  const footageDir = process.env["FOOTAGE_DATA_DIR"];
  if (footageDir) return footageDir;
  const localMediaRoot = process.env["LOCAL_MEDIA_ROOT"];
  if (localMediaRoot) return join(localMediaRoot, "footage");
  return "/tmp/footage";
}
