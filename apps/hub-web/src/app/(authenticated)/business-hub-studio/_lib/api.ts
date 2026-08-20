/**
 * Typed client for the Presenter Studio API.
 *
 * Every helper throws on a non-2xx with the server's own diagnostic. The routes
 * are written to explain what is wrong and what to do about it, so swallowing
 * that into a generic "request failed" would throw away the only thing that
 * makes a fail-closed pipeline debuggable.
 */

import type { Pose } from "@repo/contracts";

const BASE = "/api/business-hub/studio";

export interface ManifestSummary {
  total: number;
  calibrated: number;
  needsCalibration: number;
}

export interface ManifestResponse {
  poses: Pose[];
  revision: string;
  manifestPath: string;
  presenterRoot: string;
  summary: ManifestSummary;
}

export interface SaveResponse {
  saved: true;
  revision: string;
  manifestPath: string;
  poses: Pose[];
  summary: ManifestSummary;
}

export interface NarrationFile {
  file: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface NarrationListResponse {
  files: NarrationFile[];
  directory: string;
}

export interface EnvelopeResponse {
  file: string;
  fps: number;
  frameCount: number;
  durationSec: number;
  reference: number;
  percentile: number;
  smoothingTaps: number;
  sampleRate: number;
  values: number[];
}

export interface HeadMarkResponse {
  svg: string;
  sha256: string;
  path: string;
}

/**
 * Read a `{ error }` body if there is one, else the raw text.
 *
 * @returns A message that always names the status, so an HTML error page (the
 *          shape a middleware redirect produces) is distinguishable from a real
 *          handler response.
 */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return `${res.status}: ${(parsed as { error: string }).error}`;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  const snippet = text.slice(0, 300).trim();
  return snippet.length > 0
    ? `${res.status} ${res.statusText}: ${snippet}`
    : `${res.status} ${res.statusText}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

/** GET the pose manifest. */
export function fetchManifest(): Promise<ManifestResponse> {
  return getJson<ManifestResponse>(`${BASE}/poses`);
}

/**
 * PUT the pose manifest.
 *
 * @param revision The revision the editor loaded. A mismatch is a 409 rather
 *        than a silent overwrite of another operator's calibration.
 */
export async function saveManifest(
  poses: Pose[],
  revision: string,
): Promise<SaveResponse> {
  const res = await fetch(`${BASE}/poses`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ poses, revision }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as SaveResponse;
}

/** URL of a pose PNG. Omit `width` for the untouched original. */
export function poseImageUrl(file: string, width?: number): string {
  const encoded = encodeURIComponent(file);
  return width === undefined
    ? `${BASE}/poses/image/${encoded}`
    : `${BASE}/poses/image/${encoded}?w=${width}`;
}

/** URL of a sample narration clip. */
export function narrationAudioUrl(file: string): string {
  return `${BASE}/narration/audio/${encodeURIComponent(file)}`;
}

/** GET the list of sample narration clips. */
export function fetchNarrationList(): Promise<NarrationListResponse> {
  return getJson<NarrationListResponse>(`${BASE}/narration`);
}

/** POST a sample narration clip. */
export async function uploadNarration(
  file: File,
): Promise<NarrationListResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/narration`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as NarrationListResponse;
}

/** GET the per-frame RMS envelope for one clip. */
export function fetchEnvelope(
  file: string,
  fps: number,
): Promise<EnvelopeResponse> {
  return getJson<EnvelopeResponse>(
    `${BASE}/envelope?file=${encodeURIComponent(file)}&fps=${fps}`,
  );
}

/** GET the on-disk head mark and its hash (drift check for the inlined copy). */
export function fetchHeadMark(): Promise<HeadMarkResponse> {
  return getJson<HeadMarkResponse>(`${BASE}/head-mark`);
}

/** POST a rasterised head mark for the browserless presenter compositor. */
export async function exportHeadMarkPng(params: {
  markBg: string;
  markFg: string;
  sizePx: number;
  fileName?: string;
}): Promise<{ written: string; sizePx: number; bytes: number }> {
  const res = await fetch(`${BASE}/head-mark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as {
    written: string;
    sizePx: number;
    bytes: number;
  };
}
