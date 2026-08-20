'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { JWTPayload } from '@/lib/auth/jwt';

/**
 * Session Provider
 *
 * Provides session data to all client components via React Context.
 * Session is fetched on the server and passed down.
 */

interface SessionContextValue {
  session: JWTPayload | null;
}

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined
);

export function SessionProvider({
  children,
  session,
}: {
  children: ReactNode;
  session: JWTPayload | null;
}) {
  return (
    <SessionContext.Provider value={{ session }}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Hook to access session in client components
 */
export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
