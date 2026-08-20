import { sql } from "drizzle-orm";
import type { CfRuntime } from "./runtime.js";

export interface HealthReport {
  ok: boolean;
  db: "up" | "down";
  redisConfigured: boolean;
  checkedAt: string;
}

export async function getHealth(rt: CfRuntime): Promise<HealthReport> {
  let dbUp = false;
  try {
    await rt.db.execute(sql`SELECT 1`);
    dbUp = true;
  } catch {
    dbUp = false;
  }
  return {
    ok: dbUp && !!rt.redisUrl,
    db: dbUp ? "up" : "down",
    redisConfigured: !!rt.redisUrl,
    checkedAt: new Date().toISOString(),
  };
}
