#!/usr/bin/env tsx
import { Queue } from "bullmq";

const jobId = process.argv[2];
if (!jobId) throw new Error("Usage: redispatch-render.ts <job-id>");

const q = new Queue("queue-render-heavy", {
  connection: { host: "127.0.0.1", port: 6379 },
});
await q.add("route-render", { job_id: jobId }, { priority: 1 });
console.log(`Dispatched ${jobId} to queue-render-heavy`);
await q.close();
