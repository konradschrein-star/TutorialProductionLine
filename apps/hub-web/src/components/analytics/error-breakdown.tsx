/**
 * Error Breakdown Panel - V2 Styling
 *
 * Shows error distribution by failure type.
 * Stacked bar visualization using inline styles.
 */

interface ErrorBreakdown {
  status: string;
  count: number;
}

interface ErrorBreakdownPanelProps {
  errors: ErrorBreakdown[];
}

const ERROR_COLORS: Record<string, string> = {
  FAILED_QMS: '#f59e0b',
  FAILED_RENDER: '#ef4444',
  FAILED_UPLOAD: '#8b5cf6',
  FAILED_GENERAL: '#6b7280',
};

function formatErrorType(status: string): string {
  return status
    .replace('FAILED_', '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ErrorBreakdownPanel({ errors }: ErrorBreakdownPanelProps) {
  const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);

  return (
    <div>
      {totalErrors === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <p style={{ fontSize: 12, color: '#23decb' }}>No errors in this period</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Stacked bar */}
          <div style={{
            height: 16,
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            background: 'rgba(255,255,255,0.05)',
          }}>
            {errors.map((err) => {
              const widthPercent = (err.count / totalErrors) * 100;
              const color = ERROR_COLORS[err.status] || '#6b7280';
              return (
                <div
                  key={err.status}
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: color,
                    minWidth: err.count > 0 ? '4px' : '0',
                    transition: 'all 0.3s',
                  }}
                />
              );
            })}
          </div>

          {/* Error list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {errors.map((err) => {
              const color = ERROR_COLORS[err.status] || '#6b7280';
              const percent = totalErrors > 0
                ? ((err.count / totalErrors) * 100).toFixed(1)
                : '0';

              return (
                <div key={err.status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        backgroundColor: color,
                      }}
                    />
                    <span style={{ fontSize: 12, color: '#e5e2e1' }}>
                      {formatErrorType(err.status)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e5e2e1' }}>{err.count}</span>
                    <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)' }}>({percent}%)</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ paddingTop: 8, borderTop: '1px solid rgba(var(--v2-accent-rgb), 0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)' }}>Total Errors</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ffb4ab' }}>{totalErrors}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
