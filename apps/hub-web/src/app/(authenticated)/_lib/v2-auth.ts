import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/jwt';
import type { JWTPayload } from '@/lib/auth/jwt';

/**
 * Get the current session for authenticated pages.
 * Redirects to /login if no valid session exists.
 */
export async function getSession(): Promise<JWTPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get('hub_session')?.value;
  if (!token) redirect('/login');
  try {
    return await verifyToken(token);
  } catch {
    redirect('/login');
  }
}
