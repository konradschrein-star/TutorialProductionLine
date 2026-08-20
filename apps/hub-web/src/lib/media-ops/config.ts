import "server-only";

/**
 * Endpoint configuration for the two operator-built media APIs, for
 * OBSERVABILITY ONLY.
 *
 * This module must never be imported from a client component. The admin
 * credentials below are read from the environment and used exclusively in
 * route handlers running on the server; nothing here is ever serialised into
 * a response body or a client bundle. (VeoForge's own public UI bakes a
 * *demo* token into its client JS — the admin token must never follow it
 * there, which is why this file is `server-only`.)
 *
 * These are DELIBERATELY separate from the media gateway's provider clients
 * (`apps/worker-orchestrator/src/utils/media-gateway/*`). Those submit work;
 * these only read counters. They are also separate endpoints:
 *
 *   VUP_API_URL (gateway)   http://192.168.122.93:5210  — the wrapper inside
 *                           the win11 guest, reached over the libvirt LAN.
 *   VUP_FLEET_URL (here)    http://127.0.0.1:8091       — the fleet
 *                           orchestrator that owns the workers, the VM list
 *                           and the job DB. This is what has the analytics.
 *
 * Defaults point at the public hostnames so this works from a dev laptop;
 * on the VPS the .env pins the loopback ports, which skips nginx (and its
 * basic-auth layer) entirely.
 */

export interface OpsEndpoint {
  baseUrl: string;
  /** Header name → value. Empty when no credential is configured. */
  headers: Record<string, string>;
  /** True when a credential is actually present. */
  configured: boolean;
  /** Why it is not usable, for honest UI copy. */
  reason: string | null;
}

function trimUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

/** Optional `user:pass` for reaching the VUP fleet through nginx. */
function basicAuthHeader(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.includes(":")) return {};
  return { authorization: `Basic ${Buffer.from(raw.trim()).toString("base64")}` };
}

export function veoforgeEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): OpsEndpoint {
  const baseUrl = trimUrl(
    env.VEOFORGE_API_URL || "https://veoforge.schreinercontentsystems.com",
  );
  const key = env.VEOFORGE_API_KEY?.trim();
  if (!key) {
    return {
      baseUrl,
      headers: {},
      configured: false,
      reason:
        "VEOFORGE_API_KEY is not set on this host. /health works without auth, but /metrics, /status and /accounts are admin-scoped and will 401.",
    };
  }
  return {
    baseUrl,
    headers: { authorization: `Bearer ${key}` },
    configured: true,
    reason: null,
  };
}

export function vupFleetEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): OpsEndpoint {
  // VEO_FLEET_* are the canonical names owned by the media-gateway's
  // veo-fleet-client; VUP_FLEET_* are accepted as aliases so this panel keeps
  // working on hosts that were configured before that client landed.
  const baseUrl = trimUrl(
    env.VEO_FLEET_API_URL ||
      env.VUP_FLEET_URL ||
      "https://veo.schreinercontentsystems.com/api",
  );
  const key = (env.VEO_FLEET_API_KEY || env.VUP_FLEET_KEY)?.trim();
  const basic = basicAuthHeader(env.VUP_FLEET_BASIC);

  // Two valid shapes:
  //   loopback :8091 — needs x-api-key, no basic auth
  //   public /api    — nginx injects x-api-key itself but demands basic auth
  const viaNginx = /^https?:\/\//i.test(baseUrl) && !/127\.0\.0\.1|localhost/.test(baseUrl);
  if (viaNginx && !basic.authorization) {
    return {
      baseUrl,
      headers: {},
      configured: false,
      reason:
        "Reaching the fleet through veo.schreinercontentsystems.com requires HTTP basic auth. Set VUP_FLEET_BASIC=user:pass, or point VUP_FLEET_URL at http://127.0.0.1:8091 on the VPS and set VUP_FLEET_KEY.",
    };
  }
  if (!viaNginx && !key) {
    return {
      baseUrl,
      headers: {},
      configured: false,
      reason:
        "Neither VEO_FLEET_API_KEY nor VUP_FLEET_KEY is set on this host; :8091 rejects with 401.",
    };
  }
  return {
    baseUrl,
    headers: { ...(key ? { "x-api-key": key } : {}), ...basic },
    configured: true,
    reason: null,
  };
}

/**
 * The self-healing monitor (`veo-fleet-monitor`, :9200). Not proxied publicly,
 * so it is loopback-only and reachable only from the VPS.
 */
export function vupMonitorEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): OpsEndpoint {
  const baseUrl = trimUrl(env.VUP_MONITOR_URL || "http://127.0.0.1:9200");
  return { baseUrl, headers: {}, configured: true, reason: null };
}
