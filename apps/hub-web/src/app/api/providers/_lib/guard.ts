import { NextResponse } from "next/server";
import { getSession } from "@/app/(authenticated)/_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { setRegistryDb } from "@repo/provider-registry";
import { db } from "@/lib/db";

let wired = false;

/**
 * Point the registry at hub-web's existing pool instead of letting it open a
 * second one, and enforce the same permission the System Health page uses.
 *
 * Returns a NextResponse on refusal, or null when the caller may proceed.
 */
export async function guardProviders(): Promise<NextResponse | null> {
  if (!wired) {
    setRegistryDb(db);
    wired = true;
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "view:system-health")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Postgres error 42P01 = undefined_table. Migration 0038 has not been applied.
 * The UI renders this as an explicit setup state — never as "all healthy".
 */
export function isMissingRegistryTables(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "42P01") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /relation "provider/i.test(message) && /does not exist/i.test(message);
}
