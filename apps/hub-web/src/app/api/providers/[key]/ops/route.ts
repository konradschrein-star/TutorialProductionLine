import { NextRequest, NextResponse } from "next/server";
import { guardProviders, isMissingRegistryTables } from "../../_lib/guard";
import { collectVeoForgeOps } from "@/lib/media-ops/veoforge-ops";
import { collectFleetOps } from "@/lib/media-ops/fleet-ops";
import { loadProviderHistory, firstEverCheck } from "@/lib/media-ops/history";

/**
 * GET /api/providers/[key]/ops
 *
 * The payload behind the double-click detail view: live operational state for
 * one provider, plus the analytics/outage history we have stored for it.
 *
 * AUTH: `/api/providers` is on the middleware's API_ROUTES bypass list, which
 * covers this nested path by prefix. That list is a bypass, NOT a grant — so
 * this handler self-authenticates through guardProviders() (session +
 * `view:system-health`), exactly like the sibling provider routes.
 *
 * SECRETS: the admin credentials for VeoForge and the VUP fleet are read
 * server-side inside the collectors and are never included in this response.
 * Account emails and proxy exit IPs are masked before they leave the server.
 *
 * Providers other than the two operator-built APIs get history only — that is
 * an honest partial answer rather than a fabricated ops panel.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * Providers with a real operations adapter.
 *
 *   veoforge   the operator's own service — /metrics, /status, /accounts
 *   veo_fleet  the VEO wrapper as it exists today: the VPS-side bridge
 *              orchestrator that owns the workers, the libvirt VM list and
 *              the job DB. This is where VM count / throughput / lifetime
 *              actually live.
 *
 * `vup` (the legacy direct :5210 wrapper) is deliberately NOT here. It exposes
 * only /health, and since veo_fleet supersedes it the honest answer for that
 * card is stored probe history, not a fabricated ops panel.
 */
const LIVE_OPS_PROVIDERS = new Set(["veoforge", "veo_fleet"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = await guardProviders();
  if (denied) return denied;

  const { key } = await params;
  if (!/^[a-z0-9_]{1,40}$/.test(key)) {
    return NextResponse.json({ error: "Invalid provider key" }, { status: 400 });
  }

  const windowHours = clampInt(
    request.nextUrl.searchParams.get("hours"),
    24 * 7,
    1,
    24 * 90,
  );

  try {
    // History is best-effort: a live panel is still worth showing when the
    // registry tables are missing, and vice versa.
    const [history, firstSeen] = await Promise.all([
      loadProviderHistory(key, windowHours).catch((err) => {
        if (isMissingRegistryTables(err)) return null;
        throw err;
      }),
      firstEverCheck(key).catch(() => null),
    ]);

    let live: unknown = null;
    let liveError: string | null = null;
    if (LIVE_OPS_PROVIDERS.has(key)) {
      try {
        live =
          key === "veoforge" ? await collectVeoForgeOps() : await collectFleetOps();
      } catch (err) {
        liveError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({
      providerKey: key,
      hasLiveOps: LIVE_OPS_PROVIDERS.has(key),
      live,
      liveError,
      history,
      firstEverCheckedAt: firstSeen,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[api/providers/${key}/ops] failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
