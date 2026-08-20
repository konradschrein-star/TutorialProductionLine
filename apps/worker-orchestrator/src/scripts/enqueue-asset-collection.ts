/**
 * Script: Enqueue a specific job into the ai-generation queue for ASSET_COLLECTION processing.
 * Usage: node dist/scripts/enqueue-asset-collection.js <job_id>
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

import { createAssetCollectionQueue, createRedisConnection } from "@repo/queue";

const jobId = process.argv[2];
if (!jobId) {
  console.error(
    "Usage: node dist/scripts/enqueue-asset-collection.js <job_id>",
  );
  process.exit(1);
}

const redis = createRedisConnection(
  process.env["REDIS_URL"] ?? "redis://localhost:6379",
);
const queue = createAssetCollectionQueue(redis);

await queue.add(
  "asset-collection",
  { job_id: jobId },
  { attempts: 1, removeOnComplete: true },
);
console.log(`Enqueued job ${jobId} into asset-collection queue`);

await queue.close();
await redis.disconnect();
