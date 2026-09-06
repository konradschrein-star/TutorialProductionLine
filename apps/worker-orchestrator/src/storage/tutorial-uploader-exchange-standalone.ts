/**
 * Dedicated Tutorial Studio -> uploader Drive bridge.
 *
 * This stays separate from the finished-artifact archive scanner on purpose:
 * an archive pass can spend hours streaming multi-GB historical videos, while
 * a ready upload job and its receipts are latency-sensitive control-plane
 * traffic. Sharing one sequential loop would let archive work starve both job
 * publication and success reporting.
 */
import "dotenv/config";
import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import { logger } from "@repo/logger";
import { ArtifactStore } from "@repo/storage";
import {
  createTutorialUploaderExchangeService,
  runTutorialUploaderExchangeOnce,
  tutorialUploaderExchangeOptionsFromEnv,
  type DriveClientTutorialUploaderPort,
  type DrizzleTutorialUploaderExchangeRepository,
  type TutorialUploaderExchangeOptions,
  type TutorialUploaderExchangeTotals,
} from "./tutorial-uploader-exchange.js";

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 5_000;
const UNCONFIGURED_LOG_EVERY_N_PASSES = 12;

interface LoopState {
  running: boolean;
  stopped: boolean;
  unconfiguredPasses: number;
  runtime?: ExchangeRuntime;
}

interface ExchangeRuntime {
  repository: DrizzleTutorialUploaderExchangeRepository;
  drive: DriveClientTutorialUploaderPort;
  options: TutorialUploaderExchangeOptions;
}

function pollIntervalMs(): number {
  const parsed = Number(process.env["TUTORIAL_EXCHANGE_POLL_INTERVAL_MS"]);
  return Number.isSafeInteger(parsed) && parsed >= MIN_INTERVAL_MS
    ? parsed
    : DEFAULT_INTERVAL_MS;
}

function configure(
  db: DrizzleClient,
): { ok: true; runtime: ExchangeRuntime } | { ok: false; reason: string } {
  const exchange = tutorialUploaderExchangeOptionsFromEnv();
  if (!exchange.enabled) return { ok: false, reason: exchange.reason };
  const storage = ArtifactStore.create(db);
  if (!storage.ok) return { ok: false, reason: storage.reason };
  const service = createTutorialUploaderExchangeService(
    db,
    storage.store.drive,
    storage.store.driveConfig.chunkSizeBytes,
    storage.store.driveConfig.maxAttempts,
  );
  return {
    ok: true,
    runtime: { ...service, options: exchange.options },
  };
}

function runConfiguredPass(
  runtime: ExchangeRuntime,
): Promise<TutorialUploaderExchangeTotals> {
  return runTutorialUploaderExchangeOnce(
    runtime.repository,
    runtime.drive,
    runtime.options,
  );
}

async function tick(db: DrizzleClient, state: LoopState): Promise<void> {
  if (state.running || state.stopped) return;
  state.running = true;
  try {
    if (state.runtime === undefined) {
      const configured = configure(db);
      if (!configured.ok) {
        if (state.unconfiguredPasses % UNCONFIGURED_LOG_EVERY_N_PASSES === 0) {
          logger.warn(
            { reason: configured.reason },
            "tutorial-uploader-exchange: waiting for Drive configuration",
          );
        }
        state.unconfiguredPasses += 1;
        return;
      }
      state.runtime = configured.runtime;
    }
    if (state.unconfiguredPasses > 0) {
      logger.info(
        { after_passes: state.unconfiguredPasses },
        "tutorial-uploader-exchange: Drive configuration became available",
      );
      state.unconfiguredPasses = 0;
    }
    const totals = await runConfiguredPass(state.runtime);
    if (
      totals.publishAttempted > 0 ||
      totals.receiptsInserted > 0 ||
      totals.publishFailed > 0 ||
      totals.receiptFailed > 0
    ) {
      const log =
        totals.publishFailed > 0 || totals.receiptFailed > 0
          ? logger.warn.bind(logger)
          : logger.info.bind(logger);
      log(totals, "tutorial-uploader-exchange: pass complete");
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "tutorial-uploader-exchange: pass failed",
    );
  } finally {
    state.running = false;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.error("tutorial-uploader-exchange: DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createDrizzleClient(databaseUrl);
  if (process.argv.includes("--once")) {
    const configured = configure(db);
    if (!configured.ok) {
      logger.error(
        { reason: configured.reason },
        "tutorial-uploader-exchange: exchange is not configured",
      );
      process.exit(2);
    }
    const totals = await runConfiguredPass(configured.runtime);
    logger.info(totals, "tutorial-uploader-exchange: one-shot complete");
    process.exit(totals.publishFailed > 0 || totals.receiptFailed > 0 ? 1 : 0);
  }

  const intervalMs = pollIntervalMs();
  const state: LoopState = {
    running: false,
    stopped: false,
    unconfiguredPasses: 0,
  };
  const timer = setInterval(() => void tick(db, state), intervalMs);
  logger.info(
    { interval_ms: intervalMs },
    "tutorial-uploader-exchange: dedicated Drive bridge started",
  );
  void tick(db, state);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "tutorial-uploader-exchange: shutting down");
    state.stopped = true;
    clearInterval(timer);
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "tutorial-uploader-exchange: fatal",
  );
  process.exit(1);
});
