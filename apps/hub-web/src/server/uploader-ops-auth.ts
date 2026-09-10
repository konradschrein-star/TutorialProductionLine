import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import postgres from "postgres";

export const UPLOADER_OPS_AUTH_PATH = "/api/uploader-ops/auth";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let sql: ReturnType<typeof postgres> | undefined;

function sessionCookie(header: string | undefined): string | null {
  if (!header || header.length > 16_384) return null;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("hub_session="));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice("hub_session=".length);
  return token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ? token
    : null;
}

/** nginx auth_request endpoint. Trusts the current database role, never cookie claims. */
export async function handleUploaderOpsAuth(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.url !== UPLOADER_OPS_AUTH_PATH) return false;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  const finish = (status: number) => {
    res.statusCode = status;
    res.end();
    return true;
  };
  if (req.method !== "GET") return finish(405);
  const token = sessionCookie(req.headers.cookie);
  if (!token) return finish(401);
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return finish(503);

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iat", "userId"],
    });
    if (
      typeof payload.userId !== "string" ||
      !UUID.test(payload.userId) ||
      typeof payload.iat !== "number" ||
      payload.iat > Date.now() / 1000 + 60
    ) return finish(401);
    userId = payload.userId.toLowerCase();
  } catch {
    return finish(401);
  }

  try {
    if (!process.env.DATABASE_URL) return finish(503);
    sql ??= postgres(process.env.DATABASE_URL, {
      max: 2,
      connect_timeout: 3,
      idle_timeout: 20,
      connection: { statement_timeout: 3000 },
    });
    const [user] = await sql<{ id: string; role: string; is_active: boolean }[]>`
      SELECT id, role, is_active FROM users WHERE id = ${userId}::uuid LIMIT 1
    `;
    if (!user || user.is_active !== true) return finish(401);
    if (user.role !== "ADMIN" && user.role !== "MANAGER") return finish(403);
    if (typeof user.id !== "string" || user.id.toLowerCase() !== userId) return finish(503);
    res.setHeader("X-Uploader-Ops-User", userId);
    return finish(204);
  } catch {
    return finish(503);
  }
}
