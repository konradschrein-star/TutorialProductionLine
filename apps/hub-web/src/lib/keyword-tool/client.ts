import "server-only";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import type { JWTPayload } from "@/lib/auth/jwt";
import { keywordApiBase, keywordIntegrationState } from "./workflow";

/**
 * Server-side Keyword Tool client, acting AS the signed-in Content Forge user.
 *
 * ## Why act as the user rather than as a machine
 *
 * The question the Tutorial Studio needs answered is "which keywords has THIS
 * VA claimed" — a per-user question. The Keyword Tool already answers it, and
 * it already trusts a token signed with the shared KT_EMBED_SECRET: that is how
 * the embedded Keywords tab logs a hub user in (`/api/integration/forge/
 * embed-login`). So we mint the same handoff token the iframe uses, exchange it
 * for a KT session, and ask as them. No new trust relationship, no new secret,
 * and KT's own permissions still apply — a VA cannot see another VA's claims
 * through this any more than they can through the board.
 *
 * KT find-or-creates its user from the email, and KT stays authoritative on
 * role once a user exists. The four tutorial VAs already exist there with
 * matching emails.
 *
 * ## Failure posture
 *
 * Every call throws `KeywordToolError` with a readable message. Callers surface
 * it; nothing here falls back to an empty list, because "you have no claimed
 * keywords" and "the keyword board could not be reached" must not look the same
 * to a VA deciding what to work on next.
 */

export class KeywordToolError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "KeywordToolError";
  }
}

export interface KtUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface KtSession {
  token: string;
  user: KtUser;
  base: string;
}

function config(): { base: string; secret: string } {
  const base = process.env["KT_EMBED_URL"];
  const secret = process.env["KT_EMBED_SECRET"];
  if (keywordIntegrationState(process.env) !== "configured" || !base || !secret) {
    throw new KeywordToolError(
      "The keyword board is not connected on this server (KT_EMBED_URL / KT_EMBED_SECRET are unset).",
      503,
    );
  }
  try { return { base: keywordApiBase(process.env), secret }; }
  catch { throw new KeywordToolError("The Keyword Tool API address is invalid. Ask an administrator to check the integration configuration.", 503); }
}

/**
 * Exchange the hub session for a Keyword Tool session for the same person.
 *
 * This call is also how the two account systems stay in step. They are the same
 * people — same humans, same emails — held in two tables, and the handoff token
 * is the only moment both sides are in the same place at the same time. So it
 * carries the full identity (email, name, role) read from the Content Forge
 * users table, and the Keyword Tool mirrors it.
 *
 * The name is read from the DB, NOT from the session JWT, which only carries
 * `{userId, role, email}`. That mattered: sending nothing made the Keyword Tool
 * invent a display name from the email's local part and overwrite the real one,
 * so "Vaughn" and "Konrad" became "vaughnlei" and "konrad.schrein" on the board.
 */
export async function ktLogin(session: JWTPayload): Promise<KtSession> {
  const { base, secret } = config();

  const [me] = await db
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const token = await new SignJWT({
    email: session.email,
    // The DB row is the authority. The session's role is a snapshot from
    // sign-in time and can be up to seven days stale.
    role: me?.role ?? session.role,
    name: me?.name?.trim() ?? "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));

  let res: Response;
  try {
    res = await fetch(`${base}/api/integration/forge/embed-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new KeywordToolError(
      `The keyword board is unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new KeywordToolError(
      `The keyword board rejected the sign-in (${res.status}). ${body.slice(0, 200)}`,
      res.status === 403 ? 403 : 502,
    );
  }

  const data = (await res.json()) as { token?: string; user?: KtUser };
  if (!data.token || !data.user) {
    throw new KeywordToolError(
      "The keyword board returned an unusable session.",
    );
  }
  return { token: data.token, user: data.user, base };
}

/** GET a Keyword Tool endpoint with an established session. */
export async function ktGet<T>(
  kt: KtSession,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const url = new URL(`${kt.base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${kt.token}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new KeywordToolError(
      `The keyword board is unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new KeywordToolError(
      `The keyword board returned ${res.status} for ${path}. ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** Deep link to one keyword on the board, for "open in the Keywords tab". */
export function ktKeywordUrl(keywordId: number | string): string {
  const base = (process.env["KT_EMBED_URL"] ?? "").replace(/\/$/, "");
  return `${base}/board?kid=${encodeURIComponent(String(keywordId))}`;
}

/** The existing KT intent service owns persistence, retries and callback binding. */
export async function ktProduce(kt: KtSession, keywordId: string, payload: unknown) {
  let response: Response;
  try {
    response = await fetch(`${kt.base}/api/v5/keywords/${encodeURIComponent(keywordId)}/produce`, {
      method: "POST", headers: { Authorization: `Bearer ${kt.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000), cache: "no-store",
    });
  } catch {
    throw new KeywordToolError("Acknowledgement is uncertain. Retry this same keyword; its saved request will be reused. Do not create a replacement tutorial.", 503);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new KeywordToolError(
    typeof result.detail === "string" ? result.detail : "Keyword production could not be confirmed. Keep this keyword selected and check its saved request.",
    response.status >= 400 && response.status < 500 ? response.status : 502);
  return result as { state?: string; forge_job_id?: string; duplicate?: boolean; message?: string };
}
