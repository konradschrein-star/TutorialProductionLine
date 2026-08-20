import { NextRequest, NextResponse } from "next/server";
import {
  setConsumerPriority,
  setLinkEnabled,
  setProviderConcurrency,
  setProviderEnabled,
  syncCatalog,
} from "@repo/provider-registry";
import { guardProviders, isMissingRegistryTables } from "../_lib/guard";

/**
 * POST /api/providers/settings
 *
 * The editable half of the whiteboard. One endpoint, four actions:
 *
 *   { action: "provider-enabled",  key, enabled }
 *   { action: "provider-concurrency", key, maxConcurrent }   null = uncapped
 *   { action: "link-enabled",      capability, providerKey, consumer, enabled }
 *   { action: "consumer-priority", consumer, capability, priority }
 *
 * Turning a chain link on is how a fallback becomes permitted. It is
 * deliberately an explicit act rather than something the system does for you.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body =
  | { action: "provider-enabled"; key: string; enabled: boolean }
  | {
      action: "provider-concurrency";
      key: string;
      maxConcurrent: number | null;
    }
  | {
      action: "link-enabled";
      capability: string;
      providerKey: string;
      consumer?: string | null;
      enabled: boolean;
    }
  | {
      action: "consumer-priority";
      consumer: string;
      capability?: string | null;
      priority: number;
    };

export async function POST(request: NextRequest) {
  const denied = await guardProviders();
  if (denied) return denied;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await syncCatalog();

    switch (body.action) {
      case "provider-enabled":
        if (typeof body.key !== "string" || typeof body.enabled !== "boolean") {
          return NextResponse.json({ error: "Bad request" }, { status: 400 });
        }
        await setProviderEnabled(body.key, body.enabled);
        break;

      case "provider-concurrency": {
        const cap = body.maxConcurrent;
        if (
          typeof body.key !== "string" ||
          (cap !== null && (!Number.isInteger(cap) || cap < 0))
        ) {
          return NextResponse.json(
            { error: "maxConcurrent must be a non-negative integer or null" },
            { status: 400 },
          );
        }
        await setProviderConcurrency(body.key, cap);
        break;
      }

      case "link-enabled":
        if (
          typeof body.capability !== "string" ||
          typeof body.providerKey !== "string" ||
          typeof body.enabled !== "boolean"
        ) {
          return NextResponse.json({ error: "Bad request" }, { status: 400 });
        }
        await setLinkEnabled(
          body.capability,
          body.providerKey,
          body.consumer ?? null,
          body.enabled,
        );
        break;

      case "consumer-priority":
        if (
          typeof body.consumer !== "string" ||
          !Number.isInteger(body.priority)
        ) {
          return NextResponse.json({ error: "Bad request" }, { status: 400 });
        }
        await setConsumerPriority(
          body.consumer,
          body.capability ?? null,
          body.priority,
        );
        break;

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingRegistryTables(err)) {
      return NextResponse.json(
        {
          error:
            "Provider registry tables are missing. Apply migration 0038_provider_registry.sql.",
        },
        { status: 503 },
      );
    }
    console.error("[api/providers/settings] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
