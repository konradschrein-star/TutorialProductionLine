'use client';

/**
 * Production Velocity Chart - V2 Styling
 *
 * CSS-based bar chart showing jobs created vs completed per day.
 * No external charting library required.
 */

interface DailyJobStats {
  date: string;
  created: number;
  completed: number;
}

interface ProductionVelocityChartProps {
  data: DailyJobStats[];
}

export function ProductionVelocityChart({ data }: ProductionVelocityChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(205,195,215,0.4)', fontSize: 12 }}>
        No data available
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((d) => Math.max(d.created, d.completed)),
    1
  );

  // Show last 14 days max to keep readable
  const displayData = data.slice(-14);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
        {displayData.map((day) => {
          const createdHeight = (day.created / maxValue) * 100;
          const completedHeight = (day.completed / maxValue) * 100;
          const dateLabel = day.date.slice(5); // MM-DD

          return (
            <div
              key={day.date}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                position: 'relative',
              }}
            >
              <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: 2, height: 128 }}>
                {/* Created bar */}
                <div
                  style={{
                    flex: 1,
                    height: `${createdHeight}%`,
                    minHeight: day.created > 0 ? '4px' : '0',
                    background: 'rgba(var(--v2-accent-rgb), 0.3)',
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    transition: 'all 0.3s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(var(--v2-accent-rgb), 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(var(--v2-accent-rgb), 0.3)';
                  }}
                />
                {/* Completed bar */}
                <div
                  style={{
                    flex: 1,
                    height: `${completedHeight}%`,
                    minHeight: day.completed > 0 ? '4px' : '0',
                    background: '#23decb',
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    transition: 'all 0.3s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(35,222,203,0.8)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#23decb';
                  }}
                />
              </div>
              <span style={{ fontSize: 9, color: 'rgba(205,195,215,0.5)' }}>{dateLabel}</span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(var(--v2-accent-rgb), 0.3)' }} />
          <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.6)' }}>Created</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#23decb' }} />
          <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.6)' }}>Completed</span>
        </div>
      </div>
    </div>
  );
}
