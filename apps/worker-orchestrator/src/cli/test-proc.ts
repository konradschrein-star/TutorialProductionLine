import { createDrizzleClient } from "../utils/../../../packages/db/src/client.js";
import { createReactorScriptProcessor } from "../processors/reactor/script.js";
import { Queue } from "bullmq";

async function main() {
  const db = createDrizzleClient(process.env.DATABASE_URL!);
  const reactorTTSQueue = new Queue("queue-reactor-tts", {
    connection: { host: "127.0.0.1", port: 6379 },
  });

  const processor = createReactorScriptProcessor(db, {
    reactorTTS: reactorTTSQueue,
  });

  const fakeJob = {
    data: { job_id: "ed1dde7f-a271-4835-be27-77b2eaebf938" },
    id: "test-manual",
    name: "reactor-script",
  } as any;

  try {
    await processor(fakeJob);
    console.log("SUCCESS");
  } catch (e: any) {
    console.error("PROCESSOR ERROR:", e.message?.slice(0, 400) || String(e));
  }

  await reactorTTSQueue.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
