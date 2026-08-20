import { NextResponse } from "next/server";
import {
  capabilityOutcomes,
  loadSnapshot,
  recentFallbacks,
  recentUsage,
  syncCatalog,
  usageRollup,
} from "@repo/provider-registry";
import { guardProviders, isMissingRegistryTables } from "./_lib/guard";
import { buildRegistryView } from "@/app/(authenticated)/system-health/_lib/registry-view";

/**
 * GET /api/providers
 *
 * The whole provider whiteboard in one payload: every provider with its
 * effective status, every capability chain with its eligible/blocked hops,
 * per-consumer priorities, usage rollups, capability success rates, and the
 * recent fallback feed.
 *
 * When migration 0038 has not been applied this returns `migrated: false`
 * rather than an error, so the page can say so plainly instead of pretending
 * everything is fine.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await guardProviders();
  if (denied) return denied;

  try {
    await syncCatalog();
    const [snapshot, fallbacks, usage, rollup, outcomes] = await Promise.all([
      loadSnapshot(),
      recentFallbacks(25),
      recentUsage(50),
      usageRollup(24),
      capabilityOutcomes(24),
    ]);

    return NextResponse.json({
      migrated: true,
      ...buildRegistryView(snapshot, rollup),
      fallbacks,
      usage,
      capabilityOutcomes: outcomes,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (isMissingRegistryTables(err)) {
      return NextResponse.json({
        migrated: false,
        error:
          "Provider registry tables are missing. Apply migration 0038_provider_registry.sql.",
      });
    }
    console.error("[api/providers] GET failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
