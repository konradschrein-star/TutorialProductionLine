'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSSE } from './use-sse';

/**
 * useJobErrorAlerts
 *
 * Subscribes to the SSE stream for job_status_changed events.
 * When to_status begins with FAILED_, fires a sonner error toast
 * with a "View job" action link.
 */
export function useJobErrorAlerts(): void {
  const router = useRouter();
  const { data } = useSSE('job_status_changed');

  useEffect(() => {
    if (!data?.payload) return;

    const toStatus = data.payload['to_status'];
    if (typeof toStatus !== 'string' || !toStatus.startsWith('FAILED_')) return;

    const jobId = data.job_id ?? 'unknown';
    const rawMessage = data.payload['error_message'];
    const errorMessage =
      typeof rawMessage === 'string' && rawMessage.length > 0
        ? rawMessage.slice(0, 80) + (rawMessage.length > 80 ? '…' : '')
        : toStatus;

    toast.error(`Job failed: ${toStatus}`, {
      id: `job-failed-${jobId}-${toStatus}`,
      description: errorMessage,
      action: {
        label: 'View job',
        onClick: () => router.push(`/jobs/${jobId}`),
      },
      duration: 8000,
    });
  }, [data, router]);
}
