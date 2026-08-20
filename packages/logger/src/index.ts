import { randomUUID } from "node:crypto";
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level:
    (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
});

// Typed logger helpers
export const createContextLogger = (context: string) => {
  return logger.child({ context });
};

/** Opaque per-request identifier for correlating log lines across a request's lifecycle. */
export const generateRequestId = (): string => {
  return randomUUID();
};

/** Child logger pre-bound with request metadata, for request-scoped middleware logging. */
export const createRequestLogger = (
  requestId: string,
  method: string,
  path: string,
) => {
  return logger.child({ requestId, method, path });
};

// Re-export types
export type { Logger } from "pino";
