import "server-only";

/**
 * One-shot authenticated GET that never throws.
 *
 * Every panel in the provider detail view is built from several independent
 * upstream calls. If one 401s or times out the rest must still render, and
 * the UI must be able to say WHICH one failed and why — a half-empty panel
 * with no explanation is the failure mode this whole page exists to prevent.
 * So the failure is data, not an exception.
 */

export type Fetched<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; error: string; httpStatus: number | null; latencyMs: number };

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000,
): Promise<Fetched<T>> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { ...headers, "cache-control": "no-cache" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401 || res.status === 403
            ? `HTTP ${res.status} — credential rejected for ${new URL(url).pathname}`
            : `HTTP ${res.status} from ${new URL(url).pathname}`,
        httpStatus: res.status,
        latencyMs,
      };
    }
    return { ok: true, data: (await res.json()) as T, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      httpStatus: null,
      latencyMs: Date.now() - started,
    };
  }
}
