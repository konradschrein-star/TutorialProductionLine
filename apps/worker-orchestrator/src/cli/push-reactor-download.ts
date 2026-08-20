import { Queue } from "bullmq";

async function main() {
  const queue = new Queue("queue-reactor-download", {
    connection: { host: "127.0.0.1", port: 6379 },
  });
  await queue.add("reactor-download", {
    job_id: "ed1dde7f-a271-4835-be27-77b2eaebf938",
  });
  await queue.close();
  console.log("Pushed to queue-reactor-download");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
