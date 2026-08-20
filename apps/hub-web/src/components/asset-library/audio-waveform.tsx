'use client';

import { useEffect, useRef } from 'react';

/**
 * AudioWaveform Component
 *
 * Canvas-based waveform visualization for audio assets.
 * Renders 200 vertical bars representing amplitude data.
 *
 * Design: DaVinci Resolve-style lime green waveform.
 */

interface AudioWaveformProps {
  /** Array of 200 amplitude values (0-1) */
  data: number[];
  /** Canvas width in pixels */
  width?: number;
  /** Canvas height in pixels */
  height?: number;
  /** Bar color (CSS color string) */
  color?: string;
}

export function AudioWaveform({
  data,
  width = 200,
  height = 60,
  color = 'rgba(var(--v2-accent-rgb), 0.8)'
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set canvas actual size (for high DPI displays)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Draw waveform bars
    const barWidth = width / data.length;
    ctx.fillStyle = color;

    data.forEach((amplitude, i) => {
      const barHeight = Math.max(1, amplitude * height); // Min 1px height
      const x = i * barWidth;
      const y = (height - barHeight) / 2; // Center vertically

      ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
    });

  }, [data, width, height, color]);

  if (data.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--v2-text-2)',
          fontSize: 11,
          background: 'rgba(var(--v2-surface-bright-rgb), 0.3)',
          borderRadius: 4,
        }}
      >
        No waveform
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        imageRendering: 'crisp-edges',
      }}
    />
  );
}
