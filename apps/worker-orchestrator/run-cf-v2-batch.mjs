/**
 * Run the V2 variant generator for an explicit list of raw_clip_ids. Used to
 * smoke-test split-screen layouts on multiple clips without waiting for the
 * raw-render path to flip them through ready again.
 *
 * Usage: node run-cf-v2-batch.mjs <clip_id_1> <clip_id_2> ...
 */
import { createCfFinishingRenderQueue, createRedisConnection } from "@repo/queue";
import { createDrizzleClient } from "@repo/db";
import { getConfig, loadConfig } from "@repo/config";
import { autoGenerateVariantsV2 } from "./dist/processors/clip-forge/variant-templates.js";

loadConfig();
const cfg = getConfig();
const db = createDrizzleClient(cfg.DATABASE_URL);
const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
const queue = createCfFinishingRenderQueue(conn);

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: node run-cf-v2-batch.mjs <clip_id...>");
  process.exit(1);
}

for (const id of ids) {
  const r = await autoGenerateVariantsV2(db, id, queue);
  console.log(`${id} -> ${JSON.stringify(r)}`);
}

await queue.close();
await conn.quit();
process.exit(0);
