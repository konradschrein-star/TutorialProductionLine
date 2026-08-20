'use client';

import { useState } from 'react';

/**
 * VA Productivity Line Chart
 * Shows video output over time with format toggles
 */

interface VideoOutputData {
  date: string;
  political_commentary: number;
  explainer: number;
  tech_comparison: number;
  total: number;
}

// Mock data generator
function generateMockData(days: number): VideoOutputData[] {
  const data: VideoOutputData[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    data.push({
      date: date.toISOString().split('T')[0],
      political_commentary: Math.floor(Math.random() * 8) + 2,
      explainer: Math.floor(Math.random() * 5) + 1,
      tech_comparison: Math.floor(Math.random() * 6) + 1,
      total: 0,
    });
  }

  // Calculate totals
  data.forEach(d => {
    d.total = d.political_commentary + d.explainer + d.tech_comparison;
  });

  return data;
}

const FORMAT_COLORS = {
  political_commentary: '#f97316',
  explainer: '#23decb',
  tech_comparison: '#a78bfa',
  total: 'var(--v2-accent)',
};

const FORMAT_LABELS = {
  political_commentary: 'Political Commentary',
  explainer: 'Explainer',
  tech_comparison: 'Tech Comparison',
  total: 'Total Average',
};

export function VAProductivityChart() {
  const [timeRange, setTimeRange] = useState<7 | 30 | 90>(30);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(
    new Set(['political_commentary', 'explainer', 'tech_comparison', 'total'])
  );

  const data = generateMockData(timeRange);

  // Calculate max value for scaling
  const maxValue = Math.max(
    ...data.map(d =>
      Math.max(
        activeFormats.has('political_commentary') ? d.political_commentary : 0,
        activeFormats.has('explainer') ? d.explainer : 0,
        activeFormats.has('tech_comparison') ? d.tech_comparison : 0,
        activeFormats.has('total') ? d.total : 0
      )
    ),
    1
  );

  const toggleFormat = (format: string) => {
    const newFormats = new Set(activeFormats);
    if (newFormats.has(format)) {
      newFormats.delete(format);
    } else {
      newFormats.add(format);
    }
    setActiveFormats(newFormats);
  };

  // SVG chart dimensions
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate points for each line
  const getPoints = (key: keyof VideoOutputData) => {
    return data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartWidth;
      const value = typeof d[key] === 'number' ? d[key] : 0;
      const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
      return { x, y, value };
    });
  };

  const createPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Time range selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: '#e5e2e1', margin: 0 }}>
          Video Output Over Time
        </h4>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setTimeRange(days as 7 | 30 | 90)}
              style={{
                padding: '4px 12px',
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                border: 'none',
                cursor: 'pointer',
                ...(timeRange === days
                  ? {
                      background: 'rgba(var(--v2-accent-rgb), 0.15)',
                      color: 'var(--v2-accent)',
                    }
                  : {
                      background: 'rgba(255,255,255,0.05)',
                      color: 'rgba(205,195,215,0.5)',
                    }),
              }}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 8,
        padding: 16,
        border: '1px solid rgba(var(--v2-accent-rgb), 0.08)',
      }}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + chartHeight - ratio * chartHeight;
            return (
              <line
                key={ratio}
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
            );
          })}

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + chartHeight - ratio * chartHeight;
            const value = Math.round(ratio * maxValue);
            return (
              <text
                key={ratio}
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                style={{ fontSize: 9, fill: 'rgba(205,195,215,0.5)' }}
              >
                {value}
              </text>
            );
          })}

          {/* Lines for each format */}
          {(['political_commentary', 'explainer', 'tech_comparison', 'total'] as const).map((format) => {
            if (!activeFormats.has(format)) return null;

            const points = getPoints(format);
            const path = createPath(points);
            const color = FORMAT_COLORS[format];
            const isTotal = format === 'total';

            return (
              <g key={format}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={isTotal ? 3 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={isTotal ? 1 : 0.8}
                />
                {/* Data points */}
                {points.map((point, i) => (
                  <circle
                    key={i}
                    cx={point.x}
                    cy={point.y}
                    r={isTotal ? 4 : 3}
                    fill={color}
                    opacity={0.9}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend with toggles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {(['political_commentary', 'explainer', 'tech_comparison', 'total'] as const).map((format) => {
          const isActive = activeFormats.has(format);
          const color = FORMAT_COLORS[format];
          const label = FORMAT_LABELS[format];
          const isTotal = format === 'total';

          return (
            <button
              key={format}
              onClick={() => toggleFormat(format)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: 20,
                border: 'none',
                cursor: 'pointer',
                background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                opacity: isActive ? 1 : 0.4,
                transition: 'all 0.2s',
              }}
            >
              <div
                style={{
                  width: isTotal ? 20 : 16,
                  height: isTotal ? 4 : 3,
                  borderRadius: 2,
                  background: color,
                }}
              />
              <span style={{
                fontSize: isTotal ? 11 : 10,
                color: '#e5e2e1',
                fontWeight: isTotal ? 700 : 600,
              }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
