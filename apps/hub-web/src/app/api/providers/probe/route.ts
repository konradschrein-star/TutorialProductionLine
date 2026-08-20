import { NextRequest, NextResponse } from "next/server";
import {
  BUILT_IN_PROVIDERS,
  runAllProbes,
  runProbe,
  saveHealthResults,
  syncCatalog,
} from "@repo/provider-registry";
import { guardProviders, isMissingRegistryTables } from "../_lib/guard";

/**
 * POST /api/providers/probe
 *
 * Actually calls every provider's cheap auth/health/credits endpoint,
 * measures latency, and stores the result. Body `{ "key": "vup" }` probes
 * one provider instead of all of them.
 *
 * Providers with no safe probe are NOT called and come back "unknown" with
 * the reason. Expired plans are not called at all — an expired service that
 * still answers 200 must not read as healthy.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = await guardProviders();
  if (denied) return denied;

  let key: string | undefined;
  try {
    const body = (await request.json()) as { key?: string };
    key = body.key;
  } catch {
    // No body — probe everything.
  }

  try {
    const results = key
      ? await (async () => {
          const definition = BUILT_IN_PROVIDERS.find((p) => p.key === key);
          if (!definition) return null;
          return [await runProbe(definition, process.env)];
        })()
      : await runAllProbes(process.env);

    if (results === null) {
      return NextResponse.json(
        { error: `Unknown provider: ${key}` },
        { status: 404 },
      );
    }

    try {
      await syncCatalog();
      await saveHealthResults(results);
    } catch (err) {
      if (!isMissingRegistryTables(err)) throw err;
      // Probes ran for real; we just cannot persist them yet.
      return NextResponse.json({
        migrated: false,
        persisted: false,
        results,
        note: "Probes ran but could not be stored — migration 0038 is not applied.",
      });
    }

    return NextResponse.json({ migrated: true, persisted: true, results });
  } catch (err) {
    console.error("[api/providers/probe] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
