import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createSocket } from "node:dgram";
import type { WordTimestamp } from "@repo/contracts";
import type { WhisperOutput } from "./types.js";

// Remote GPU whisper service (laptop)
const WHISPER_SERVICE_URL = process.env["WHISPER_SERVICE_URL"];
// Optional bearer token sent on every remote call. The local server enforces
// it when WHISPER_SERVICE_TOKEN is set there too; matching both ends gives
// a cheap auth layer even over Tailscale.
const WHISPER_SERVICE_TOKEN = process.env["WHISPER_SERVICE_TOKEN"];
// WOL: MAC address of laptop NIC (e.g. "AA:BB:CC:DD:EE:FF") and router external IP
const WHISPER_WOL_MAC = process.env["WHISPER_WOL_MAC"];
const WHISPER_WOL_HOST = process.env["WHISPER_WOL_HOST"]; // router external IP or directed broadcast

function remoteAuthHeader(): Record<string, string> {
  return WHISPER_SERVICE_TOKEN
    ? { Authorization: `Bearer ${WHISPER_SERVICE_TOKEN}` }
    : {};
}

function sendWolPacket(mac: string, host: string): void {
  const macBytes = Buffer.from(mac.replace(/[:\-]/g, ""), "hex");
  const magic = Buffer.concat([
    Buffer.alloc(6, 0xff),
    ...Array(16).fill(macBytes),
  ]);
  const sock = createSocket("udp4");
  sock.once("listening", () => sock.setBroadcast(true));
  sock.bind(() => {
    sock.send(magic, 0, magic.length, 9, host, () => sock.close());
  });
}

async function callRemoteWhisper(
  audioPath: string,
  language: string,
): Promise<WordTimestamp[]> {
  if (!WHISPER_SERVICE_URL) throw new Error("WHISPER_SERVICE_URL not set");

  // 1. Try health check; if down and WOL configured, wake the machine
  let alive = false;
  try {
    const h = await fetch(`${WHISPER_SERVICE_URL}/health`, {
      headers: remoteAuthHeader(),
      signal: AbortSignal.timeout(3_000),
    });
    alive = h.ok;
  } catch {}

  if (!alive) {
    if (WHISPER_WOL_MAC && WHISPER_WOL_HOST) {
      console.log(
        `[whisper-remote] Service offline — sending WOL to ${WHISPER_WOL_HOST}`,
      );
      sendWolPacket(WHISPER_WOL_MAC, WHISPER_WOL_HOST);
    } else {
      console.log(
        "[whisper-remote] Service offline — no WOL config, waiting anyway",
      );
    }

    // Poll up to 90 seconds for the service to come up
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        const h = await fetch(`${WHISPER_SERVICE_URL}/health`, {
          headers: remoteAuthHeader(),
          signal: AbortSignal.timeout(3_000),
        });
        if (h.ok) {
          alive = true;
          break;
        }
      } catch {}
      console.log(`[whisper-remote] Waiting for service... (${(i + 1) * 5}s)`);
    }

    if (!alive)
      throw new Error("Whisper service did not come online after 90s");
  }

  // 2. Upload audio file and get transcript
  const { FormData, File, Blob } = (await import("node:buffer")) as unknown as {
    FormData: typeof globalThis.FormData;
    File: typeof globalThis.File;
    Blob: typeof globalThis.Blob;
  };
  const audioData = await readFile(audioPath);
  const form = new globalThis.FormData();
  form.append(
    "file",
    new globalThis.Blob([audioData], { type: "audio/mpeg" }),
    basename(audioPath),
  );
  form.append("language", language ?? "en");

  console.log(
    `[whisper-remote] Sending ${audioPath} (${(audioData.length / 1e6).toFixed(1)} MB) to ${WHISPER_SERVICE_URL}`,
  );

  const res = await fetch(
    `${WHISPER_SERVICE_URL}/transcribe?language=${language ?? "en"}`,
    {
      method: "POST",
      headers: remoteAuthHeader(),
      body: form,
      signal: AbortSignal.timeout(600_000), // 10 min max for long audio
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Whisper service error (${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    text: string;
    words: { word: string; start: number; end: number }[];
    language: string;
  };

  console.log(
    `[whisper-remote] Got ${data.words.length} words from remote service`,
  );
  return data.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
}

// Resolve path to faster-whisper Python wrapper script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FASTER_WHISPER_SCRIPT = join(
  __dirname,
  "../../scripts/faster_whisper_cli.py",
);

// ── Admission control ───────────────────────────────────────────────────────
// One process-wide cap on concurrent transcriptions (WHISPER_MAX_CONCURRENT,
// default 2). Whisper overload used to cascade: too many parallel jobs → GPU
// service timeouts → every render in the worker stalls. Excess callers now
// queue here instead of stampeding the service.
const WHISPER_MAX_CONCURRENT = Number(
  process.env["WHISPER_MAX_CONCURRENT"] ?? "2",
);
let whisperInFlight = 0;
const whisperWaiters: Array<() => void> = [];

async function acquireWhisperSlot(): Promise<void> {
  if (whisperInFlight < WHISPER_MAX_CONCURRENT) {
    whisperInFlight++;
    return;
  }
  await new Promise<void>((resolve) => whisperWaiters.push(resolve));
  whisperInFlight++;
}

function releaseWhisperSlot(): void {
  whisperInFlight--;
  const next = whisperWaiters.shift();
  if (next) next();
}

/**
 * Run Whisper (faster-whisper or openai-whisper) to get word-level timestamps.
 * Automatically detects which implementation is available. Calls are admitted
 * through a process-wide concurrency cap (WHISPER_MAX_CONCURRENT, default 2).
 *
 * Requires: pip install faster-whisper (preferred) OR pip install openai-whisper
 *
 * @param audioPath - Absolute path to audio file
 * @param language - Optional ISO 639-1 language code (e.g. "de", "en"). Auto-detected if omitted.
 * @returns Array of word timestamps
 */
export async function runWhisper(
  audioPath: string,
  language?: string,
): Promise<WordTimestamp[]> {
  await acquireWhisperSlot();
  try {
    return await runWhisperUncapped(audioPath, language);
  } finally {
    releaseWhisperSlot();
  }
}

async function runWhisperUncapped(
  audioPath: string,
  language?: string,
): Promise<WordTimestamp[]> {
  // Use remote GPU service when configured — much faster than VPS CPU
  if (WHISPER_SERVICE_URL) {
    return callRemoteWhisper(audioPath, language ?? "en");
  }

  const outputDir = dirname(audioPath);

  let useFasterWhisper = false;
  try {
    await access(FASTER_WHISPER_SCRIPT);
    useFasterWhisper = true;
    console.log("[whisper] Using faster-whisper implementation");
  } catch {
    console.log(
      "[whisper] Using openai-whisper implementation (faster-whisper not available)",
    );
  }

  // Model is overridable via WHISPER_MODEL env. Defaults to "base" so we
  // don't change behavior for callers that haven't opted in. Good values:
  //   base   — fastest, lowest quality, fine for English
  //   small  — 2-3× slower, much better non-English (e.g. German) accuracy
  //   medium — significantly slower, near-state-of-the-art quality
  //   large-v3 — best, GPU-recommended
  const model = process.env["WHISPER_MODEL"] ?? "base";

  return new Promise((resolve, reject) => {
    const fasterWhisperArgs = [
      FASTER_WHISPER_SCRIPT,
      audioPath,
      "--model",
      model,
      "--output_dir",
      outputDir,
    ];
    if (language) fasterWhisperArgs.push("--language", language);

    const openaiWhisperArgs = [
      audioPath,
      "--model",
      model,
      "--output_format",
      "json",
      "--word_timestamps",
      "True",
      "--output_dir",
      outputDir,
    ];
    if (language) openaiWhisperArgs.push("--language", language);

    const whisper = useFasterWhisper
      ? spawn("python3", fasterWhisperArgs)
      : spawn("whisper", openaiWhisperArgs);

    let stderr = "";

    whisper.stderr.on("data", (data) => {
      stderr += data.toString();
      // Log progress for observability
      console.log(`[whisper] ${data.toString().trim()}`);
    });

    whisper.on("close", async (code) => {
      // Try to read the JSON output file
      // If it exists and is valid, Whisper succeeded regardless of exit code
      // (exit code can be null when killed by signal, but output may still be valid)
      try {
        // Whisper outputs JSON file with same name as input but .json extension
        const audioBasename = basename(audioPath).replace(/\.[^.]+$/, "");
        const jsonPath = join(outputDir, `${audioBasename}.json`);

        const jsonContent = await readFile(jsonPath, "utf-8");
        const result: WhisperOutput = JSON.parse(jsonContent);

        // Extract words - handle both formats
        const wordTimestamps: WordTimestamp[] = [];

        if (result.words && Array.isArray(result.words)) {
          // faster-whisper format: words at root level
          for (const w of result.words) {
            wordTimestamps.push({
              word: w.word,
              start: w.start,
              end: w.end,
            });
          }
        } else if (result.segments) {
          // openai-whisper format: words nested in segments
          for (const segment of result.segments) {
            if (segment.words) {
              for (const w of segment.words) {
                wordTimestamps.push({
                  word: w.word,
                  start: w.start,
                  end: w.end,
                });
              }
            }
          }
        }

        resolve(wordTimestamps);
      } catch (err) {
        // JSON parsing failed - check if Whisper actually failed
        if (code !== null && code !== 0) {
          reject(new Error(`Whisper failed with code ${code}: ${stderr}`));
        } else {
          reject(
            new Error(
              `Failed to parse Whisper JSON (exit code ${code}): ${err}`,
            ),
          );
        }
      }
    });
  });
}
