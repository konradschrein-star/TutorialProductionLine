'use client';

import { useState } from 'react';

/**
 * Team KPIs Component
 * Shows best/worst performers, heat maps, footage metrics
 */

interface EmployeePerformance {
  id: string;
  name: string;
  videosProduced: number;
  avgQualityScore: number;
  minutesOfFootage: number;
}

// Mock data
const mockEmployees: EmployeePerformance[] = [
  { id: '1', name: 'Sarah Chen', videosProduced: 142, avgQualityScore: 9.2, minutesOfFootage: 4260 },
  { id: '2', name: 'Mike Rodriguez', videosProduced: 128, avgQualityScore: 8.8, minutesOfFootage: 3840 },
  { id: '3', name: 'Emma Watson', videosProduced: 95, avgQualityScore: 9.5, minutesOfFootage: 2850 },
  { id: '4', name: 'David Kim', videosProduced: 87, avgQualityScore: 7.9, minutesOfFootage: 2610 },
  { id: '5', name: 'Lisa Thompson', videosProduced: 156, avgQualityScore: 9.1, minutesOfFootage: 4680 },
];

// Generate heat map data (videos produced per day)
function generateHeatMapData() {
  const weeks = 12;
  const daysPerWeek = 7;
  const data: { week: number; day: number; count: number }[] = [];

  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < daysPerWeek; day++) {
      data.push({
        week,
        day,
        count: Math.floor(Math.random() * 15) + 2,
      });
    }
  }

  return data;
}

export function TeamKPIs() {
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const heatMapData = generateHeatMapData();

  // Calculate metrics
  const bestPerformer = [...mockEmployees].sort((a, b) => b.videosProduced - a.videosProduced)[0];
  const worstPerformer = [...mockEmployees].sort((a, b) => a.videosProduced - b.videosProduced)[0];
  const totalMinutes = mockEmployees.reduce((sum, e) => sum + e.minutesOfFootage, 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const maxVideos = Math.max(...mockEmployees.map(e => e.videosProduced));

  // Heat map color scale
  const getHeatColor = (count: number) => {
    const maxCount = Math.max(...heatMapData.map(d => d.count));
    const intensity = count / maxCount;

    if (intensity > 0.8) return 'rgba(var(--v2-accent-rgb), 0.9)';
    if (intensity > 0.6) return 'rgba(var(--v2-accent-rgb), 0.7)';
    if (intensity > 0.4) return 'rgba(var(--v2-accent-rgb), 0.5)';
    if (intensity > 0.2) return 'rgba(var(--v2-accent-rgb), 0.3)';
    return 'rgba(var(--v2-accent-rgb), 0.15)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top performers row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Best performer */}
        <div style={{
          background: 'rgba(35,222,203,0.08)',
          border: '1px solid rgba(35,222,203,0.2)',
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#23decb' }}>
              workspace_premium
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#23decb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Top Performer
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e2e1', marginBottom: 4 }}>
            {bestPerformer.name}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(205,195,215,0.6)' }}>
            {bestPerformer.videosProduced} videos · {bestPerformer.avgQualityScore.toFixed(1)} avg score
          </div>
        </div>

        {/* Needs support */}
        <div style={{
          background: 'rgba(249,115,22,0.08)',
          border: '1px solid rgba(249,115,22,0.2)',
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f97316' }}>
              priority_high
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Needs Support
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e2e1', marginBottom: 4 }}>
            {worstPerformer.name}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(205,195,215,0.6)' }}>
            {worstPerformer.videosProduced} videos · {worstPerformer.avgQualityScore.toFixed(1)} avg score
          </div>
        </div>
      </div>

      {/* Total footage metric */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#cdc3d7', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Total Footage Produced
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--v2-accent)', lineHeight: 1 }}>
            {totalHours.toLocaleString()} hours
          </div>
          <div style={{ fontSize: 11, color: 'rgba(205,195,215,0.5)', marginTop: 4 }}>
            {totalMinutes.toLocaleString()} minutes across all VAs
          </div>
        </div>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'rgba(var(--v2-accent-rgb), 0.2)' }}>
          video_library
        </span>
      </div>

      {/* Employee performance bars */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
        borderRadius: 12,
        padding: 16,
      }}>
        <h4 style={{ fontSize: 10, fontWeight: 700, color: '#e5e2e1', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, marginBottom: 16 }}>
          Individual Performance
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mockEmployees
            .sort((a, b) => b.videosProduced - a.videosProduced)
            .map((employee, index) => {
              const widthPercent = (employee.videosProduced / maxVideos) * 100;
              const isSelected = selectedEmployee === employee.id;

              return (
                <div
                  key={employee.id}
                  onClick={() => setSelectedEmployee(isSelected ? null : employee.id)}
                  style={{
                    cursor: 'pointer',
                    padding: 12,
                    borderRadius: 8,
                    background: isSelected ? 'rgba(var(--v2-accent-rgb), 0.08)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isSelected ? 'rgba(var(--v2-accent-rgb), 0.3)' : 'transparent'}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: index === 0 ? '#23decb' : 'rgba(var(--v2-accent-rgb), 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#fff',
                      }}>
                        {index + 1}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1' }}>
                        {employee.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 10 }}>
                      <span style={{ color: 'var(--v2-accent)', fontWeight: 700 }}>
                        {employee.videosProduced} videos
                      </span>
                      <span style={{ color: 'rgba(205,195,215,0.5)' }}>
                        {employee.minutesOfFootage} min
                      </span>
                      <span style={{ color: '#23decb' }}>
                        {employee.avgQualityScore.toFixed(1)} score
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    height: 6,
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${widthPercent}%`,
                      background: index === 0
                        ? 'linear-gradient(90deg, #23decb, var(--v2-accent))'
                        : 'linear-gradient(90deg, var(--v2-accent), var(--v2-accent-dim))',
                      transition: 'width 0.3s',
                    }} />
                  </div>

                  {/* Expanded details */}
                  {isSelected && (
                    <div style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                    }}>
                      <div style={{ fontSize: 10, color: 'rgba(205,195,215,0.7)', marginBottom: 8 }}>
                        Last 30 days trend (mock data)
                      </div>
                      {/* Simple mini sparkline */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
                        {Array.from({ length: 30 }, (_, i) => {
                          const value = Math.random() * 8 + 2;
                          const height = (value / 10) * 100;
                          return (
                            <div
                              key={i}
                              style={{
                                flex: 1,
                                height: `${height}%`,
                                background: 'rgba(var(--v2-accent-rgb), 0.4)',
                                borderRadius: 2,
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Heat map */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
        borderRadius: 12,
        padding: 16,
      }}>
        <h4 style={{ fontSize: 10, fontWeight: 700, color: '#e5e2e1', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, marginBottom: 12 }}>
          Production Heat Map (Last 12 Weeks)
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, minWidth: 500 }}>
            {heatMapData.map((cell, index) => (
              <div
                key={index}
                title={`Week ${cell.week + 1}, Day ${cell.day + 1}: ${cell.count} videos`}
                style={{
                  aspectRatio: '1',
                  background: getHeatColor(cell.count),
                  borderRadius: 3,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.zIndex = '1';
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 9, color: 'rgba(205,195,215,0.5)' }}>Less</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {[0.15, 0.3, 0.5, 0.7, 0.9].map((opacity, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: `rgba(var(--v2-accent-rgb), ${opacity})`,
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 9, color: 'rgba(205,195,215,0.5)' }}>More</span>
        </div>
      </div>
    </div>
  );
}
