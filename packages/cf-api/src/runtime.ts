import type { DrizzleClient } from "@repo/db";

/**
 * Runtime context every cf-api function takes as its first arg.
 *
 * Keeping this explicit (rather than reading env inside each function)
 * means cf-api stays pure-functional and easy to test: pass a test db
 * + a test Redis URL and the function behaves the same. The HTTP layer
 * in hub-web constructs one of these per request; cf-mcp-server and
 * the worker-orchestrator each construct one at boot.
 */
export interface CfRuntime {
  /** Active Drizzle client (already initialized against DATABASE_URL). */
  db: DrizzleClient;
  /** Redis connection string used when a function needs to push to BullMQ. */
  redisUrl: string;
  /**
   * Optional logger. Defaults to no-op so cf-api never spams stdout in
   * library mode. Hub-web / worker-orchestrator inject their own.
   */
  log?: (
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    fields?: Record<string, unknown>,
  ) => void;
}

export function noopLog(): CfRuntime["log"] {
  return () => {};
}
