import type { JWTPayload } from './jwt';

/**
 * Check if user can edit upload queue (metadata, cancel jobs)
 */
export function canEditUploadQueue(session: JWTPayload | null): boolean {
  if (!session) return false;

  return (
    session.role === 'ADMIN' ||
    session.role === 'MANAGER' ||
    session.role === 'UPLOADER_VA'
  );
}

