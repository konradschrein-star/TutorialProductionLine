import { cookies } from "next/headers";
import { signToken, verifyToken, type JWTPayload } from "./jwt";

/**
 * Session management using HTTP-only cookies
 *
 * Sessions are stored as JWT tokens in secure, HTTP-only cookies.
 * Tokens expire after 7 days and are automatically refreshed on valid requests.
 */

const SESSION_COOKIE_NAME = "hub_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/**
 * Create a new session for a user
 *
 * @param payload - User data to store in session
 */
export async function createSession(payload: JWTPayload): Promise<void> {
  const token = await signToken(payload);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

/**
 * Get the current session from cookies
 *
 * @returns Session payload if valid, null otherwise
 */
export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    const payload = await verifyToken(token);
    return payload;
  } catch (error) {
    // Token is invalid or expired
    return null;
  }
}

/**
 * Destroy the current session
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Check if the current session is valid
 *
 * @returns true if session exists and is valid
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}
