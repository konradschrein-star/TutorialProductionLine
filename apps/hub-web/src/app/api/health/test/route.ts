import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSecret, sql } from "@repo/db";
import { probeDriveHealth } from "@repo/storage";
import { getAllQueueMetrics } from "@/lib/services/queue-service";
import { sendTestAlert } from "@/app/actions/alerts";
import { getUploaderSettings } from "@/lib/uploader/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/health/test  — run ONE real, cheap health check on demand.
 *
 * Body: { target: "script" | "tts" | "drive" | "telegram" | "redis" | "db" }
 * Returns: { ok: boolean, latencyMs: number, detail: string }
 *
 * This is the "Test" seam behind the System Health page. Unlike the passive
 * "are the keys present?" grid, each target here fires a genuine round-trip to
 * the underlying service with the RESOLVED key so the operator learns whether
 * the thing actually works, not just whether a secret exists.
 *
 * NEVER throws to the client. Every failure — a missing key, a 401, a timeout —
 * degrades to { ok: false, detail } so the UI can render ✗ + reason inline.
 * Gated on view:system-health (same permission as the page itself).
 */

const TARGETS = [
  "script",
  "tts",
  "drive",
  "telegram",
  "redis",
  "db",
  "uploader",
] as const;
type Target = (typeof TARGETS)[number];

interface TestResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

/** Wrap a check so it always resolves to a TestResult with a latency reading. */
async function timed(
  fn: () => Promise<{ ok: boolean; detail: string }>,
): Promise<TestResult> {
  const started = Date.now();
  try {
    const { ok, detail } = await fn();
    return { ok, latencyMs: Date.now() - started, detail };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * script — tiny DeepSeek chat completion ("ping") with the resolved key.
 * Mirrors the worker's default script engine (deepseek-v4-flash,
 * https://api.deepseek.com/chat/completions). ok on 200 + non-empty content.
 * We cap max_tokens hard: this must be the cheapest call that still proves the
 * key authenticates and the model responds.
 */
async function testScript(): Promise<{ ok: boolean; detail: string }> {
  const key = await getSecret(db, "DEEPSEEK_API_KEY").catch(() => "");
  if (!key) {
    return {
      ok: false,
      detail: "DEEPSEEK_API_KEY not set (secrets store or .env)",
    };
  }
  const model = process.env["DEEPSEEK_MODEL"] ?? "deepseek-v4-flash";
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 4,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    return {
      ok: false,
      detail: `DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (content.trim().length === 0) {
    return { ok: false, detail: `${model} returned 200 but empty content` };
  }
  return {
    ok: true,
    detail: `${model} replied "${content.trim().slice(0, 40)}"`,
  };
}

/**
 * tts — lightweight auth check against Fish Audio with the resolved key.
 * Reads the account credit balance (GET /wallet/self/api-credit) — a cheap,
 * auth-gated endpoint. We deliberately do NOT synthesise a clip. ok on 200.
 */
async function testTts(): Promise<{ ok: boolean; detail: string }> {
  const key = await getSecret(db, "FISH_API_KEY").catch(() => "");
  if (!key) {
    return {
      ok: false,
      detail: "FISH_API_KEY not set (secrets store or .env)",
    };
  }
  const base = process.env["FISH_API_BASE"] ?? "https://api.fish.audio";
  const res = await fetch(`${base}/wallet/self/api-credit`, {
    method: "GET",
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    return {
      ok: false,
      detail: `Fish Audio auth HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    credit?: number | string;
  };
  const credit = json.credit;
  return {
    ok: true,
    detail:
      credit !== undefined
        ? `Fish Audio auth OK — credit ${credit}`
        : "Fish Audio auth OK",
  };
}

/**
 * drive — reuse the existing Drive health seam (@repo/storage). probeDriveHealth
 * mints a token and reads the live quota, so it is a genuine round-trip. ok when
 * the token validates.
 */
async function testDrive(): Promise<{ ok: boolean; detail: string }> {
  const health = await probeDriveHealth(db);
  if (!health.configured) {
    return { ok: false, detail: health.reason ?? "Drive not configured" };
  }
  if (!health.enabled) {
    return { ok: false, detail: health.reason ?? "Drive disabled" };
  }
  if (health.tokenValid === false) {
    return {
      ok: false,
      detail: health.lastError
        ? `Auth failing: ${health.lastError.message}`
        : "Refresh token invalid",
    };
  }
  const warn =
    health.consentPublishingStatus === "testing"
      ? " (Testing consent — token expires in 7 days)"
      : "";
  return { ok: true, detail: `Drive token valid${warn}` };
}

/**
 * telegram — reuse sendTestAlert (proves token + chat id + transport). It runs
 * its own session/permission check, so an operator without edit:settings gets a
 * clean { ok:false } rather than a thrown error.
 */
async function testTelegram(): Promise<{ ok: boolean; detail: string }> {
  const result = await sendTestAlert();
  return {
    ok: result.success,
    detail: result.success
      ? "Test alert delivered to Telegram"
      : (result.error ?? "Failed to send test alert"),
  };
}

/**
 * redis — the queue-metrics fetch is a real Redis round-trip across every
 * pipeline queue. ok when it resolves.
 */
async function testRedis(): Promise<{ ok: boolean; detail: string }> {
  const metrics = await getAllQueueMetrics();
  const depth = metrics.reduce((sum, m) => sum + m.waiting + m.active, 0);
  return {
    ok: true,
    detail: `Redis reachable — ${metrics.length} queues, depth ${depth}`,
  };
}

/** db — a trivial `select 1` proves the Postgres pool answers. */
async function testDb(): Promise<{ ok: boolean; detail: string }> {
  await db.execute(sql`select 1`);
  return { ok: true, detail: "select 1 OK" };
}

async function testUploader(): Promise<{ ok: boolean; detail: string }> {
  const settings = await getUploaderSettings();
  const response = await fetch(settings.dashboardApiUrl, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    return { ok: false, detail: `Uploader dashboard HTTP ${response.status}` };
  return {
    ok: true,
    detail: `Uploader reachable — ${settings.enabled ? settings.executionMode : "disabled"}, ${settings.transport}`,
  };
}

const RUNNERS: Record<Target, () => Promise<{ ok: boolean; detail: string }>> =
  {
    script: testScript,
    tts: testTts,
    drive: testDrive,
    telegram: testTelegram,
    redis: testRedis,
    db: testDb,
    uploader: testUploader,
  };

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:system-health")) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let target: unknown;
  try {
    ({ target } = (await request.json()) as { target?: unknown });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof target !== "string" || !TARGETS.includes(target as Target)) {
    return NextResponse.json(
      { error: `target must be one of: ${TARGETS.join(", ")}` },
      { status: 400 },
    );
  }

  const result = await timed(RUNNERS[target as Target]);
  return NextResponse.json(result);
}
