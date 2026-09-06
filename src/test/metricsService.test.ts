import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from '../services/metricsService';
import { StorageService } from '../services/storageService';

describe('MetricsService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should honestly report zero on an empty store', () => {
    // No fabricated demo data — a fresh store produces true zeros.
    const empty = MetricsService.getMetrics();
    expect(empty.totalProduced).toBe(0);
    expect(empty.totalDurationMinutes).toBe(0);
    expect(empty.dailyVelocity.length).toBe(7);
    expect(empty.dailyVelocity[0]).toHaveProperty('date');
    expect(empty.dailyVelocity[0]).toHaveProperty('count');
  });

  it('should compute production metrics from real records', () => {
    StorageService.addFinishedVideo({
      id: 'metric_seed_1',
      title: 'Seed Video',
      channel: 'Entrepreneurs Skool',
      status: 'Uploaded to Drive',
      thumbnailUrl: '/test.png',
      duration: '4:12',
      script: 'Seed script',
      tags: ['seed'],
      createdAt: new Date().toISOString()
    });
    const metrics = MetricsService.getMetrics();
    expect(metrics.totalProduced).toBeGreaterThan(0);
    expect(metrics.totalDurationMinutes).toBeGreaterThan(0);
    expect(metrics.dailyVelocity.length).toBe(7);
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
