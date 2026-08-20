'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * Global Error Boundary (Root Level)
 *
 * Catches unhandled errors at the application root level.
 * Must be a separate file from error.tsx and must include <html> and <body> tags.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console in development
    console.error('[Global Error Boundary]', error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
          <div className="backdrop-blur-xl bg-[#111113]/90 border border-[#1f1f23] rounded-lg p-8 max-w-md w-full text-center shadow-2xl">
            <AlertTriangle className="w-16 h-16 text-[#ef4444] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-gray-400 mb-6">
              An error occurred in the Server Components render.
              The specific message is omitted in production builds
              to avoid leaking sensitive details. A digest property
              is included on this error instance which may provide
              additional details about the nature of the error.
            </p>
            {error.digest && (
              <p className="text-xs text-gray-500 font-mono mb-6 bg-[#18181b] px-3 py-2 rounded border border-[#27272a]">
                Error ID: {error.digest}
              </p>
            )}
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={reset}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="flex items-center space-x-2 px-4 py-2 bg-[#18181b] hover:bg-[#27272a] text-white rounded-lg transition-all border border-[#27272a]"
              >
                <Home className="w-4 h-4" />
                <span>Go Home</span>
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
