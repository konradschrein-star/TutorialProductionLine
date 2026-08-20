'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

/**
 * Global Error Boundary
 *
 * Catches unhandled errors and displays user-friendly error page.
 * Provides options to retry or return to dashboard.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console in development
    console.error('[Error Boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="glass rounded-lg p-8 border border-surface-bright max-w-md w-full text-center">
        <AlertTriangle className="w-16 h-16 text-error mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-text mb-2">Something went wrong</h1>
        <p className="text-text-muted mb-6">
          {error.message || 'An unexpected error occurred'}
        </p>
        {error.digest && (
          <p className="text-xs text-text-disabled font-mono mb-6">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center space-x-3">
          <button
            onClick={reset}
            className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
          <Link
            href="/"
            className="flex items-center space-x-2 px-4 py-2 bg-surface-container hover:bg-surface-bright text-text rounded-lg transition-all"
          >
            <Home className="w-4 h-4" />
            <span>Go Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
