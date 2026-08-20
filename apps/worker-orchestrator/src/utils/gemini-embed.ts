/**
 * Text embedding via local sentence-transformers (Python subprocess).
 *
 * Model: BAAI/bge-small-en-v1.5 — 384-dim L2-normalised vectors.
 * Dot product of two output vectors equals cosine similarity.
 *
 * All texts are embedded in a single Python subprocess call so the
 * model load cost (~2 s) is paid once per batch, not per text.
 *
 * Requires Python 3 with sentence_transformers installed on the host.
 * The script path defaults to /opt/content-forge/scripts/embed_batch.py
 * and can be overridden via EMBED_SCRIPT_PATH env var.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT =
  process.env["EMBED_SCRIPT_PATH"] ??
  "/opt/content-forge/scripts/embed_batch.py";

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Pass texts as JSON via stdin to avoid shell-quoting issues.
  const output = execFileSync("python3", [SCRIPT], {
    input: JSON.stringify(texts),
    maxBuffer: 64 * 1024 * 1024, // 64 MB — plenty for 500 × 384 floats
    timeout: 60_000,
  });

  return JSON.parse(output.toString()) as number[][];
}

/**
 * Dot product of two same-length L2-normalised vectors.
 * Equals cosine similarity for BGE / Gemini text-embedding-004 output.
 */
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) sum += a[i]! * b[i]!;
  return sum;
}
