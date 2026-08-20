#!/usr/bin/env tsx
/**
 * smoke-thumbnail.ts
 *
 * End-to-end smoke test for the global thumbnail engine. Creates a
 * throwaway archetype, links it to a channel, then runs requestThumbnail()
 * through the real media-gateway pipeline.
 *
 * Live image generation needs the media-gateway backends (VUP / forge-api /
 * fastgen), which are only configured on the VPS — do NOT run this locally.
 *
 * Run from /opt/content-forge (VPS, post-deploy):
 *   THUMBNAIL_MEDIA_DIR=./tmp-thumbs \
 *     ./node_modules/.bin/tsx apps/worker-orchestrator/scripts/smoke-thumbnail.ts <channelId> <refImagePath>
 */

// Load environment variables before anything else (mirrors src/index.ts).
import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/smoke-thumbnail.ts -> apps/worker-orchestrator/scripts -> apps/worker-orchestrator -> apps -> root
loadDotenv({ path: resolve(__dirname, "../../../.env") });

import { randomUUID } from "node:crypto";
import { loadConfig } from "@repo/config";
import { createDrizzleClient } from "@repo/db";
import {
  createThumbnailArchetype,
  setChannelArchetypes,
} from "@repo/db/repositories";
import { requestThumbnail } from "../src/utils/thumbnail/index.js";

async function main() {
  const [channelId, refPath] = process.argv.slice(2);
  if (!channelId || !refPath) {
    throw new Error("args: <channelId> <refImagePath>");
  }

  const appConfig = loadConfig();
  const db = createDrizzleClient(appConfig.DATABASE_URL);

  const arch = await createThumbnailArchetype(db, {
    name: "Smoke Archetype",
    reference_image_path: refPath,
    formats: ["TUTORIAL_STUDIO"],
  });
  await setChannelArchetypes(db, channelId, [arch.id]);

  const res = await requestThumbnail(db, {
    subjectKind: "test",
    subjectId: randomUUID(),
    format: "TUTORIAL_STUDIO",
    channelId,
    title: "Docker in 5 Minutes",
    topic: "Docker container basics",
    scriptExcerpt: "Docker packages your app so it runs anywhere.",
  });

  console.log(JSON.stringify(res, null, 2));
  process.exit(res.status === "completed" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
