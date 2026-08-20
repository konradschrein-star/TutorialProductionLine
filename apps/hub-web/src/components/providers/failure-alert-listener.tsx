'use client';

import { useJobErrorAlerts } from '@/hooks/use-job-error-alerts';

/**
 * FailureAlertListener
 *
 * Renders nothing. Side-effect only: subscribes to SSE stream
 * and fires sonner toasts when a job transitions to FAILED_*.
 */
export function FailureAlertListener() {
  useJobErrorAlerts();
  return null;
}
