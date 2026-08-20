import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * Raw HTTP client for the fast-gen.ai media generation API (v6).
 *
 * LOW-LEVEL transport. Callers should go through `media-gateway/index.ts`
 * which adds priority queuing, backend routing (vup primary, fastgen
 * fallback), and rate-limit shaping across all content formats.
 *
 * ── v6 API (migrated from v4, which now 404s) ──────────────────────────────
 * Images AND videos both go through the unified generations endpoint:
 *   POST /api/v6/generations   { model, prompt, aspect_ratio, inputs?, seed? }
 *     → { id: "gen_…", status: "queued", … }
 *   GET  /api/v6/generations/{id}
 *     → { status, results: [{ type, download_url, metadata:{storage_id} }] }
 * `download_url` is a presigned S3 link (no auth header, ~15 min TTL). The
 * generation record itself expires ~5 min after completion, so download
 * promptly. Provider is selected by mapping to a concrete v6 model id.
 *
 * Provider → image model:  flow → nano-banana-2 (default; best quality,
 * supports i2i reference images), flower → flower-image, grok → grok-image,
 * openai → openai-image.
 *
 * Failover: any provider's failure falls back to a ref-preserving alternate.
 * Never fall back to a provider that would silently drop the caller's refs.
 */

export type FastGenAspect = "16:9" | "9:16" | "1:1";
export type FastGenImageProvider = "flower" | "grok" | "openai" | "flow";

export interface GenerateImageOptions {
  aspectRatio?: FastGenAspect;
  referenceImages?: string[];
  provider?: FastGenImageProvider;
  seed?: number;
}

const FASTGEN_BASE_URL =
  process.env["FASTGEN_API_URL"] ?? "https://api.fast-gen.ai";
const FASTGEN_STORAGE_URL =
  process.env["FASTGEN_STORAGE_URL"] ?? "https://storage.fast-gen.ai";

const POLL_INTERVAL_MS = 4_000;
const MAX_POLLS = 180;
const MAX_SUBMIT_RETRIES = 3;

/** Provider → concrete v6 image model id. */
const IMAGE_MODEL: Record<FastGenImageProvider, string> = {
  flow: "nano-banana-2",
  flower: "flower-image",
  grok: "grok-image",
  openai: "openai-image",
};

function apiKey(): string {
  // Read at call time so dotenv can load before this module's constants are
  // captured. MEDIA_GEN_API_KEY is the legacy name for the same fast-gen.ai
  // key (from the deleted media-gen-client) — accept both.
  return (
    process.env["FASTGEN_API_KEY"] ?? process.env["MEDIA_GEN_API_KEY"] ?? ""
  );
}

function authHeaders(): Record<string, string> {
  const key = apiKey();
  if (!key) {
    throw new Error(
      "FASTGEN_API_KEY is not set — required for fast-gen.ai generation",
    );
  }
  return { "Content-Type": "application/json", "X-API-Key": key };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickProvider(refCount: number): FastGenImageProvider {
  // nano-banana-2 (flow) is the default for both text-to-image and i2i — it
  // accepts reference images via `inputs` and produces the highest-fidelity
  // output, which matters for style-consistent formats (e.g. CASUALLY_EXPLAINED).
  void refCount;
  return "flow";
}

/**
 * Pick a failover target for a failed provider. Must preserve any refs the
 * caller passed in — `grok` drops refs, so it's only valid when refCount === 0.
 */
function pickFallback(
  failed: FastGenImageProvider,
  refCount: number,
): FastGenImageProvider | null {
  const refsLost = (p: FastGenImageProvider) => p === "grok" && refCount > 0;
  const candidates: FastGenImageProvider[] = [
    "flow",
    "flower",
    "openai",
    "grok",
  ];
  for (const c of candidates) {
    if (c === failed) continue;
    if (refsLost(c)) continue;
    return c;
  }
  return null;
}

interface V6Result {
  index?: number;
  type?: string;
  download_url?: string | null;
  data?: string | null;
  text?: string | null;
  metadata?: { storage_id?: string } | null;
}
interface V6Generation {
  id?: string;
  status: string;
  results?: V6Result[] | null;
  error?: string | null;
}

const TERMINAL_OK = new Set(["success", "succeeded", "completed", "done"]);
const TERMINAL_ERR = new Set(["error", "failed", "cancelled", "canceled"]);

/** Submit a v6 generation and return its id. Retries on 429/5xx. */
async function submitGeneration(
  body: Record<string, unknown>,
): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < MAX_SUBMIT_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(2_000 * Math.pow(2, attempt - 1) + Math.random() * 1_000);
    }
    try {
      const res = await fetch(`${FASTGEN_BASE_URL}/api/v6/generations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(
          `fast-gen v6 submit failed (${res.status}): ${text.slice(0, 300)}`,
        );
        if (res.status !== 429 && res.status < 500) throw err;
        lastErr = err;
        continue;
      }
      const json = (await res.json()) as { id?: string };
      if (!json.id) {
        throw new Error("fast-gen v6 submit: response missing id");
      }
      return json.id;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === MAX_SUBMIT_RETRIES - 1) throw lastErr;
    }
  }
  throw lastErr ?? new Error("fast-gen v6 submit failed without error");
}

/** Poll a v6 generation to a terminal state and return the full record. */
async function pollGeneration(id: string): Promise<V6Generation> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${FASTGEN_BASE_URL}/api/v6/generations/${id}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status >= 500) continue;
      throw new Error(`fast-gen v6 poll failed (${res.status}) for ${id}`);
    }
    const g = (await res.json()) as V6Generation;
    if (TERMINAL_OK.has(g.status)) return g;
    if (TERMINAL_ERR.has(g.status)) {
      throw new Error(
        `fast-gen v6 generation ${id} failed: ${g.error ?? g.status}`,
      );
    }
  }
  throw new Error(
    `fast-gen v6 generation ${id} timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s`,
  );
}

/** Reference images pass through as-is (data URIs or raw storage ids). */
function toInputs(refs?: string[]): string[] | undefined {
  if (!refs || refs.length === 0) return undefined;
  return refs.slice(0, 10);
}

function firstDownloadUrl(g: V6Generation): string {
  const url = g.results?.[0]?.download_url ?? g.results?.[0]?.data ?? null;
  if (!url) {
    throw new Error("fast-gen v6 generation succeeded but returned no output");
  }
  return url;
}

export async function generateImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<{ ref: string; provider: FastGenImageProvider }> {
  const refs = options.referenceImages ?? [];
  const provider = options.provider ?? pickProvider(refs.length);

  async function tryProvider(p: FastGenImageProvider): Promise<string> {
    const body: Record<string, unknown> = {
      model: IMAGE_MODEL[p],
      prompt,
      aspect_ratio: options.aspectRatio ?? "16:9",
    };
    const inputs = toInputs(refs);
    if (inputs) body["inputs"] = inputs;
    if (options.seed != null) body["seed"] = options.seed;
    const id = await submitGeneration(body);
    console.log(
      JSON.stringify({
        level: "info",
        message: "fast-gen v6 image submitted",
        provider: p,
        model: IMAGE_MODEL[p],
        generation_id: id,
        refs: refs.length,
        aspect_ratio: options.aspectRatio ?? "16:9",
      }),
    );
    return firstDownloadUrl(await pollGeneration(id));
  }

  try {
    return { ref: await tryProvider(provider), provider };
  } catch (firstErr) {
    const fallback = pickFallback(provider, refs.length);
    if (!fallback) throw firstErr;
    console.log(
      JSON.stringify({
        level: "warn",
        message: `fast-gen ${provider} failed, retrying with ${fallback}`,
        error: String(firstErr),
        refs: refs.length,
      }),
    );
    return { ref: await tryProvider(fallback), provider: fallback };
  }
}

/**
 * Download a result reference to disk. In v6 a "ref" is a presigned https
 * download_url (no auth needed). Legacy `file:` (storage id) and `data:` refs
 * are still handled for backward compatibility.
 */
export async function downloadResult(
  ref: string,
  destPath: string,
): Promise<void> {
  if (ref.startsWith("data:")) {
    const commaIdx = ref.indexOf(",");
    if (commaIdx < 0) throw new Error("fast-gen: malformed data URI in result");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(destPath, Buffer.from(ref.slice(commaIdx + 1), "base64"));
    return;
  }
  const isFileRef = ref.startsWith("file:");
  const url = isFileRef
    ? `${FASTGEN_STORAGE_URL}/file/${ref.slice("file:".length)}/raw`
    : ref;
  // Presigned https URLs carry their own auth in the query string; only the
  // storage-id path needs the API key header.
  const headers = isFileRef ? { "X-API-Key": apiKey() } : undefined;
  const res = await fetch(url, headers ? { headers } : {});
  if (!res.ok)
    throw new Error(`fast-gen result fetch failed (${res.status}): ${url}`);
  if (!res.body) throw new Error("fast-gen result response has no body");
  const dest = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

export async function downloadResultToBuffer(ref: string): Promise<Buffer> {
  if (ref.startsWith("data:")) {
    const commaIdx = ref.indexOf(",");
    if (commaIdx < 0) throw new Error("fast-gen: malformed data URI in result");
    return Buffer.from(ref.slice(commaIdx + 1), "base64");
  }
  const isFileRef = ref.startsWith("file:");
  const url = isFileRef
    ? `${FASTGEN_STORAGE_URL}/file/${ref.slice("file:".length)}/raw`
    : ref;
  const headers = isFileRef ? { "X-API-Key": apiKey() } : undefined;
  const res = await fetch(url, headers ? { headers } : {});
  if (!res.ok)
    throw new Error(`fast-gen result fetch failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function generateImageToFile(
  prompt: string,
  destPath: string,
  options: GenerateImageOptions = {},
): Promise<string> {
  const { ref, provider } = await generateImage(prompt, options);
  await downloadResult(ref, destPath);
  console.log(
    JSON.stringify({
      level: "info",
      message: "fast-gen image complete",
      provider,
      dest_path: destPath,
    }),
  );
  return ref;
}

export async function generateImagesBatch(
  items: Array<{
    prompt: string;
    destPath: string;
    aspectRatio?: FastGenAspect;
    referenceImages?: string[];
    provider?: FastGenImageProvider;
  }>,
  concurrency = 4,
): Promise<string[]> {
  const results = new Array<string>(items.length);
  const queue = items.map((item, i) => ({ item, index: i }));
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      const { item, index } = entry;
      results[index] = await generateImageToFile(item.prompt, item.destPath, {
        aspectRatio: item.aspectRatio,
        referenceImages: item.referenceImages,
        provider: item.provider,
      });
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Video generation ───────────────────────────────────────────────────────
// v6 unifies video under the same generations endpoint (model = a *-video
// model). We keep the operation-style API (submit → id, waitForOperation) so
// the media-gateway's video callers don't need to change.

export type FastGenVideoProvider = "flow" | "flower" | "grok";

/** Provider → concrete v6 video model id. */
const VIDEO_MODEL: Record<FastGenVideoProvider, string> = {
  flow: "flow-video-fast",
  flower: "flower-video",
  grok: "grok-video",
};

export interface OperationStatus {
  status: "pending" | "processing" | "success" | "error";
  result?: {
    images?: string[];
    video?: string; // presigned download_url
    text?: string;
  };
  error?: string;
}

export async function generateVideoFromText(
  prompt: string,
  options: { provider?: FastGenVideoProvider } = {},
): Promise<string> {
  const provider = options.provider ?? "flow";
  return submitGeneration({
    model: VIDEO_MODEL[provider],
    prompt,
    aspect_ratio: "16:9",
  });
}

export async function generateVideoFromImage(
  imageRef: string, // presigned url, data URI, or storage id
  options: { provider?: FastGenVideoProvider; prompt?: string } = {},
): Promise<string> {
  const provider = options.provider ?? "flow";
  const body: Record<string, unknown> = {
    model: VIDEO_MODEL[provider],
    inputs: [imageRef],
    aspect_ratio: "16:9",
  };
  if (options.prompt) body["prompt"] = options.prompt;
  return submitGeneration(body);
}

function mapGenerationToStatus(g: V6Generation): OperationStatus {
  if (TERMINAL_ERR.has(g.status)) {
    return { status: "error", error: g.error ?? g.status };
  }
  if (!TERMINAL_OK.has(g.status)) {
    // queued / running / processing → not yet terminal
    return { status: g.status === "queued" ? "pending" : "processing" };
  }
  const result: OperationStatus["result"] = {};
  const images: string[] = [];
  for (const r of g.results ?? []) {
    const url = r.download_url ?? r.data ?? undefined;
    if (!url) continue;
    if (r.type === "video") result.video = url;
    else if (r.type === "text") result.text = r.text ?? undefined;
    else images.push(url);
  }
  if (images.length > 0) result.images = images;
  return { status: "success", result };
}

export async function getOperationStatus(
  operationId: string,
): Promise<OperationStatus> {
  const res = await fetch(
    `${FASTGEN_BASE_URL}/api/v6/generations/${operationId}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `fast-gen v6 generation status failed: ${res.status} ${text.slice(0, 300)}`,
    );
  }
  return mapGenerationToStatus((await res.json()) as V6Generation);
}

export async function waitForOperation(
  operationId: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<OperationStatus> {
  const maxWait = options.maxWaitMs ?? 600_000;
  let backoff = options.pollIntervalMs ?? 1_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const status = await getOperationStatus(operationId);
    if (status.status === "success" || status.status === "error") {
      return status;
    }
    await sleep(backoff);
    backoff = Math.min(backoff * 1.5, 10_000);
  }
  throw new Error(
    `fast-gen operation ${operationId} did not complete within ${maxWait}ms`,
  );
}

export async function generatePromptText(
  userPrompt: string,
): Promise<{ text: string; totalTokens: number }> {
  const res = await fetch(`${FASTGEN_BASE_URL}/api/v6/prompts/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ user_prompt: userPrompt }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `fast-gen prompts/generate failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    generated_text: string;
    usage?: { total_tokens?: number } | null;
  };
  return {
    text: json.generated_text,
    totalTokens: json.usage?.total_tokens ?? 0,
  };
}
