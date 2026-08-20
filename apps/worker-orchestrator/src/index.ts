// Load environment variables before anything else
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load from project root (../../../.env from src/index.ts -> apps/worker-orchestrator/src -> apps/worker-orchestrator -> apps -> root)
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "@repo/config";
import { createDrizzleClient } from "@repo/db";
import { initializeDb } from "@repo/db/singleton";
import { bootstrapValidation } from "@repo/domain";
import { startProviderProber } from "./services/provider-prober.js";
import {
  createRedisConnection,
  closeRedisConnection,
  createIngestWorker,
  createAIGenerationWorker,
  createQMSValidationWorker,
  createGarbageCollectionWorker,
  createSceneAnalysisWorker,
  createAutoLabelWorker,
  createAIGenerationQueue,
  createQMSValidationQueue,
  createRenderHeavyQueue,
  createAssetCollectionQueue,
  createSceneAnalysisQueue,
  createAutoLabelQueue,
  createAssetCollectionWorker,
  createDeadLetterWorker,
  createBundestagClipAnalysisWorker,
  createBundestagPlaybookGenerationWorker,
  createBundestagClipAnalysisQueue,
  createBundestagPlaybookGenerationQueue,
  createBundestagRenderQueue,
  createClipIngestQueue,
  createClipLabelQueue,
  createClipLabelBatchQueue,
  createClipEmbedQueue,
  createImageIngestQueue,
  createImageLabelQueue,
  createImageEmbedQueue,
  createClipSelectionQueue,
  createClipRetagQueue,
  createClipExtractQueue,
  createClipIngestWorker,
  createClipLabelWorker,
  createClipLabelBatchWorker,
  createClipEmbedWorker,
  createImageIngestWorker,
  createImageLabelWorker,
  createImageEmbedWorker,
  createClipSelectionWorker,
  createClipRetagWorker,
  createClipExtractWorker,
  attachStandardEventListeners,
  createDramaTTSQueue,
  createDramaTranscribeQueue,
  createDramaPromptGenQueue,
  createDramaImageGenQueue,
  createDramaVideoGenQueue,
  createDramaAssembleQueue,
  createDramaQCQueue,
  createDramaThumbnailQueue,
  createDramaTTSWorker,
  createDramaTranscribeWorker,
  createDramaPromptGenWorker,
  createDramaImageGenWorker,
  createDramaVideoGenWorker,
  createDramaAssembleWorker,
  createDramaQCWorker,
  createDramaThumbnailWorker,
  createThumbnailWorker,
  createThumbnailQueue,
  createStockLibraryGenWorker,
  createTutorialGenerateQueue,
  createTutorialSpliceQueue,
  createTutorialStitchQueue,
  createTutorialGenerateWorker,
  createTutorialSpliceWorker,
  createTutorialStitchWorker,
  createReactorDownloadQueue,
  createReactorTranscribeQueue,
  createReactorScriptQueue,
  createReactorTTSQueue,
  createReactorAssembleQueue,
  createReactorDownloadWorker,
  createReactorTranscribeWorker,
  createReactorScriptWorker,
  createReactorTTSWorker,
  createReactorAssembleWorker,
  createCfIngestQueue,
  createCfClipDetectionQueue,
  createCfRawRenderQueue,
  createCfFinishingRenderQueue,
  createCfIngestWorker,
  createCfClipDetectionWorker,
  createCfRawRenderWorker,
  createCfFinishingRenderWorker,
  createTechFootageCollectionQueue,
  createTechFootageCollectionWorker,
} from "@repo/queue";
import { createDramaTTSProcessor } from "./processors/long-form-drama/tts.js";
import { createDramaTranscribeProcessor } from "./processors/long-form-drama/transcribe.js";
import { createDramaPromptGenProcessor } from "./processors/long-form-drama/prompt-gen.js";
import { createDramaImageGenProcessor } from "./processors/long-form-drama/image-gen.js";
import { createDramaVideoGenProcessor } from "./processors/long-form-drama/video-gen.js";
import { createDramaAssembleProcessor } from "./processors/long-form-drama/assemble.js";
import { createDramaQCProcessor } from "./processors/long-form-drama/qc.js";
import { createDramaThumbnailProcessor } from "./processors/long-form-drama/thumbnail.js";
import { createThumbnailProcessor } from "./processors/thumbnail.js";
import { createStockLibraryGenProcessor } from "./processors/stock-library/gen.js";
import { createIngestProcessor } from "./processors/ingest.js";
import { createAIGenerationProcessor } from "./processors/ai-generation.js";
import { createQMSValidationProcessor } from "./processors/qms-validation.js";
import { createGarbageCollectionProcessor } from "./processors/garbage-collection.js";
import { createAssetCollectionProcessor } from "./processors/asset-collection.js";
import { createSceneAnalysisProcessor } from "./processors/scene-analysis.js";
import { createAutoLabelProcessor } from "./processors/auto-label.js";
import { createBundestagClipAnalysisProcessor } from "./processors/bundestag-clip-analysis.js";
import { createBundestagPlaybookGenerationProcessor } from "./processors/bundestag-playbook-generation.js";
import { createClipIngestProcessor } from "./processors/clip-ingest.js";
import { createClipLabelBatchProcessor } from "./processors/clip-label-batch.js";
import { createImageIngestProcessor } from "./processors/image-ingest.js";
import { createImageLabelProcessor } from "./processors/image-label.js";
import { createImageEmbedProcessor } from "./processors/image-embed.js";
import { createClipLabelProcessor } from "./processors/clip-label.js";
import { createClipEmbedProcessor } from "./processors/clip-embed.js";
import { createClipSelectionProcessor } from "./processors/clip-selection.js";
import { createClipRetagProcessor } from "./processors/clip-retag.js";
import { createClipExtractProcessor } from "./processors/clip-extract.js";
import { startStaleJobWatchdog } from "./watchdog/stale-job-watchdog.js";
import { startDramaCleanupInterval } from "./watchdog/drama-cleanup.js";
import { startTutorialCleanupInterval } from "./watchdog/tutorial-cleanup.js";
import { startJobAutoDeleteInterval } from "./watchdog/job-auto-delete.js";
import { startTutorialRetentionInterval } from "./watchdog/tutorial-retention.js";
import { startStitchReconcilerInterval } from "./watchdog/stitch-reconciler.js";
import { reconcileSplicingJobs } from "./watchdog/splice-reconciler.js";
import { createTutorialGenerateProcessor } from "./processors/tutorial/generate.js";
import { createTutorialSpliceProcessor } from "./processors/tutorial/splice.js";
import { createTutorialStitchProcessor } from "./processors/tutorial/stitch.js";
import { createReactorDownloadProcessor } from "./processors/reactor/download.js";
import { createReactorTranscribeProcessor } from "./processors/reactor/transcribe.js";
import { createReactorScriptProcessor } from "./processors/reactor/script.js";
import { createReactorTTSProcessor } from "./processors/reactor/tts.js";
import { createReactorAssembleProcessor } from "./processors/reactor/assemble.js";
import { createCfIngestProcessor } from "./processors/clip-forge/ingest.js";
import { createCfClipDetectionProcessor } from "./processors/clip-forge/clip-detection.js";
import { createCfRawRenderProcessor } from "./processors/clip-forge/raw-render.js";
import { createCfFinishingRenderProcessor } from "./processors/clip-forge/finishing-render.js";
import { createTechFootageCollectionProcessor } from "./processors/tech-footage-collection.js";
import { updateJobStatus } from "./utils/update-job-status.js";
import { buildErrorDetail } from "@repo/contracts";
import { ai33CircuitBreaker } from "./utils/ai33-circuit-breaker.js";
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";

/**
 * Worker Orchestrator Application
 *
 * Lightweight orchestration worker for BullMQ consumers.
 * Handles: ingest, ai-generation, asset-collection, qms-validation, garbage-collection queues.
 *
 * Architecture:
 * - Event-driven chaining: workers update DB, write events, dispatch next jobs
 * - No polling: pure event propagation via BullMQ and PostgreSQL LISTEN/NOTIFY
 * - Graceful shutdown: drain workers before exit
 *
 * Boot sequence:
 * 1. Load and validate config
 * 2. Create Redis connections (one per worker)
 * 3. Create Drizzle DB client
 * 4. Create queues (for dispatch-next)
 * 5. Create processors (with queue dependencies)
 * 6. Initialize all workers
 * 7. Attach event listeners for observability
 * 8. Setup graceful shutdown handlers
 */

// Track workers for graceful shutdown
const workers: Worker[] = [];

async function bootstrap() {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting worker-orchestrator",
      timestamp: new Date().toISOString(),
    }),
  );

  // 1. Load and validate environment config
  const config = loadConfig();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Config loaded",
      node_env: config.NODE_ENV,
    }),
  );

  // 1.5. Bootstrap validation system
  bootstrapValidation();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Validation harness initialized",
    }),
  );

  // 2. Initialize database singleton
  initializeDb(config.DATABASE_URL);
  const db = createDrizzleClient(config.DATABASE_URL);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Database initialized",
    }),
  );

  // 2.5. Scheduled provider health probing (System Health, Phase A3). This is
  // the long-lived process that holds every credential, so it is the honest
  // place to measure provider health on a schedule (not the request-scoped
  // hub-web). Never throws into bootstrap — the loop swallows its own errors.
  try {
    startProviderProber({ db, env: process.env });
  } catch (proberErr) {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "Provider prober failed to start (non-fatal)",
        error:
          proberErr instanceof Error ? proberErr.message : String(proberErr),
      }),
    );
  }

  // 3. Create Redis connections (one per worker - BullMQ requirement)
  const ingestConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const aiGenerationConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const qmsValidationConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const garbageCollectionConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const assetCollectionConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const sceneAnalysisConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const renderHeavyConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const deadLetterConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const autoLabelConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const autoLabelQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const bundestagClipAnalysisConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const bundestagPlaybookGenerationConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const bundestagClipAnalysisQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const bundestagPlaybookGenerationQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const bundestagRenderQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const clipIngestConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipLabelConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipLabelBatchConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipLabelBatchQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const imageIngestConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const imageIngestQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const imageLabelConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const imageLabelQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const imageEmbedConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const imageEmbedQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const clipEmbedConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipSelectionConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipRetagConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipRetagQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const clipExtractConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const clipExtractQueueConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaTTSWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaTranscribeWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaPromptGenWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaImageGenWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaVideoGenWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaAssembleWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaQCWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaThumbnailWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const thumbnailWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const thumbnailQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const stockLibraryGenWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const dramaTTSQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaTranscribeQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaPromptGenQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaImageGenQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaAssembleQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaQCQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const dramaVideoGenQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialGenerateWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialGenerateQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialSpliceWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialSpliceQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialStitchWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialStitchQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const reactorDownloadWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const reactorDownloadQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const reactorTranscribeWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const reactorTranscribeQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const reactorScriptWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const reactorScriptQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const reactorTTSWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const reactorTTSQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const reactorAssembleWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const reactorAssembleQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  // ── Clip Forge connections ─────────────────────────────────────────────
  const cfIngestWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const cfIngestQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const cfClipDetectionWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const cfClipDetectionQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const cfRawRenderWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const cfRawRenderQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const cfFinishingRenderWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const cfFinishingRenderQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  // ── Tech footage collection connections ───────────────────────────────────
  const techFootageCollectionWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const techFootageCollectionQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });

  console.log(
    JSON.stringify({
      level: "info",
      message: "Redis connections created",
      connection_count: 56,
    }),
  );

  // 3.5. Wait for all Redis connections to be ready
  // CRITICAL: BullMQ workers silently fail to process jobs if connections aren't ready
  const allConnections = [
    ingestConnection,
    aiGenerationConnection,
    qmsValidationConnection,
    garbageCollectionConnection,
    assetCollectionConnection,
    sceneAnalysisConnection,
    renderHeavyConnection,
    deadLetterConnection,
    autoLabelConnection,
    autoLabelQueueConnection,
    bundestagClipAnalysisConnection,
    bundestagPlaybookGenerationConnection,
    bundestagClipAnalysisQueueConnection,
    bundestagPlaybookGenerationQueueConnection,
    bundestagRenderQueueConnection,
    clipIngestConnection,
    clipLabelConnection,
    clipLabelBatchConnection,
    clipLabelBatchQueueConnection,
    imageIngestConnection,
    imageIngestQueueConnection,
    imageLabelConnection,
    imageLabelQueueConnection,
    imageEmbedConnection,
    imageEmbedQueueConnection,
    clipEmbedConnection,
    clipSelectionConnection,
    clipRetagConnection,
    clipRetagQueueConnection,
    clipExtractConnection,
    clipExtractQueueConnection,
    dramaTTSWorkerConn,
    dramaTranscribeWorkerConn,
    dramaPromptGenWorkerConn,
    dramaImageGenWorkerConn,
    dramaVideoGenWorkerConn,
    dramaAssembleWorkerConn,
    dramaQCWorkerConn,
    dramaThumbnailWorkerConn,
    thumbnailWorkerConn,
    thumbnailQueueConn,
    stockLibraryGenWorkerConn,
    dramaTTSQueueConn,
    dramaTranscribeQueueConn,
    dramaPromptGenQueueConn,
    dramaImageGenQueueConn,
    dramaVideoGenQueueConn,
    dramaAssembleQueueConn,
    dramaQCQueueConn,
    tutorialGenerateWorkerConn,
    tutorialGenerateQueueConn,
    tutorialSpliceWorkerConn,
    tutorialSpliceQueueConn,
    tutorialStitchWorkerConn,
    tutorialStitchQueueConn,
    reactorDownloadWorkerConn,
    reactorDownloadQueueConn,
    reactorTranscribeWorkerConn,
    reactorTranscribeQueueConn,
    reactorScriptWorkerConn,
    reactorScriptQueueConn,
    reactorTTSWorkerConn,
    reactorTTSQueueConn,
    reactorAssembleWorkerConn,
    reactorAssembleQueueConn,
    cfIngestWorkerConn,
    cfIngestQueueConn,
    cfClipDetectionWorkerConn,
    cfClipDetectionQueueConn,
    cfRawRenderWorkerConn,
    cfRawRenderQueueConn,
    cfFinishingRenderWorkerConn,
    cfFinishingRenderQueueConn,
    techFootageCollectionWorkerConn,
    techFootageCollectionQueueConn,
  ];

  await Promise.all(
    allConnections.map((conn) => {
      if (conn.status === "ready") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        conn.once("ready", () => resolve());
      });
    }),
  );

  console.log(
    JSON.stringify({
      level: "info",
      message: "All Redis connections ready",
      connection_count: allConnections.length,
    }),
  );

  // 3.6. Proactive AI33 health check — open circuit immediately if imagen is down,
  // then poll every 2 min so outages are caught before any job fails.
  // Must be awaited so no jobs run before the circuit state is known.
  try {
    // Use backup key for health checks if available — backup key gives accurate maintenance/status
    // while primary key may be rate-limited (429) and can't report proper imagen status.
    const healthCheckKey = process.env["AI33_API_KEY_2"] ?? config.AI33_API_KEY;
    await ai33CircuitBreaker.init(healthCheckKey);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "AI33 startup health check failed (non-fatal)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 3.7. Flush Redis Lua script cache — prevents stall-recovery failures when a
  // prior crash left corrupt script entries. BullMQ reloads scripts lazily.
  try {
    await (ingestConnection as any).script("FLUSH");
    console.log(
      JSON.stringify({
        level: "info",
        message: "Redis Lua script cache flushed (stall-recovery hardening)",
      }),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "SCRIPT FLUSH failed (non-fatal)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 4. Create queues (needed for dispatch-next)
  const aiGenerationQueue = createAIGenerationQueue(aiGenerationConnection);
  const qmsValidationQueue = createQMSValidationQueue(qmsValidationConnection);
  const renderHeavyQueue = createRenderHeavyQueue(renderHeavyConnection);
  const assetCollectionQueue = createAssetCollectionQueue(
    assetCollectionConnection,
  );
  const sceneAnalysisQueue = createSceneAnalysisQueue(sceneAnalysisConnection);
  const autoLabelQueue = createAutoLabelQueue(autoLabelQueueConnection);
  const bundestagClipAnalysisQueue = createBundestagClipAnalysisQueue(
    bundestagClipAnalysisQueueConnection,
  );
  const bundestagPlaybookGenerationQueue =
    createBundestagPlaybookGenerationQueue(
      bundestagPlaybookGenerationQueueConnection,
    );
  const bundestagRenderQueue = createBundestagRenderQueue(
    bundestagRenderQueueConnection,
  );
  const clipIngestQueue = createClipIngestQueue(clipIngestConnection);
  const clipLabelQueue = createClipLabelQueue(clipLabelConnection);
  const clipLabelBatchQueue = createClipLabelBatchQueue(
    clipLabelBatchQueueConnection,
  );
  const clipEmbedQueue = createClipEmbedQueue(clipEmbedConnection);
  const imageIngestQueue = createImageIngestQueue(imageIngestQueueConnection);
  const imageLabelQueue = createImageLabelQueue(imageLabelQueueConnection);
  const imageEmbedQueue = createImageEmbedQueue(imageEmbedQueueConnection);
  const clipSelectionQueue = createClipSelectionQueue(clipSelectionConnection);
  const clipRetagQueue = createClipRetagQueue(clipRetagQueueConnection);
  const clipExtractQueue = createClipExtractQueue(clipExtractQueueConnection);
  const dramaTTSQueue = createDramaTTSQueue(dramaTTSQueueConn);
  const dramaTranscribeQueue = createDramaTranscribeQueue(
    dramaTranscribeQueueConn,
  );
  const dramaPromptGenQueue = createDramaPromptGenQueue(
    dramaPromptGenQueueConn,
  );
  const dramaImageGenQueue = createDramaImageGenQueue(dramaImageGenQueueConn);
  const dramaVideoGenQueue = createDramaVideoGenQueue(dramaVideoGenQueueConn);
  const dramaAssembleQueue = createDramaAssembleQueue(dramaAssembleQueueConn);
  const dramaQCQueue = createDramaQCQueue(dramaQCQueueConn);
  // dramaThumbnailQueue is consumed by dramaThumbnailWorker; no dispatch-next routing needed
  const tutorialGenerateQueue = createTutorialGenerateQueue(
    tutorialGenerateQueueConn,
  );
  const tutorialSpliceQueue = createTutorialSpliceQueue(
    tutorialSpliceQueueConn,
  );
  const tutorialStitchQueue = createTutorialStitchQueue(
    tutorialStitchQueueConn,
  );
  const thumbnailQueue = createThumbnailQueue(thumbnailQueueConn);
  const reactorDownloadQueue = createReactorDownloadQueue(
    reactorDownloadQueueConn,
  );
  const reactorTranscribeQueue = createReactorTranscribeQueue(
    reactorTranscribeQueueConn,
  );
  const reactorScriptQueue = createReactorScriptQueue(reactorScriptQueueConn);
  const reactorTTSQueue = createReactorTTSQueue(reactorTTSQueueConn);
  const reactorAssembleQueue = createReactorAssembleQueue(
    reactorAssembleQueueConn,
  );
  // ── Clip Forge queues ──────────────────────────────────────────────────
  const cfIngestQueue = createCfIngestQueue(cfIngestQueueConn);
  const cfClipDetectionQueue = createCfClipDetectionQueue(
    cfClipDetectionQueueConn,
  );
  const cfRawRenderQueue = createCfRawRenderQueue(cfRawRenderQueueConn);
  const cfFinishingRenderQueue = createCfFinishingRenderQueue(
    cfFinishingRenderQueueConn,
  );
  // ── Tech footage collection queue ──────────────────────────────────────
  const techFootageCollectionQueue = createTechFootageCollectionQueue(
    techFootageCollectionQueueConn,
  );

  // 5. Create processors (pass queues for dispatch-next)
  const ingestProcessor = createIngestProcessor(db, {
    aiGeneration: aiGenerationQueue,
    assetCollection: assetCollectionQueue,
    bundestagClipAnalysis: bundestagClipAnalysisQueue,
    reactorDownload: reactorDownloadQueue,
  });
  const aiGenerationProcessor = createAIGenerationProcessor(db, {
    aiGeneration: aiGenerationQueue,
    assetCollection: assetCollectionQueue,
    sceneAnalysis: sceneAnalysisQueue,
    techFootageCollection: techFootageCollectionQueue,
  });
  const qmsValidationProcessor = createQMSValidationProcessor(db, {
    renderHeavy: renderHeavyQueue,
  });
  const garbageCollectionProcessor = createGarbageCollectionProcessor(db);
  const assetCollectionProcessor = createAssetCollectionProcessor(db, {
    aiGeneration: aiGenerationQueue,
    assetCollection: assetCollectionQueue,
    sceneAnalysis: sceneAnalysisQueue,
    qmsValidation: qmsValidationQueue,
    clipSelection: clipSelectionQueue,
  });
  const sceneAnalysisProcessor = createSceneAnalysisProcessor(db, {
    assetCollection: assetCollectionQueue,
  });
  const autoLabelProcessor = createAutoLabelProcessor(db);
  const bundestagClipAnalysisProcessor = createBundestagClipAnalysisProcessor(
    db,
    {
      bundestagPlaybookGeneration: bundestagPlaybookGenerationQueue,
    },
  );
  const bundestagPlaybookGenerationProcessor =
    createBundestagPlaybookGenerationProcessor(db, {
      bundestagRender: bundestagRenderQueue,
    });
  const clipIngestProcessor = createClipIngestProcessor(db, {
    clipLabel: clipLabelQueue,
    clipLabelBatch: clipLabelBatchQueue,
    clipExtract: clipExtractQueue,
  });
  const clipLabelProcessor = createClipLabelProcessor(db, {
    clipEmbed: clipEmbedQueue,
  });
  const clipLabelBatchProcessor = createClipLabelBatchProcessor(db, {
    clipEmbed: clipEmbedQueue,
  });
  const clipEmbedProcessor = createClipEmbedProcessor(db);
  const imageIngestProcessor = createImageIngestProcessor(db, {
    imageLabel: imageLabelQueue,
  });
  const imageLabelProcessor = createImageLabelProcessor(db, {
    imageEmbed: imageEmbedQueue,
  });
  const imageEmbedProcessor = createImageEmbedProcessor(db);
  const clipSelectionProcessor = createClipSelectionProcessor(db, {
    qmsValidation: qmsValidationQueue,
  });
  const clipRetagProcessor = createClipRetagProcessor(db, {
    clipEmbed: clipEmbedQueue,
  });
  const clipExtractProcessor = createClipExtractProcessor(db);
  const dramaTTSProcessor = createDramaTTSProcessor(
    db,
    { dramaTranscribe: dramaTranscribeQueue },
    config.ELEVENLABS_API_KEY,
  );
  const dramaTranscribeProcessor = createDramaTranscribeProcessor(db, {
    dramaPromptGen: dramaPromptGenQueue,
  });
  const dramaPromptGenProcessor = createDramaPromptGenProcessor(db, {
    dramaImageGen: dramaImageGenQueue,
  });
  const dramaImageGenProcessor = createDramaImageGenProcessor(db, {
    dramaVideoGen: dramaVideoGenQueue,
    dramaAssemble: dramaAssembleQueue,
  });
  const dramaVideoGenProcessor = createDramaVideoGenProcessor(db, {
    dramaVideoGen: dramaVideoGenQueue,
    dramaAssemble: dramaAssembleQueue,
  });
  const dramaAssembleProcessor = createDramaAssembleProcessor(db, {
    dramaQC: dramaQCQueue,
  });
  const dramaQCProcessor = createDramaQCProcessor(db);
  const dramaThumbnailProcessor = createDramaThumbnailProcessor(db);
  const thumbnailProcessor = createThumbnailProcessor(db);
  const stockLibraryGenProcessor = createStockLibraryGenProcessor(db);
  const tutorialGenerateProcessor = createTutorialGenerateProcessor(db, {
    tutorialGenerate: tutorialGenerateQueue,
  });
  const tutorialSpliceProcessor = createTutorialSpliceProcessor(db, {
    tutorialStitch: tutorialStitchQueue,
    thumbnail: thumbnailQueue,
  });
  const tutorialStitchProcessor = createTutorialStitchProcessor(db, {
    thumbnail: thumbnailQueue,
  });
  const reactorDownloadProcessor = createReactorDownloadProcessor(db, {
    reactorTranscribe: reactorTranscribeQueue,
  });
  const reactorTranscribeProcessor = createReactorTranscribeProcessor(db, {
    reactorScript: reactorScriptQueue,
  });
  const reactorScriptProcessor = createReactorScriptProcessor(db, {
    reactorTTS: reactorTTSQueue,
  });
  const reactorTTSProcessor = createReactorTTSProcessor(db, {
    reactorAssemble: reactorAssembleQueue,
  });
  const reactorAssembleProcessor = createReactorAssembleProcessor(db, {
    renderHeavy: renderHeavyQueue,
  });
  // ── Clip Forge processors ─────────────────────────────────────────────
  const cfIngestProcessor = createCfIngestProcessor(db, {
    cfClipDetection: cfClipDetectionQueue,
  });
  const cfClipDetectionProcessor = createCfClipDetectionProcessor(db, {
    cfRawRender: cfRawRenderQueue,
  });
  const cfRawRenderProcessor = createCfRawRenderProcessor(db, {
    cfFinishingRender: cfFinishingRenderQueue,
  });
  // DO NOT DELETE apps/worker-render/scripts/cf-render-variant.mjs.
  // It is spawned by absolute path (below), so no static import points at it
  // and dead-code analysis reports it as unreferenced. The 2026-07-29
  // stabilization purge (a205ce5d) deleted it on exactly that reasoning and
  // silently broke every Clip Forge finishing render in production — the
  // whole subsystem stops at "raw clip" with no error until a render is
  // attempted. Restored 2026-07-30. This comment is the only thing tying the
  // file to the graph; keep it.
  const cfFinishingRenderProcessor = createCfFinishingRenderProcessor(db, {
    variantRunnerScript:
      process.env["CF_VARIANT_RUNNER"] ??
      "/opt/content-forge/apps/worker-render/scripts/cf-render-variant.mjs",
  });
  // ── Tech footage collection processor ────────────────────────────────
  const techFootageCollectionProcessor = createTechFootageCollectionProcessor(
    db,
    {
      assetCollection: assetCollectionQueue,
    },
  );

  // 6. Initialize workers
  const ingestWorker = createIngestWorker(ingestConnection, ingestProcessor);
  const aiGenerationWorker = createAIGenerationWorker(
    aiGenerationConnection,
    aiGenerationProcessor,
  );
  const qmsValidationWorker = createQMSValidationWorker(
    qmsValidationConnection,
    qmsValidationProcessor,
  );
  const garbageCollectionWorker = createGarbageCollectionWorker(
    garbageCollectionConnection,
    garbageCollectionProcessor,
  );
  const assetCollectionWorker = createAssetCollectionWorker(
    assetCollectionConnection,
    assetCollectionProcessor,
  );
  const sceneAnalysisWorker = createSceneAnalysisWorker(
    sceneAnalysisConnection,
    sceneAnalysisProcessor,
  );
  const autoLabelWorker = createAutoLabelWorker(
    autoLabelConnection,
    autoLabelProcessor,
  );
  const bundestagClipAnalysisWorker = createBundestagClipAnalysisWorker(
    bundestagClipAnalysisConnection,
    bundestagClipAnalysisProcessor,
  );
  const bundestagPlaybookGenerationWorker =
    createBundestagPlaybookGenerationWorker(
      bundestagPlaybookGenerationConnection,
      bundestagPlaybookGenerationProcessor,
    );
  const clipIngestWorker = createClipIngestWorker(
    clipIngestConnection,
    clipIngestProcessor,
  );
  const clipLabelWorker = createClipLabelWorker(
    clipLabelConnection,
    clipLabelProcessor,
  );
  const clipLabelBatchWorker = createClipLabelBatchWorker(
    clipLabelBatchConnection,
    clipLabelBatchProcessor,
  );
  const imageIngestWorker = createImageIngestWorker(
    imageIngestConnection,
    imageIngestProcessor,
  );
  const imageLabelWorker = createImageLabelWorker(
    imageLabelConnection,
    imageLabelProcessor,
  );
  const imageEmbedWorker = createImageEmbedWorker(
    imageEmbedConnection,
    imageEmbedProcessor,
  );
  const clipEmbedWorker = createClipEmbedWorker(
    clipEmbedConnection,
    clipEmbedProcessor,
  );
  const clipSelectionWorker = createClipSelectionWorker(
    clipSelectionConnection,
    clipSelectionProcessor,
  );
  const clipRetagWorker = createClipRetagWorker(
    clipRetagConnection,
    clipRetagProcessor,
  );
  const clipExtractWorker = createClipExtractWorker(
    clipExtractConnection,
    clipExtractProcessor,
  );
  const dramaTTSWorker = createDramaTTSWorker(
    dramaTTSWorkerConn,
    dramaTTSProcessor,
  );
  const dramaTranscribeWorker = createDramaTranscribeWorker(
    dramaTranscribeWorkerConn,
    dramaTranscribeProcessor,
  );
  const dramaPromptGenWorker = createDramaPromptGenWorker(
    dramaPromptGenWorkerConn,
    dramaPromptGenProcessor,
  );
  const dramaImageGenWorker = createDramaImageGenWorker(
    dramaImageGenWorkerConn,
    dramaImageGenProcessor,
  );
  const dramaVideoGenWorker = createDramaVideoGenWorker(
    dramaVideoGenWorkerConn,
    dramaVideoGenProcessor,
  );
  const dramaAssembleWorker = createDramaAssembleWorker(
    dramaAssembleWorkerConn,
    dramaAssembleProcessor,
  );
  const dramaQCWorker = createDramaQCWorker(
    dramaQCWorkerConn,
    dramaQCProcessor,
  );
  const dramaThumbnailWorker = createDramaThumbnailWorker(
    dramaThumbnailWorkerConn,
    dramaThumbnailProcessor,
  );
  const thumbnailWorker = createThumbnailWorker(
    thumbnailWorkerConn,
    thumbnailProcessor,
  );
  const stockLibraryGenWorker = createStockLibraryGenWorker(
    stockLibraryGenWorkerConn,
    stockLibraryGenProcessor,
  );
  const tutorialGenerateWorker = createTutorialGenerateWorker(
    tutorialGenerateWorkerConn,
    tutorialGenerateProcessor,
  );
  const tutorialSpliceWorker = createTutorialSpliceWorker(
    tutorialSpliceWorkerConn,
    tutorialSpliceProcessor,
  );
  const tutorialStitchWorker = createTutorialStitchWorker(
    tutorialStitchWorkerConn,
    tutorialStitchProcessor,
  );
  const reactorDownloadWorker = createReactorDownloadWorker(
    reactorDownloadWorkerConn,
    reactorDownloadProcessor,
  );
  const reactorTranscribeWorker = createReactorTranscribeWorker(
    reactorTranscribeWorkerConn,
    reactorTranscribeProcessor,
  );
  const reactorScriptWorker = createReactorScriptWorker(
    reactorScriptWorkerConn,
    reactorScriptProcessor,
  );
  const reactorTTSWorker = createReactorTTSWorker(
    reactorTTSWorkerConn,
    reactorTTSProcessor,
  );
  const reactorAssembleWorker = createReactorAssembleWorker(
    reactorAssembleWorkerConn,
    reactorAssembleProcessor,
  );
  // ── Clip Forge workers ─────────────────────────────────────────────────
  const cfIngestWorker = createCfIngestWorker(
    cfIngestWorkerConn,
    cfIngestProcessor,
  );
  const cfClipDetectionWorker = createCfClipDetectionWorker(
    cfClipDetectionWorkerConn,
    cfClipDetectionProcessor,
  );
  const cfRawRenderWorker = createCfRawRenderWorker(
    cfRawRenderWorkerConn,
    cfRawRenderProcessor,
  );
  const cfFinishingRenderWorker = createCfFinishingRenderWorker(
    cfFinishingRenderWorkerConn,
    cfFinishingRenderProcessor,
  );
  // ── Tech footage collection worker ────────────────────────────────────
  const techFootageCollectionWorker = createTechFootageCollectionWorker(
    techFootageCollectionWorkerConn,
    techFootageCollectionProcessor,
  );
  const deadLetterWorker = createDeadLetterWorker(
    deadLetterConnection,
    async (job) => {
      // Extract job data for type safety
      const data = job.data as { job_id?: string } | undefined;

      // Build comprehensive error context for operator debugging
      const errorDetails = {
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? "unknown reason",
        stackTrace: job.stacktrace?.slice(0, 3) ?? [], // Last 3 errors
        timestamp: new Date().toISOString(),
        jobData: job.data, // Full payload for debugging
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };

      // Spec-compliant structured log format with grep-able prefix
      console.error(
        JSON.stringify({
          level: "error",
          event: "dead_letter_queue_exhausted",
          prefix: "[dead-letter]", // Keeps grep-ability
          job_id: data?.job_id,
          bullmq_job_id: job.id,
          bullmq_job_name: job.name,
          attempts_made: job.attemptsMade,
          failed_reason: job.failedReason ?? "unknown reason",
          stack_trace: job.stacktrace?.slice(0, 3) ?? [],
          job_data: job.data,
          processed_on: job.processedOn,
          finished_on: job.finishedOn,
          timestamp: new Date().toISOString(),
        }),
      );

      // Write failure to DB so operators can see it in the Hub
      if (data?.job_id) {
        try {
          await updateJobStatus(
            db,
            data.job_id,
            "FAILED_IRRECOVERABLE",
            errorDetails.failedReason,
            buildErrorDetail({
              code: "DEAD_LETTER",
              message: errorDetails.failedReason,
              category: "orchestration",
              retryable: false,
              context: {
                attempts_made: job.attemptsMade,
                queue_name: job.queueName,
                bq_job_id: job.id,
                failed_reason: job.failedReason ?? null,
              },
            }),
            errorDetails, // Pass full error details to error_metadata
          );
        } catch (updateErr) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "dead_letter_db_update_failed",
              job_id: data.job_id,
              error:
                updateErr instanceof Error
                  ? updateErr.message
                  : String(updateErr),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    },
  );

  // Track workers for graceful shutdown
  workers.push(
    ingestWorker,
    aiGenerationWorker,
    qmsValidationWorker,
    garbageCollectionWorker,
    assetCollectionWorker,
    sceneAnalysisWorker,
    autoLabelWorker,
    bundestagClipAnalysisWorker,
    bundestagPlaybookGenerationWorker,
    clipIngestWorker,
    clipLabelWorker,
    clipLabelBatchWorker,
    clipEmbedWorker,
    imageIngestWorker,
    imageLabelWorker,
    imageEmbedWorker,
    clipSelectionWorker,
    clipRetagWorker,
    clipExtractWorker,
    dramaTTSWorker,
    dramaTranscribeWorker,
    dramaPromptGenWorker,
    dramaImageGenWorker,
    dramaVideoGenWorker,
    dramaAssembleWorker,
    dramaQCWorker,
    dramaThumbnailWorker,
    thumbnailWorker,
    stockLibraryGenWorker,
    tutorialGenerateWorker,
    tutorialSpliceWorker,
    tutorialStitchWorker,
    reactorDownloadWorker,
    reactorTranscribeWorker,
    reactorScriptWorker,
    reactorTTSWorker,
    reactorAssembleWorker,
    cfIngestWorker,
    cfClipDetectionWorker,
    cfRawRenderWorker,
    cfFinishingRenderWorker,
    techFootageCollectionWorker,
    deadLetterWorker,
  );

  // 7. Attach event listeners for observability
  attachStandardEventListeners(ingestWorker, "ingest-worker");
  attachStandardEventListeners(aiGenerationWorker, "ai-generation-worker");
  attachStandardEventListeners(qmsValidationWorker, "qms-validation-worker");
  attachStandardEventListeners(
    garbageCollectionWorker,
    "garbage-collection-worker",
  );
  // Asset collection gets a failure hook because it is the stage most likely to
  // be killed BY BULLMQ rather than by its own catch block: for RANKING it runs
  // 15-25 minutes of yt-dlp downloads, TTS and Whisper inline, so a worker
  // restart or a lock timeout abandons it mid-flight and the processor's catch
  // never executes.
  //
  // Without this, the content_jobs row keeps its in-progress status forever.
  // Verified on production 2026-08-03: three RANKING jobs sat in
  // ASSET_COLLECTION with error_message NULL for hours after BullMQ had already
  // given up on them — the same silent-stranding class that hid 28 finished
  // tutorial videos for up to 28 days.
  attachStandardEventListeners(
    assetCollectionWorker,
    "asset-collection-worker",
    {
      onFailed: async (error, ctx) => {
        // The BullMQ job id is NOT the content_jobs id — the payload carries
        // the real one. Guessing a row id here would write a failure onto an
        // unrelated job.
        const contentJobId = ctx.data?.job_id;
        if (!contentJobId) {
          console.error(
            JSON.stringify({
              level: "error",
              message:
                "[asset-collection] job failed but no content job id on the payload — row cannot be reconciled",
              bull_job_id: ctx.bullJobId,
              error: error.message,
            }),
          );
          return;
        }
        await updateJobStatus(
          db,
          contentJobId,
          "FAILED_GENERAL",
          `[asset-collection] ${error.message} (attempts: ${ctx.attemptsMade ?? "?"})`,
        );
        console.error(
          JSON.stringify({
            level: "error",
            message:
              "[asset-collection] wrote FAILED_GENERAL after BullMQ abandoned the job",
            job_id: contentJobId,
            error: error.message,
          }),
        );
      },
    },
  );
  attachStandardEventListeners(sceneAnalysisWorker, "scene-analysis-worker");
  attachStandardEventListeners(autoLabelWorker, "auto-label-worker");
  attachStandardEventListeners(
    bundestagClipAnalysisWorker,
    "bundestag-clip-analysis-worker",
  );
  attachStandardEventListeners(
    bundestagPlaybookGenerationWorker,
    "bundestag-playbook-generation-worker",
  );
  attachStandardEventListeners(clipIngestWorker, "clip-ingest-worker");
  attachStandardEventListeners(clipLabelWorker, "clip-label-worker");
  attachStandardEventListeners(clipLabelBatchWorker, "clip-label-batch-worker");
  attachStandardEventListeners(clipEmbedWorker, "clip-embed-worker");
  attachStandardEventListeners(clipSelectionWorker, "clip-selection-worker");
  attachStandardEventListeners(clipRetagWorker, "clip-retag-worker");
  attachStandardEventListeners(clipExtractWorker, "clip-extract-worker");
  attachStandardEventListeners(imageIngestWorker, "image-ingest-worker");
  attachStandardEventListeners(imageLabelWorker, "image-label-worker");
  attachStandardEventListeners(imageEmbedWorker, "image-embed-worker");
  attachStandardEventListeners(dramaTTSWorker, "drama-tts-worker");
  attachStandardEventListeners(
    dramaTranscribeWorker,
    "drama-transcribe-worker",
  );
  attachStandardEventListeners(dramaPromptGenWorker, "drama-prompt-gen-worker");
  attachStandardEventListeners(dramaImageGenWorker, "drama-image-gen-worker");
  attachStandardEventListeners(dramaVideoGenWorker, "drama-video-gen-worker");
  attachStandardEventListeners(dramaAssembleWorker, "drama-assemble-worker");
  attachStandardEventListeners(dramaQCWorker, "drama-qc-worker");
  attachStandardEventListeners(dramaThumbnailWorker, "drama-thumbnail-worker");
  attachStandardEventListeners(thumbnailWorker, "thumbnail-worker");
  attachStandardEventListeners(
    stockLibraryGenWorker,
    "stock-library-gen-worker",
  );
  attachStandardEventListeners(
    tutorialGenerateWorker,
    "tutorial-generate-worker",
  );
  attachStandardEventListeners(tutorialSpliceWorker, "tutorial-splice-worker");
  attachStandardEventListeners(tutorialStitchWorker, "tutorial-stitch-worker");
  attachStandardEventListeners(
    reactorDownloadWorker,
    "reactor-download-worker",
  );
  attachStandardEventListeners(
    reactorTranscribeWorker,
    "reactor-transcribe-worker",
  );
  attachStandardEventListeners(reactorScriptWorker, "reactor-script-worker");
  attachStandardEventListeners(reactorTTSWorker, "reactor-tts-worker");
  attachStandardEventListeners(
    reactorAssembleWorker,
    "reactor-assemble-worker",
  );
  attachStandardEventListeners(cfIngestWorker, "cf-ingest-worker");
  attachStandardEventListeners(
    cfClipDetectionWorker,
    "cf-clip-detection-worker",
  );
  attachStandardEventListeners(cfRawRenderWorker, "cf-raw-render-worker");
  attachStandardEventListeners(
    cfFinishingRenderWorker,
    "cf-finishing-render-worker",
  );
  attachStandardEventListeners(deadLetterWorker, "dead-letter-worker");

  console.log(
    JSON.stringify({
      level: "info",
      message: "Workers initialized",
      workers: [
        "ingest-worker",
        "ai-generation-worker",
        "qms-validation-worker",
        "garbage-collection-worker",
        "asset-collection-worker",
        "scene-analysis-worker",
        "auto-label-worker",
        "bundestag-clip-analysis-worker",
        "bundestag-playbook-generation-worker",
        "clip-ingest-worker",
        "clip-label-worker",
        "clip-label-batch-worker",
        "clip-embed-worker",
        "clip-selection-worker",
        "clip-retag-worker",
        "clip-extract-worker",
        "image-ingest-worker",
        "image-label-worker",
        "image-embed-worker",
        "drama-tts-worker",
        "drama-transcribe-worker",
        "drama-prompt-gen-worker",
        "drama-image-gen-worker",
        "drama-video-gen-worker",
        "drama-assemble-worker",
        "drama-qc-worker",
        "drama-thumbnail-worker",
        "tutorial-generate-worker",
        "tutorial-splice-worker",
        "tutorial-stitch-worker",
        "reactor-download-worker",
        "reactor-transcribe-worker",
        "reactor-script-worker",
        "reactor-tts-worker",
        "reactor-assemble-worker",
        "cf-ingest-worker",
        "cf-clip-detection-worker",
        "cf-raw-render-worker",
        "cf-finishing-render-worker",
        "dead-letter-worker",
      ],
    }),
  );

  // 8. Start stale job watchdog (runs every 5 minutes)
  startStaleJobWatchdog(db);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Stale job watchdog started",
    }),
  );

  // 8b. Drama cleanup — kills orphan ffmpeg from PM2 restarts and
  // reclaims >24h-old intermediate files (.raw, .looped, group-*, etc).
  // Runs once at startup + hourly thereafter.
  startDramaCleanupInterval();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Drama cleanup watchdog started",
    }),
  );

  // 8c. Tutorial cleanup — reclaims >48h-old TTS chunk files left behind
  // by interrupted tutorial-generate runs. Runs once at startup + hourly.
  startTutorialCleanupInterval();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Tutorial cleanup watchdog started",
    }),
  );

  // 8d. Job auto-delete — hard-deletes STALLED non-published jobs 48h after
  // their last state change. Every human-in-the-loop state is exempt; see the
  // exemption list in job-auto-delete.ts for why that matters.
  startJobAutoDeleteInterval(db, config.REDIS_URL);
  console.log(
    JSON.stringify({
      level: "info",
      message:
        "Job auto-delete watchdog started (TTL: 48h since last state change)",
    }),
  );

  // 8e. Tutorial VPS retention — Drive is the permanent store, the box keeps
  // ~7 days. DRY RUN unless TUTORIAL_RETENTION_ENABLED=true, and a file is
  // only ever removed when its Drive copy is confirmed by drive_file_id.
  startTutorialRetentionInterval(db, config.LOCAL_MEDIA_ROOT);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Tutorial retention watchdog started",
      enabled: process.env["TUTORIAL_RETENTION_ENABLED"] === "true",
      retention_days: process.env["TUTORIAL_RETENTION_DAYS"] ?? "7",
    }),
  );

  // 8e. Stitch reconciler — promotes LONG_FORM parents whose stitch job
  // finished but whose write-back never landed, and surfaces anything that must
  // not be auto-fixed. Runs at startup + every 10 minutes.
  //
  // This is the backstop for the failure that hid 28 finished videos for up to
  // 28 days: the write-back existed in src but was never compiled into the
  // deployed bundle, and nothing ever re-checked.
  // See docs/sessions/2026-08-03-TUTORIAL-PIPELINE-HANDOFF.md.
  startStitchReconcilerInterval(db);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Stitch reconciler started (every 10m)",
    }),
  );

  // 8f. Splice reconciler — recovers tutorial jobs left in SPLICING /
  // AWAITING_UPLOAD by a worker killed mid-splice.
  //
  // NOTE: this function was written 2026-06-12 and had ZERO callers until
  // 2026-08-03 — it had never executed once. Anything it was meant to recover
  // has been unrecovered for that entire period. It was also written as
  // startup-only; running it on an interval is deliberate, because startup-only
  // is the same shape of mistake that let the stitch bug hide.
  const runSpliceReconciler = () => {
    reconcileSplicingJobs(db, tutorialSpliceQueue).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "[splice-reconciler] cycle failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };
  runSpliceReconciler();
  setInterval(runSpliceReconciler, 10 * 60 * 1000);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Splice reconciler started (every 10m) — first run ever",
    }),
  );

  // 9. Setup graceful shutdown
  setupGracefulShutdown(allConnections);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Worker orchestrator running",
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Graceful Shutdown Handler
 *
 * Drains all workers and closes all connections before exit.
 * Triggered by SIGINT (Ctrl+C) or SIGTERM (Docker/Kubernetes).
 *
 * Error Handling Strategy:
 * - Individual worker/connection failures do not block shutdown
 * - Each failure is logged but shutdown continues for remaining workers
 * - Force exit after 30s timeout to prevent hanging on stuck processes
 */
function setupGracefulShutdown(connections: Redis[]) {
  const shutdown = async (signal: string) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: `Received ${signal}, starting graceful shutdown`,
        timestamp: new Date().toISOString(),
      }),
    );

    // Hard-exit after 30s if drain hangs
    const forceExitTimer = setTimeout(() => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Graceful shutdown timeout — force exiting",
          timestamp: new Date().toISOString(),
        }),
      );
      process.exit(1);
    }, 30_000);
    forceExitTimer.unref();

    // 1. Drain all workers (complete in-flight jobs, reject new ones)
    console.log(
      JSON.stringify({
        level: "info",
        message: "Draining workers",
        worker_count: workers.length,
      }),
    );

    // Close each worker individually so one failure doesn't block others
    const closeResults = await Promise.allSettled(
      workers.map(async (worker) => {
        try {
          await worker.close();
          return { success: true };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "Worker close() failed, continuing shutdown",
              worker_name: worker.name,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            }),
          );
          return { success: false, error };
        }
      }),
    );

    // Log summary of worker closures
    const successCount = closeResults.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const failedCount = workers.length - successCount;
    console.log(
      JSON.stringify({
        level: "info",
        message: "Workers drain complete",
        closed_successfully: successCount,
        failed_to_close: failedCount,
      }),
    );

    // 2. Close all Redis connections
    console.log(
      JSON.stringify({
        level: "info",
        message: "Closing Redis connections",
        connection_count: connections.length,
      }),
    );

    // Close each connection individually so one failure doesn't block others
    const connectionResults = await Promise.allSettled(
      connections.map(async (conn) => {
        try {
          await closeRedisConnection(conn);
          return { success: true };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "Redis connection close failed, continuing shutdown",
              error: errorMsg,
              timestamp: new Date().toISOString(),
            }),
          );
          return { success: false, error };
        }
      }),
    );

    // Log summary of connection closures
    const connSuccessCount = connectionResults.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const connFailedCount = connections.length - connSuccessCount;
    console.log(
      JSON.stringify({
        level: "info",
        message: "Redis connections closed",
        closed_successfully: connSuccessCount,
        failed_to_close: connFailedCount,
      }),
    );

    clearTimeout(forceExitTimer);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Graceful shutdown complete",
        timestamp: new Date().toISOString(),
      }),
    );

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Boot the application
bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      message: "Failed to start worker-orchestrator",
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
