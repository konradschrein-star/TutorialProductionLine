import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from '../services/metricsService';
import { StorageService } from '../services/storageService';

describe('MetricsService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should compute production metrics and velocity metrics', () => {
    const metrics = MetricsService.getMetrics();
    expect(metrics.totalProduced).toBeGreaterThan(0);
    expect(metrics.totalDurationMinutes).toBeGreaterThan(0);
    expect(metrics.dailyVelocity.length).toBe(7);
    expect(metrics.dailyVelocity[0]).toHaveProperty('date');
    expect(metrics.dailyVelocity[0]).toHaveProperty('count');
  });

  it('should reflect new finished video additions in metrics and calculate VA productivity', () => {
    const initial = MetricsService.getMetrics();
    expect(initial.vaProductivityList).toBeDefined();
    expect(initial.vaProductivityList!.length).toBeGreaterThan(0);
    expect(initial.vaProductivityList![0]).toHaveProperty('efficiencyRating');

    StorageService.addFinishedVideo({
      id: 'metric_test_vid',
      title: 'New Metric Test Video',
      channel: 'Entrepreneurs Skool',
      status: 'Uploaded to Drive',
      thumbnailUrl: '/test.png',
      duration: '5:00',
      script: 'Test script',
      tags: ['test'],
      createdAt: new Date().toISOString()
    });

    const updated = MetricsService.getMetrics();
    expect(updated.totalProduced).toBe(initial.totalProduced + 1);
  });
});
