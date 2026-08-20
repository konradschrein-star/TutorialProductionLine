import { spawn } from "node:child_process";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

/**
 * Run a claude CLI prompt and return the response text.
 * Uses `claude -p "..."` subprocess (Claude Code CLI, not Anthropic SDK).
 * Requires `claude` to be in PATH on the executing machine (VPS).
 */
export async function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip ANTHROPIC_API_KEY so Claude CLI falls back to session auth.
    // The project .env key may have low credits; session auth is always valid.
    const { ANTHROPIC_API_KEY: _stripped, ...envWithoutKey } = process.env;
    const child = spawn(CLAUDE_BIN, ["-p", prompt, "--output-format", "text"], {
      env: envWithoutKey,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on("error", (err: Error) => reject(err));
  });
}
