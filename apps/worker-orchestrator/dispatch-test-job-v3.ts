import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES } from "@repo/queue";

const REDIS_URL = process.env["REDIS_URL"] || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const assetCollectionQueue = new Queue(QUEUE_NAMES.ASSET_COLLECTION, {
  connection,
});

async function dispatchTestJob() {
  const jobId = process.argv[2];

  if (!jobId) {
    console.error("Usage: tsx dispatch-test-job-v3.ts <job-id>");
    process.exit(1);
  }

  console.log(`Dispatching job ${jobId} to asset-collection queue...`);

  await assetCollectionQueue.add(
    "collect",
    { job_id: jobId },
    {
      jobId: `asset-collection-${jobId}`,
      removeOnComplete: false,
      removeOnFail: false,
    },
  );

  console.log("✅ Job dispatched to asset-collection queue");
  await assetCollectionQueue.close();
  await connection.quit();
}

dispatchTestJob().catch((err) => {
  console.error("❌ Failed to dispatch job:", err);
  process.exit(1);
});
