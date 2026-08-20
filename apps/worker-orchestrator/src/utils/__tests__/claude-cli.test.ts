import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === "data") cb(Buffer.from("Hello world"));
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0);
    }),
  })),
}));

describe("runClaude", () => {
  it("returns stdout as string", async () => {
    const { runClaude } = await import("../claude-cli.js");
    const result = await runClaude("Say hello");
    expect(result).toBe("Hello world");
  });

  it("calls claude with -p flag and text output format", async () => {
    const { spawn } = await import("node:child_process");
    const { runClaude } = await import("../claude-cli.js");
    await runClaude("test prompt");
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["-p", "test prompt", "--output-format", "text"]),
      expect.any(Object),
    );
  });
});
