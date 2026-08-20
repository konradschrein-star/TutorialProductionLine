/**
 * G1 PROOF — generate real BUSINESS_PLAN_HUB images through the VISUAL GATEWAY.
 *
 * Not curl, not a direct AI33 call: this drives `preflightEssentialVisualProviders()`
 * and then `requestVisual()`, so it exercises the whole path the pipeline uses —
 * essential-provider gate → provider order → art-direction prompt → style
 * reference plate → media-gateway routing → ai33 backend → provenance screening
 * → content-addressed store.
 *
 * Run:
 *   npx tsx src/scripts/proof-g1-visual-gateway.ts
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

// PROCESS-LOCAL only — deliberately not written to .env. Config validation
// rejects the worker without these three, and they are irrelevant to imaging.
process.env["SECRETS_ENCRYPTION_KEY"] ??= randomBytes(32).toString("base64");
process.env["DEFAULT_VOICE_EN"] ??= "proof-voice-en";
process.env["DEFAULT_VOICE_DE"] ??= "proof-voice-de";

const {
  preflightEssentialVisualProviders,
  requestVisual,
  measureImageDimensions,
  styleGuidePath,
  loadStyleReference,
} = await import("../utils/visual-gateway/index.js");

const TOPIC = "how to write a bakery business plan for an SBA 7(a) loan";

async function main(): Promise<void> {
  console.log("── style reference ───────────────────────────────────────────");
  console.log("path:", styleGuidePath());
  const ref = await loadStyleReference();
  console.log(
    "loaded:",
    ref.length > 0
      ? `YES (${Math.round((ref[0]!.length * 3) / 4 / 1024)} KB as data URI)`
      : "NO — generation will be text-only",
  );

  console.log("\n── essential-provider pre-flight ─────────────────────────────");
  const report = await preflightEssentialVisualProviders({
    format: "BUSINESS_PLAN_HUB",
    refCount: ref.length,
    aspectRatio: "16:9",
  });
  console.log("usable backends:", report.usableBackends.join(", "));
  for (const v of report.verdicts) {
    console.log(`  ${v.usable ? "OK  " : "dead"} ${v.backend}: ${v.reason}`);
  }

  const requests = [
    "A neat stack of printed loan documents beside a slim desk calculator",
    "A matte ceramic coffee cup on a saucer next to a folded newspaper and a pen",
  ];

  for (const [i, query] of requests.entries()) {
    console.log(`\n── image ${i + 1}/${requests.length} ─────────────────────────────────────────`);
    console.log("query:", query);
    const started = Date.now();
    const result = await requestVisual({
      intent: "prop-plate",
      query,
      orientation: "landscape",
      // A 1080p render needs at least this. Below it the gateway REJECTS the
      // plate rather than letting the compositor upscale it.
      minWidth: 1920,
      preferMotion: false,
      topic: TOPIC,
    });
    const dims = measureImageDimensions(readFileSync(result.storagePath));
    console.log("PROVIDER :", result.provenance.provider);
    console.log("PATH     :", result.storagePath);
    console.log("BYTES    :", result.bytes);
    console.log("DIMS     :", `${dims.width}x${dims.height}`);
    console.log("LICENCE  :", result.provenance.licence);
    console.log("SOURCE   :", result.provenance.sourceUrl.slice(0, 80));
    console.log("POSTURE  :", result.posture);
    console.log("SECONDS  :", Math.round((Date.now() - started) / 1000));
  }
}

await main();
