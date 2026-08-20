'use client';

import { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Error Detail Panel
 *
 * Displays structured error information for a failed job.
 * Shows error code, category, retryable status, message, context,
 * and collapsible state machine history.
 * Includes "Copy Full Log" for diagnostic export.
 */

interface ErrorDetailPanelProps {
  jobId: string;
  status: string;
  errorMessage: string | null;
  errorDetail: {
    code: string;
    message: string;
    category: string;
    context?: Record<string, unknown>;
    retryable: boolean;
    timestamp: string;
  } | null;
  stateMachineHistory: Array<{
    from_status: string;
    to_status: string;
    timestamp: string;
    reason?: string;
  }>;
}

function buildDiagnosticReport(props: ErrorDetailPanelProps): string {
  const lines: string[] = [
    '=== Content Forge Error Report ===',
    `Job ID: ${props.jobId}`,
    `Status: ${props.status}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  if (props.errorDetail) {
    lines.push(
      '--- Error Detail ---',
      `Code: ${props.errorDetail.code}`,
      `Category: ${props.errorDetail.category}`,
      `Retryable: ${props.errorDetail.retryable ? 'Yes' : 'No'}`,
      `Message: ${props.errorDetail.message}`,
      `Timestamp: ${props.errorDetail.timestamp}`,
    );
    if (props.errorDetail.context) {
      lines.push(`Context: ${JSON.stringify(props.errorDetail.context, null, 2)}`);
    }
    lines.push('');
  } else if (props.errorMessage) {
    lines.push(
      '--- Error ---',
      `Message: ${props.errorMessage}`,
      '',
    );
  }

  if (props.stateMachineHistory.length > 0) {
    lines.push('--- State Machine History ---');
    for (const entry of props.stateMachineHistory) {
      const reason = entry.reason ? ` (${entry.reason})` : '';
      lines.push(`[${entry.timestamp}] ${entry.from_status} → ${entry.to_status}${reason}`);
    }
  }

  return lines.join('\n');
}

export function ErrorDetailPanel(props: ErrorDetailPanelProps) {
  const { jobId, status, errorMessage, errorDetail, stateMachineHistory } = props;
  const [copied, setCopied] = useState(false);

  // Return null if there is nothing to display at all
  if (!errorMessage && !errorDetail && stateMachineHistory.length === 0) {
    return null;
  }

  async function handleCopyLog() {
    const report = buildDiagnosticReport(props);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: prompt user
    }
  }

  const hasError = !!(errorMessage || errorDetail);

  return (
    <div className={cn(
      'rounded-lg border p-5 space-y-4',
      hasError
        ? 'border-error/20 bg-error/5 dark:bg-error/10'
        : 'border-surface-bright bg-transparent'
    )}>
      {/* Error section — only when there's an error */}
      {hasError && (
        <>
          {/* Header row with badges + copy */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center flex-wrap gap-2">
              {errorDetail && (
                <>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-error/10 text-error border border-error/20">
                    {errorDetail.code}
                  </span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-bright text-text-muted border border-surface-bright">
                    {errorDetail.category}
                  </span>
                  {errorDetail.retryable && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/20">
                      Retryable
                    </span>
                  )}
                </>
              )}
            </div>

            <button
              onClick={handleCopyLog}
              className={cn(
                'inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                copied
                  ? 'bg-success/10 text-success'
                  : 'bg-surface-container hover:bg-surface-bright text-text-muted',
              )}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Full Log</span>
                </>
              )}
            </button>
          </div>

          {/* Error message */}
          <div className="p-4 bg-error/10 border border-error/20 rounded-lg">
            <pre className="text-sm text-error whitespace-pre-wrap font-mono leading-relaxed">
              {errorDetail?.message ?? errorMessage}
            </pre>
          </div>

          {/* Context JSON */}
          {errorDetail?.context && Object.keys(errorDetail.context).length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-1.5 font-medium uppercase tracking-wide">
                Context
              </p>
              <pre className="p-3 bg-surface-container rounded-lg text-xs text-text-muted font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(errorDetail.context, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}

      {/* State machine history — always visible when populated */}
      {stateMachineHistory.length > 0 && (
        <details className="group" open={!hasError}>
          <summary className="flex items-center cursor-pointer text-sm text-text-muted hover:text-text transition-colors select-none">
            <ChevronDown className="w-4 h-4 mr-1.5 transition-transform group-open:rotate-180" />
            State Machine History ({stateMachineHistory.length} transitions)
          </summary>
          <div className="mt-2 space-y-1 pl-5.5">
            {stateMachineHistory.map((entry, i) => (
              <div key={i} className="flex items-baseline gap-2 text-xs font-mono">
                <span className="text-text-disabled shrink-0">
                  {entry.timestamp}
                </span>
                <span className="text-text-muted">
                  {entry.from_status}
                </span>
                <span className="text-text-disabled">&rarr;</span>
                <span className="text-text">
                  {entry.to_status}
                </span>
                {entry.reason && (
                  <span className="text-text-disabled italic">
                    ({entry.reason})
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
