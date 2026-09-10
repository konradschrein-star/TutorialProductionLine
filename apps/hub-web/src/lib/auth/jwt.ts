import { SignJWT, jwtVerify, type JWTPayload as JoseJWTPayload } from 'jose';

/**
 * JWT token generation and verification
 *
 * Uses jose library for robust JWT handling. Reads JWT_SECRET directly from
 * process.env to avoid the getHubConfig() chain, which can return a mock
 * secret when Zod validation fails (e.g. during build or on config errors).
 * Tokens expire after 7 days and include user ID and role.
 */

const TOKEN_EXPIRY = '7d';

export interface JWTPayload extends JoseJWTPayload {
  userId: string;
  role: string;
  email: string;
}

function getSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return new TextEncoder().encode(value);
}

export async function signToken(payload: JWTPayload): Promise<string> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getSecret());
  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string' || typeof payload.email !== 'string') throw new Error('Invalid session payload');
    return payload as unknown as JWTPayload;
  } catch {
    throw new Error('Invalid or expired token');
  }
}
