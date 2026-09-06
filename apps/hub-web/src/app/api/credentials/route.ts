import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { setSecret, clearSecret, getSecretPresence } from "@repo/db";

/**
 * POST /api/credentials — the WRITE side of the ONE secrets area (S8).
 *
 * ADMIN only (manage:credentials — tighter than edit:settings, which MANAGER
 * holds). The response NEVER contains a secret value — only { ok } or an error.
 *
 *   { action: "set-credential",   name, value }
 *   { action: "clear-credential", name }
 *
 * The read/health side (presence, expiry) is System Health's; this file only
 * mutates encrypted_secrets and never reads a value back to the client.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body =
  | { action: "set-credential"; name: string; value: string }
  | { action: "clear-credential"; name: string };

const NAME_RE = /^[A-Z][A-Z0-9_]{1,80}$/;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "manage:credentials")) {
    return NextResponse.json(
      { error: "Forbidden — credentials are ADMIN only" },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.action === "set-credential") {
      if (!NAME_RE.test(body.name)) {
        return NextResponse.json(
          {
            error: `Invalid credential name '${body.name}' (expect ENV_VAR_STYLE)`,
          },
          { status: 400 },
        );
      }
      if (!body.value || body.value.trim().length === 0) {
        return NextResponse.json(
          { error: "Refusing to store an empty value" },
          { status: 400 },
        );
      }
      if (
        body.name === "UPLOADER_CALLBACK_SECRET" &&
        body.value.trim().length < 32
      ) {
        return NextResponse.json(
          {
            error: "Uploader connection tokens must be at least 32 characters",
          },
          { status: 400 },
        );
      }
      await setSecret(db, {
        name: body.name,
        value: body.value.trim(),
        userId: session.userId,
      });
      const presence = await getSecretPresence(db, body.name);
      return NextResponse.json({
        ok: true,
        source: presence.source,
        last4: presence.last4,
      });
    }

    if (body.action === "clear-credential") {
      if (!NAME_RE.test(body.name)) {
        return NextResponse.json({ error: "Invalid name" }, { status: 400 });
      }
      await clearSecret(db, body.name);
      const presence = await getSecretPresence(db, body.name);
      return NextResponse.json({
        ok: true,
        source: presence.source,
        last4: presence.last4,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    // Never echo the value; surface only the message.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Credential write failed" },
      { status: 500 },
    );
  }
}
