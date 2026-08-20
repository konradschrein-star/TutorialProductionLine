import { describe, it, expect } from "vitest";
import { logger, createContextLogger } from "../index.js";

describe("logger", () => {
  it("exports a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("has a child method for creating child loggers", () => {
    expect(typeof logger.child).toBe("function");
  });

  it("has a level property", () => {
    expect(typeof logger.level).toBe("string");
  });
});

describe("createContextLogger", () => {
  it("returns a logger with pino methods", () => {
    const contextLogger = createContextLogger("test-context");
    expect(contextLogger).toBeDefined();
    expect(typeof contextLogger.info).toBe("function");
    expect(typeof contextLogger.warn).toBe("function");
    expect(typeof contextLogger.error).toBe("function");
    expect(typeof contextLogger.debug).toBe("function");
  });

  it("creates distinct loggers for different contexts", () => {
    const loggerA = createContextLogger("context-a");
    const loggerB = createContextLogger("context-b");
    expect(loggerA).not.toBe(loggerB);
  });

  it("accepts any non-empty context string", () => {
    expect(() => createContextLogger("worker-orchestrator")).not.toThrow();
    expect(() => createContextLogger("hub-web")).not.toThrow();
    expect(() => createContextLogger("db")).not.toThrow();
  });
});
