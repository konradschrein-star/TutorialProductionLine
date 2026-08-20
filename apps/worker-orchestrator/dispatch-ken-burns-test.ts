import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve("../../.env") });

import { createRedisConnection, createAssetCollectionQueue } from "@repo/queue";
import { loadConfig, getConfig } from "@repo/config";

async function dispatchTestJob() {
  loadConfig();
  const cfg = getConfig();

  const redis = createRedisConnection({ url: cfg.REDIS_URL });
  const queue = createAssetCollectionQueue(redis);

  const jobId = "3c325587-ee3e-457e-b344-e631ef683888";

  await queue.add(
    "collect-assets",
    { job_id: jobId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      priority: 10,
    },
  );

  console.log(
    "✅ Ken Burns test job dispatched to asset-collection queue:",
    jobId,
  );

  await queue.close();
  await redis.quit();
}

dispatchTestJob()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
  });
