'use client';

import { FileQuestion, Home, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * 404 Not Found Page
 *
 * Displayed when a route doesn't exist.
 * Provides navigation back to dashboard.
 */

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="glass rounded-lg p-8 border border-surface-bright max-w-md w-full text-center">
        <FileQuestion className="w-16 h-16 text-text-muted mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-text mb-2">Page Not Found</h1>
        <p className="text-text-muted mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex items-center justify-center space-x-3">
          <Link
            href="/"
            className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-all"
          >
            <Home className="w-4 h-4" />
            <span>Go to Dashboard</span>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center space-x-2 px-4 py-2 bg-surface-container hover:bg-surface-bright text-text rounded-lg transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    </div>
  );
}
