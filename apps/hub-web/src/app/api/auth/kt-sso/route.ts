import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { signToken } from "@/lib/auth/jwt";
import {
  findUserByEmail,
  createUser,
} from "@/lib/repositories/user-repository";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

/**
 * Keyword Tool role → Content Forge OperatorRole. Inverse of the CF→KT map in
 * the Keyword Tool (`_CF_ROLE_TO_KT`). A KT "va" maps to TUTORIAL_VA, which RBAC
 * scopes to /tutorial-studio — i.e. exactly the tutorial tool. Unknown/pending → the
 * read-only VIEWER so an unmapped-but-authenticated VA still lands safely.
 */
const KT_ROLE_TO_CF: Record<string, string> = {
  admin: "ADMIN",
  manager: "MANAGER",
  uploader: "UPLOADER_VA",
  va: "TUTORIAL_VA",
  viewer: "VIEWER",
  system: "ADMIN",
};

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, matches createSession()

function fail(base: string, reason: string) {
  return NextResponse.redirect(new URL(`/login?sso=${reason}`, base));
}

/**
 * GET /api/auth/kt-sso?t=<token>
 *
 * Single sign-on landing for Keyword Tool VAs — the reverse of the embedded
 * "Keywords" tab. The Keyword Tool mints a short-lived HS256 handoff token
 * ({email, role, name}) signed with the shared KT_EMBED_SECRET; here we verify
 * it, find-or-create a matching CF user, map the KT role → CF OperatorRole, and
 * issue a normal `hub_session` cookie. So the same VAs who log into the Keyword
 * Tool are logged into Content Forge the same way.
 *
 * Exempt from the middleware RBAC gate (see middleware.ts API_ROUTES): the
 * inbound request carries the KT token in ?t= but has no hub_session yet.
 */
export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin;
  const token = req.nextUrl.searchParams.get("t");
  const secret = process.env.KT_EMBED_SECRET;
  if (!token) return fail(base, "missing");
  if (!secret) return fail(base, "unconfigured");

  let email = "";
  let ktRole = "";
  let name = "";
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    email = String(payload.email ?? "")
      .trim()
      .toLowerCase();
    ktRole = String(payload.role ?? "").toLowerCase();
    name = String(payload.name ?? "").trim() || email;
  } catch {
    return fail(base, "invalid");
  }
  if (!email) return fail(base, "no_email");

  const cfRole = KT_ROLE_TO_CF[ktRole] ?? "VIEWER";

  let user = await findUserByEmail(email);
  if (!user) {
    // KT VAs authenticate via Google on the KT side and never log into CF with a
    // password, so seed a throwaway hash to satisfy the NOT NULL passwordHash.
    // An existing user keeps their CF role (we only assign on create) — matching
    // the KT embed-login behaviour, so a manual CF role change is never clobbered.
    user = await createUser({
      email,
      name,
      role: cfRole as never,
      passwordHash: await hashPassword(randomUUID()),
    });
  }
  if (user.isActive === false) return fail(base, "disabled");

  const sessionToken = await signToken({
    userId: user.id,
    role: user.role,
    email: user.email,
  });
  const res = NextResponse.redirect(new URL("/tutorial-studio", base));
  res.cookies.set("hub_session", sessionToken, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
