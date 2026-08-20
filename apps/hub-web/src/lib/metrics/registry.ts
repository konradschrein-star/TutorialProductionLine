/**
 * Prometheus metrics registry
 *
 * Central registry for all application metrics exported via /api/metrics endpoint.
 *
 * Metrics Categories:
 * - Queue metrics (depth, processing time, failures)
 * - Render metrics (duration, success rate, active renders)
 * - API metrics (request count, response times, errors)
 * - System metrics (CPU, memory, active workers)
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a separate registry for this application
export const registry = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({
  register: registry,
  prefix: 'content_forge_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // Custom GC duration buckets
});

// ─── Queue Metrics ────────────────────────────────────────────────────────────

export const queueJobsWaiting = new Gauge({
  name: 'content_forge_queue_jobs_waiting',
  help: 'Number of jobs waiting in queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const queueJobsActive = new Gauge({
  name: 'content_forge_queue_jobs_active',
  help: 'Number of jobs currently being processed',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const queueJobsFailed = new Gauge({
  name: 'content_forge_queue_jobs_failed',
  help: 'Number of failed jobs in queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const queueJobsCompleted = new Counter({
  name: 'content_forge_queue_jobs_completed_total',
  help: 'Total number of completed jobs',
  labelNames: ['queue', 'status'] as const,
  registers: [registry],
});

export const queueJobDuration = new Histogram({
  name: 'content_forge_queue_job_duration_seconds',
  help: 'Job processing duration in seconds',
  labelNames: ['queue', 'status'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600], // 1s to 1h
  registers: [registry],
});

// ─── Render Metrics ───────────────────────────────────────────────────────────

export const renderDuration = new Histogram({
  name: 'content_forge_render_duration_seconds',
  help: 'Video render duration in seconds',
  labelNames: ['engine', 'format', 'status'] as const,
  buckets: [10, 30, 60, 120, 300, 600, 1200, 1800, 3600], // 10s to 1h
  registers: [registry],
});

export const renderTotal = new Counter({
  name: 'content_forge_render_total',
  help: 'Total number of render attempts',
  labelNames: ['engine', 'format', 'status'] as const,
  registers: [registry],
});

export const renderActive = new Gauge({
  name: 'content_forge_render_active',
  help: 'Number of renders currently in progress',
  labelNames: ['engine'] as const,
  registers: [registry],
});

export const renderMemoryUsage = new Gauge({
  name: 'content_forge_render_memory_bytes',
  help: 'Memory usage during render in bytes',
  labelNames: ['engine'] as const,
  registers: [registry],
});

// ─── API Metrics ──────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'content_forge_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'content_forge_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10], // 10ms to 10s
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'content_forge_http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [registry],
});

// ─── System Metrics ───────────────────────────────────────────────────────────

export const systemJobsTotal = new Gauge({
  name: 'content_forge_system_jobs_total',
  help: 'Total number of jobs in the system',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const systemWorkersActive = new Gauge({
  name: 'content_forge_system_workers_active',
  help: 'Number of active worker processes',
  labelNames: ['worker_type'] as const,
  registers: [registry],
});

export const systemDiskUsage = new Gauge({
  name: 'content_forge_system_disk_usage_bytes',
  help: 'Disk usage in bytes',
  labelNames: ['mount'] as const,
  registers: [registry],
});

export const systemDiskAvailable = new Gauge({
  name: 'content_forge_system_disk_available_bytes',
  help: 'Available disk space in bytes',
  labelNames: ['mount'] as const,
  registers: [registry],
});

// ─── AI Generation Metrics ────────────────────────────────────────────────────

export const aiGenerationDuration = new Histogram({
  name: 'content_forge_ai_generation_duration_seconds',
  help: 'AI generation operation duration in seconds',
  labelNames: ['operation', 'provider', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120], // 0.5s to 2m
  registers: [registry],
});

export const aiGenerationTotal = new Counter({
  name: 'content_forge_ai_generation_total',
  help: 'Total number of AI generation operations',
  labelNames: ['operation', 'provider', 'status'] as const,
  registers: [registry],
});

export const aiGenerationTokensUsed = new Counter({
  name: 'content_forge_ai_generation_tokens_total',
  help: 'Total number of AI tokens consumed',
  labelNames: ['provider', 'model'] as const,
  registers: [registry],
});

// ─── Database Metrics ─────────────────────────────────────────────────────────

export const dbQueryDuration = new Histogram({
  name: 'content_forge_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], // 1ms to 5s
  registers: [registry],
});

export const dbQueryTotal = new Counter({
  name: 'content_forge_db_query_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'status'] as const,
  registers: [registry],
});

// ─── Asset Metrics ────────────────────────────────────────────────────────────

export const assetStorageUsed = new Gauge({
  name: 'content_forge_asset_storage_bytes',
  help: 'Total storage used by assets in bytes',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const assetTotal = new Gauge({
  name: 'content_forge_asset_total',
  help: 'Total number of assets',
  labelNames: ['type', 'status'] as const,
  registers: [registry],
});
