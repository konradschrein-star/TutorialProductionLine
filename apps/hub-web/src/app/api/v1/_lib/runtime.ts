/**
 * /api/v1 helper to build a @repo/cf-api CfRuntime once per request from
 * hub-web's existing db client + env. The cf-api functions are pure
 * server functions; this is the adapter that hands them the runtime.
 */

import type { CfRuntime } from "@repo/cf-api";
import { db } from "@/lib/db";
import { getHubConfig } from "@/lib/config";

export function getV1Runtime(): CfRuntime {
  const cfg = getHubConfig();
  return {
    db,
    redisUrl: cfg.REDIS_URL,
    log: (level, msg, fields) => {
      const out = fields
        ? JSON.stringify({ level, msg, ...fields })
        : JSON.stringify({ level, msg });
      if (level === "error" || level === "warn") {
        console.error(out);
      } else {
        console.warn(out);
      }
    },
  };
}
