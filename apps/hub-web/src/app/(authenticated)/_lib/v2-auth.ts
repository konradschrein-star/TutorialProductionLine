import { redirect } from 'next/navigation';
import { getSession as getCurrentSession } from '@/lib/auth/session';
import type { JWTPayload } from '@/lib/auth/jwt';

/**
 * Get the current session for authenticated pages.
 * Redirects to /login if no valid session exists.
 */
export async function getSession(): Promise<JWTPayload> {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  return session;
}
