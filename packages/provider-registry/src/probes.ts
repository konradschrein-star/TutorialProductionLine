/**
 * Health probes.
 *
 * A probe is a cheap, side-effect-free HTTP call that proves a provider is
 * reachable and our credential is accepted (auth / models / credits
 * endpoints). Probes NEVER submit generation work — VUP in particular has
 * no delete endpoint, so anything submitted to it renders and costs.
 *
 * Providers with `probe: null` are never probed and report "unknown" with
 * the reason attached. That is deliberate: a fabricated green is worse than
 * an honest blank.
 */

import { PROVIDERS_BY_KEY } from "./catalog.js";
import type { HealthResult, ProbeSpec, ProviderDefinition } from "./types.js";

export type EnvLike = Record<string, string | undefined>;

/**
 * Is the credential for this provider present in the given environment?
 *
 * ── SEAM FOR THE SECRETS / SETTINGS AGENT (§3.3) ──────────────────────────────
 * This is the SINGLE join between System Health (which shows credential STATUS)
 * and Settings (which owns credential EDITING). System Health never edits keys;
 * it reads presence through THIS function against the WORKER's environment (not
 * hub-web's — they differ). When the Settings agent adds a DB-backed or
 * per-user credential store, extend key resolution HERE (or wrap this) so the
 * whole registry — probes, effectiveStatus, the provider cards — sees the new
 * source with no other change. Do not scatter `process.env[...]` reads
 * elsewhere; they must funnel through here.
 */
export function keyPresent(
  definition: ProviderDefinition,
  env: EnvLike,
): boolean {
  if (!definition.keyEnvVar) return true; // no credential needed
  const v = env[definition.keyEnvVar];
  return typeof v === "string" && v.trim().length > 0;
}

/** Resolved base URL: env override wins, then the catalog default. */
export function baseUrlFor(
  definition: ProviderDefinition,
  env: EnvLike,
): string | null {
  if (definition.urlEnvVar) {
    const v = env[definition.urlEnvVar];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\/+$/, "");
  }
  return definition.defaultBaseUrl?.replace(/\/+$/, "") ?? null;
}

function authHeaders(spec: ProbeSpec, key: string): Record<string, string> {
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  const auth = spec.auth ?? "none";
  if (auth === "none" || !key) return headers;
  if (auth === "bearer") headers["Authorization"] = `Bearer ${key}`;
  else if (auth === "raw") headers["Authorization"] = key;
  else if (auth === "x-api-key") headers["X-API-Key"] = key;
  else if (auth.startsWith("header:")) headers[auth.slice(7)] = key;
  return headers;
}

/**
 * Run one provider probe. Never throws.
 *
 * Statuses this can return:
 *   expired  — plan state says so; we do not even call out
 *   no_key   — credential env var missing
 *   unknown  — no probe defined, or no base URL resolvable
 *   up / degraded / down — an actual measurement
 */
export async function runProbe(
  definition: ProviderDefinition,
  env: EnvLike,
  now: Date = new Date(),
): Promise<HealthResult> {
  const checkedAt = now.toISOString();
  const base = {
    providerKey: definition.key,
    latencyMs: null,
    httpStatus: null,
    detail: null,
    checkedAt,
  };

  if (
    definition.planState === "expired" ||
    (definition.planExpiresAt &&
      new Date(definition.planExpiresAt).getTime() <= now.getTime())
  ) {
    return {
      ...base,
      status: "expired",
      error:
        definition.planNote ??
        `Plan expired${definition.planExpiresAt ? ` on ${definition.planExpiresAt}` : ""}`,
    };
  }

  // Cookie-file probe (yt-dlp): honest liveness for the Netscape cookie file,
  // never a download. Runs BEFORE the no_key / no-probe branches because the
  // cookie env var IS the key env var and its "presence" means the file path
  // is set, not that the file exists.
  if (definition.cookieFileEnvVar) {
    return probeCookieFile(definition, env, checkedAt);
  }

  if (!keyPresent(definition, env)) {
    return {
      ...base,
      status: "no_key",
      error: `${definition.keyEnvVar} is not set on this host`,
    };
  }

  const spec = definition.probe;
  if (!spec) {
    return {
      ...base,
      status: "unknown",
      error:
        definition.probeUnavailableReason ??
        "No probe defined for this provider",
    };
  }

  const url = spec.path.startsWith("http")
    ? spec.path
    : (() => {
        const b = baseUrlFor(definition, env);
        return b
          ? `${b}${spec.path.startsWith("/") ? "" : "/"}${spec.path}`
          : null;
      })();

  if (!url) {
    return {
      ...base,
      status: "unknown",
      error: `No base URL configured (${definition.urlEnvVar ?? "no url env var"})`,
    };
  }

  const key = definition.keyEnvVar ? (env[definition.keyEnvVar] ?? "") : "";
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: spec.method ?? "GET",
      headers: {
        // Never let a proxy hand us a cached verdict — a stale 200 is exactly
        // the kind of fake green this registry exists to prevent.
        "cache-control": "no-cache",
        ...authHeaders(spec, key),
        ...(spec.body ? { "content-type": "application/json" } : {}),
      },
      ...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
      signal: AbortSignal.timeout(spec.timeoutMs ?? 10_000),
    });
    const latencyMs = Date.now() - started;

    let detail: Record<string, unknown> | null = null;
    if (spec.extractDetail) {
      try {
        detail = spec.extractDetail(await res.clone().json());
      } catch {
        detail = null; // body was not JSON, or the extractor choked — non-fatal
      }
    }

    const ok = res.ok || (spec.okStatuses ?? []).includes(res.status);
    let status: HealthResult["status"];
    if (!ok) status = "down";
    else if (spec.degradedAboveMs && latencyMs > spec.degradedAboveMs)
      status = "degraded";
    else status = "up";

    return {
      providerKey: definition.key,
      status,
      latencyMs,
      httpStatus: res.status,
      detail,
      error: ok ? null : `HTTP ${res.status}`,
      checkedAt,
    };
  } catch (err) {
    return {
      providerKey: definition.key,
      status: "down",
      latencyMs: Date.now() - started,
      httpStatus: null,
      detail: null,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

/**
 * Cookie-file probe. Stats $cookieFileEnvVar and parses the Netscape format for
 * the earliest non-zero expiry. Never throws.
 *
 *   down     file missing / unreadable / every cookie already expired
 *   degraded earliest expiry within 7 days
 *   up       cookies present with a comfortable margin
 *
 * `node:fs` is imported dynamically so this module stays importable in
 * non-Node runtimes — the probe only ever runs in the worker prober / route.
 */
async function probeCookieFile(
  definition: ProviderDefinition,
  env: EnvLike,
  checkedAt: string,
): Promise<HealthResult> {
  const path = env[definition.cookieFileEnvVar as string];
  const base = {
    providerKey: definition.key,
    latencyMs: null,
    httpStatus: null,
    checkedAt,
  };
  if (!path || !path.trim()) {
    return {
      ...base,
      status: "no_key",
      detail: null,
      error: `${definition.cookieFileEnvVar} is not set on this host`,
    };
  }
  try {
    const { readFile, stat } = await import("node:fs/promises");
    await stat(path); // throws if missing
    const text = await readFile(path, "utf-8");
    const now = Math.floor(Date.now() / 1000);
    const expiries: number[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const cols = line.split("\t");
      // Netscape format: domain, flag, path, secure, EXPIRY, name, value
      if (cols.length >= 7) {
        const exp = Number(cols[4]);
        if (Number.isFinite(exp) && exp > 0) expiries.push(exp);
      }
    }
    if (expiries.length === 0) {
      return {
        ...base,
        status: "down",
        detail: { cookies: 0 },
        error:
          "Cookie file present but contains no session cookies with an expiry",
      };
    }
    const earliest = Math.min(...expiries);
    const daysLeft = Math.floor((earliest - now) / 86_400);
    const detail = {
      cookies: expiries.length,
      earliestExpiry: new Date(earliest * 1000).toISOString(),
      daysLeft,
    };
    if (earliest <= now) {
      return {
        ...base,
        status: "down",
        detail,
        error: `Earliest cookie expired ${-daysLeft}d ago — YouTube footage mining is broken`,
      };
    }
    return {
      ...base,
      status: daysLeft <= 7 ? "degraded" : "up",
      detail,
      error:
        daysLeft <= 7
          ? `Cookies expire in ${daysLeft}d — re-export soon`
          : null,
    };
  } catch (err) {
    return {
      ...base,
      status: "down",
      detail: null,
      error:
        err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "ENOENT"
          ? `Cookie file does not exist at ${path}`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

/** Probe every catalog provider concurrently. Never throws. */
export async function runAllProbes(
  env: EnvLike,
  providers: ProviderDefinition[] = [...PROVIDERS_BY_KEY.values()],
): Promise<HealthResult[]> {
  return Promise.all(providers.map((p) => runProbe(p, env)));
}
