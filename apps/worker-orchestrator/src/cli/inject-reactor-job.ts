import { Queue } from "bullmq";

async function main() {
  const CHANNEL_ID = "82df56a3-3f7d-4886-ab9f-c9fb3ee70e74";
  const TEMPLATE_ID = "20f06d5f-7dca-4e68-a925-2ae972bcdade";

  const queue = new Queue("queue-ingest", {
    connection: { host: "127.0.0.1", port: 6379 },
  });

  await queue.add("ingest-job", {
    channel_id: CHANNEL_ID,
    format: "POLITICAL_COMMENTARY_REACTOR",
    template_id: TEMPLATE_ID,
    production_version: "V2",
    language: "de",
    metadata: {
      youtube_url: "https://www.youtube.com/watch?v=i2xjcR3dPd8",
      avatar_path: "/opt/content-forge/assets/moderator-avatar.png",
      tts_provider: "elevenlabs",
      tts_voice_id: "R23cI2hqxAhT17IXmY7O",
      avatar_animation: { intensity: 0.7, max_scale_delta: 0.04 },
      overlay: { saturation_boost: 5, source_attribution: "YouTube / Lanz" },
    },
  });

  await queue.close();
  console.log(
    "Job dispatched to ingest queue for POLITICAL_COMMENTARY_REACTOR",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
