/** Private server-side provider configuration preparation. No executable CLI,
 * process.env dump, logging, provider calls, activation or actual transfer. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { protectedPath, bundleFingerprint } from "./secure-selective-bundle";

export const PROVIDER_CREDENTIAL_NAMES = [
  "FISH_API_KEY", "ELEVENLABS_API_KEY", "AI33_API_KEY", "AI33_API_KEY_2",
  "DEEPSEEK_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
  "INWORLD_API_KEY", "MINIMAX_API_KEY", "CLAUDE_POOL_API_KEY", "GEMINI_POOL_API_KEY",
  "GEMINI_DIRECT_API_KEY", "GEMINI_FALLBACK_API_KEY", "GEMMA_API_KEY",
  "OPENROUTER_API_KEYS", "NVIDIA_NIM_API_KEYS", "GROQ_API_KEYS", "VEOFORGE_API_KEY",
] as const;
export const PROVIDER_SETTING_NAMES = [
  "DEFAULT_VOICE_EN", "DEFAULT_VOICE_DE", "TUTORIAL_FISH_VOICE", "TUTORIAL_MINIMAX_VOICE",
  "TUTORIAL_MINIMAX_FALLBACK_VOICE", "TUTORIAL_INWORLD_VOICE", "TUTORIAL_KOKORO_VOICE",
  "FISH_TTS_MODEL", "FISH_FREE_TIMEOUT_MS", "FISH_FAILOVER_DAILY_BUDGET_USD",
  "FISH_DEFAULT_VOICE_ID", "TTS_MAX_CONCURRENT", "TTS_FORCE_ENGINE", "TTS_PRIORITY_TUTORIAL_STUDIO",
  "GEMINI_DIRECT_MODEL", "GEMINI_PRIMARY", "GEMINI_FALLBACK_MODEL", "GEMMA_MODEL",
  "OPENROUTER_MODEL", "NVIDIA_NIM_MODEL", "GROQ_MODEL", "OLLAMA_MODEL", "LLM_PROVIDER",
  "THUMBNAIL_BACKEND", "VEOFORGE_IMAGES_ENABLED", "VEOFORGE_MAX_CONCURRENT",
  "THUMBNAIL_VISUAL_QA_ENABLED", "THUMBNAIL_VISUAL_QA_MODEL",
] as const;
export const PROVIDER_ENDPOINT_NAMES = ["CLAUDE_POOL_URL", "GEMINI_POOL_URL", "OLLAMA_URL", "FISH_API_BASE", "VEOFORGE_API_URL"] as const;
export const DISABLED_TARGET_GUARDS = [
  "STORAGE_DRIVE_ENABLED", "TUTORIAL_RETENTION_ENABLED", "TUTORIAL_VERIFIED_CACHE_EVICTION_ENABLED",
  "TUTORIAL_PUBLICATION_RECOVERY_ENABLED", "TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED",
  "TUTORIAL_LOCALIZATION_RECOVERY_ENABLED",
] as const;
const allowed = new Set<string>([...PROVIDER_CREDENTIAL_NAMES, ...PROVIDER_SETTING_NAMES, ...PROVIDER_ENDPOINT_NAMES]);
const endpoints = new Set<string>(PROVIDER_ENDPOINT_NAMES);
const NAME = /^[A-Z][A-Z0-9_]*$/;
const MAX_BYTES = 128 * 1024;
type Environment = Record<string, string | undefined>;
export interface ProviderRuntimeBundle {
  version: "tutorial-provider-runtime/1"; sourceSystem: string; values: Record<string, string>;
}
function validName(name: string) {
  if (!NAME.test(name) || ["__PROTO__", "CONSTRUCTOR", "PROTOTYPE"].includes(name)) throw new Error("Unsafe environment name");
}
function validValue(value: unknown, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.length) || value.length > 32768
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) throw new Error("Invalid single-line configuration value");
}
function endpoint(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid provider endpoint"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.search || parsed.hash) throw new Error("Endpoint must use HTTP(S), without embedded credentials, query or fragment");
  return parsed;
}
function loopback(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost") || host === "::1"
    || host.startsWith("::ffff:")
    || (isIP(host) === 4 && host.startsWith("127.")) || host === "0.0.0.0" || host === "::";
}
function validate(bundle: ProviderRuntimeBundle) {
  if (bundle?.version !== "tutorial-provider-runtime/1" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(bundle.sourceSystem)
    || !bundle.values || Array.isArray(bundle.values) || typeof bundle.values !== "object"
    || Object.keys(bundle.values).length === 0) throw new Error("Invalid provider runtime bundle");
  for (const [name, value] of Object.entries(bundle.values)) {
    validName(name);
    if (!allowed.has(name)) throw new Error("Unsupported configuration name");
    validValue(value);
    if (endpoints.has(name)) endpoint(value);
  }
}
/** Source wrapper supplies its already-loaded process.env in memory. Nothing is
 * automatically selected; legacy aliases are deliberately not accepted. */
export function selectProviderRuntime(source: Environment, requested: readonly string[], sourceSystem: string): ProviderRuntimeBundle {
  if (!requested.length || new Set(requested).size !== requested.length) throw new Error("Explicit unique configuration selection required");
  const values: Record<string, string> = Object.create(null);
  for (const name of requested) {
    validName(name);
    if (!allowed.has(name)) throw new Error("Unsupported configuration name");
    const value = Object.hasOwn(source, name) ? source[name] : undefined;
    validValue(value);
    values[name] = value;
  }
  const bundle: ProviderRuntimeBundle = { version: "tutorial-provider-runtime/1", sourceSystem, values };
  validate(bundle); return bundle;
}

/** Rewrites are explicit per endpoint. Even explicit rewrites may not point at
 * container loopback: central source pools must use the reviewed protected route. */
export function mergeProviderRuntime(target: Environment, bundle: ProviderRuntimeBundle, endpointMap: Record<string, string> = {}): Record<string, string> {
  validate(bundle);
  const merged: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(target)) {
    validName(name);
    if (value === undefined) continue;
    validValue(value, true); merged[name] = value;
  }
  for (const [name, value] of Object.entries(endpointMap)) {
    if (!endpoints.has(name) || !Object.hasOwn(bundle.values, name)) throw new Error("Endpoint map may only rewrite explicitly selected endpoints");
    validValue(value);
    if (loopback(endpoint(value))) throw new Error("Mapped endpoint must use the reviewed non-loopback provider connection");
  }
  for (const [name, original] of Object.entries(bundle.values)) {
    const value = Object.hasOwn(endpointMap, name) ? endpointMap[name]! : original;
    if (endpoints.has(name) && loopback(endpoint(value))) throw new Error("Source loopback endpoint requires an explicit protected target mapping");
    merged[name] = value;
  }
  for (const name of DISABLED_TARGET_GUARDS) merged[name] = "false";
  return merged;
}

/** Single quotes prevent Compose variable interpolation in keys containing $.
 * Ambiguous shell-style escapes/quotes are rejected, not silently rewritten.
 * This is an env_file candidate, never a shell script to source/execute. */
export function renderRuntimeEnv(values: Record<string, string>): string {
  return Object.keys(values).sort().map(name => {
    validName(name); const value = values[name]!; validValue(value, true);
    if (value.includes("'") || value.includes("\\")) throw new Error("Value requires a separately reviewed raw env-file format");
    return `${name}='${value}'`;
  }).join("\n") + "\n";
}
/** Strict existing candidate parser: no export, expansion, multiline or escaped
 * strings. Source .env loading belongs to the source wrapper, not this parser. */
export function parseRuntimeEnv(text: string): Record<string, string> {
  if (Buffer.byteLength(text) > MAX_BYTES || text.includes("\0")) throw new Error("Invalid runtime env file");
  const values: Record<string, string> = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("Runtime env syntax is not supported");
    const name = match[1]!, raw = match[2]!;
    if (Object.hasOwn(values, name)) throw new Error("Duplicate runtime env name");
    let value = raw;
    if (raw.startsWith("'") && raw.endsWith("'")) value = raw.slice(1, -1);
    else if (raw.includes("'") || raw.includes('"') || raw.includes("\\") || raw.includes("$") || /\s/.test(raw)) throw new Error("Ambiguous runtime env value");
    validName(name); validValue(value, true); values[name] = value;
  }
  return values;
}
async function writePrivateText(path: string, text: string) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Private artifact too large");
  const absolute = await protectedPath(path, false);
  const file = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(text, "utf8"); await file.sync(); } finally { await file.close(); }
  return { checksum: bundleFingerprint(text), bytes: Buffer.byteLength(text) };
}
async function readPrivateText(path: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("Expected artifact SHA256 required");
  const absolute = await protectedPath(path, true);
  const file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error("Unsafe private artifact");
    const text = await file.readFile("utf8");
    const after = await file.stat();
    if (info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs
      || bundleFingerprint(text) !== expectedSha256) throw new Error("Private artifact verification failed");
    return text;
  } finally { await file.close(); }
}
export async function writeProviderRuntimeBundle(path: string, bundle: ProviderRuntimeBundle) {
  validate(bundle);
  return { ...await writePrivateText(path, JSON.stringify(bundle)), selectedCount: Object.keys(bundle.values).length };
}
export async function readProviderRuntimeBundle(path: string, expectedSha256: string) {
  const text = await readPrivateText(path, expectedSha256);
  let bundle: ProviderRuntimeBundle;
  try { bundle = JSON.parse(text); } catch { throw new Error("Private bundle JSON is invalid"); }
  validate(bundle); return bundle;
}
/** Input existing runtime is an owner-only verified copy in the migration temp
 * dir, not a writable live env file. Output is exclusively created; never activates. */
export async function writeMergedRuntimeCandidate(options: {
  existingRuntimeCopyPath: string; existingRuntimeSha256: string;
  bundlePath: string; bundleSha256: string; outputPath: string;
  endpointMap?: Record<string, string>;
}) {
  const current = parseRuntimeEnv(await readPrivateText(options.existingRuntimeCopyPath, options.existingRuntimeSha256));
  const bundle = await readProviderRuntimeBundle(options.bundlePath, options.bundleSha256);
  const merged = mergeProviderRuntime(current, bundle, options.endpointMap);
  return { ...await writePrivateText(options.outputPath, renderRuntimeEnv(merged)), selectedCount: Object.keys(bundle.values).length };
}
