import { NextResponse } from 'next/server';
import { registry } from '@/lib/metrics/registry';

/**
 * GET /api/metrics
 *
 * Prometheus metrics endpoint.
 *
 * Returns all registered metrics in Prometheus text format.
 * This endpoint should be scraped by Prometheus server periodically (e.g., every 15s).
 *
 * Example Prometheus scrape config:
 * ```yaml
 * scrape_configs:
 *   - job_name: 'content-forge-hub'
 *     scrape_interval: 15s
 *     static_configs:
 *       - targets: ['localhost:3000']
 *     metrics_path: '/api/metrics'
 * ```
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    // Get metrics in Prometheus text format
    const metrics = await registry.metrics();

    return new NextResponse(metrics, {
      status: 200,
      headers: {
        'Content-Type': registry.contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error generating metrics:', error);

    return new NextResponse('Error generating metrics', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}
