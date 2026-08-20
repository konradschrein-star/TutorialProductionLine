import type { NextRequest } from "next/server";
import os from "node:os";
import { statfs } from "node:fs/promises";
import {
  createCfClipDetectionQueue,
  createCfFinishingRenderQueue,
  createCfIngestQueue,
  createCfRawRenderQueue,
  createRedisConnection,
} from "@repo/queue";
import { withApiAuth } from "../../_lib/auth";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/system
 *
 * Lightweight system + queue snapshot for the source-detail footer chip.
 * Polled every 5 s, so this stays cheap: only OS stats + four BullMQ
 * `getJobCounts` calls (each a single Redis round-trip).
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const cpu = await sampleCpuPercent();
    const mem = readMemoryPercent();
    const disk = await readDiskFreeGb();

    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    let queues: Record<string, { waiting: number; active: number }> = {};
    try {
      const [ingest, detection, raw, finishing] = await Promise.all([
        createCfIngestQueue(conn),
        createCfClipDetectionQueue(conn),
        createCfRawRenderQueue(conn),
        createCfFinishingRenderQueue(conn),
      ]);
      const counts = await Promise.all([
        ingest.getJobCounts("waiting", "active"),
        detection.getJobCounts("waiting", "active"),
        raw.getJobCounts("waiting", "active"),
        finishing.getJobCounts("waiting", "active"),
      ]);
      queues = {
        ingest: { waiting: counts[0].waiting, active: counts[0].active },
        clip_detection: {
          waiting: counts[1].waiting,
          active: counts[1].active,
        },
        raw_render: { waiting: counts[2].waiting, active: counts[2].active },
        finishing_render: {
          waiting: counts[3].waiting,
          active: counts[3].active,
        },
      };
      await Promise.all([
        ingest.close(),
        detection.close(),
        raw.close(),
        finishing.close(),
      ]);
    } finally {
      await conn.quit().catch(() => {});
    }

    return {
      cpu_pct: cpu,
      mem_pct: mem,
      disk_gb_free: disk,
      load_avg_1m: os.loadavg()[0],
      cpu_cores: os.cpus().length,
      queues,
    };
  });
}

/**
 * Coarse CPU percent over a ~250ms window. Reads os.cpus() twice and diffs
 * the idle vs busy ticks. Good enough for a header chip, far cheaper than
 * pulling /proc/stat or installing systeminformation.
 */
async function sampleCpuPercent(): Promise<number> {
  const a = aggregateCpu();
  await new Promise((r) => setTimeout(r, 250));
  const b = aggregateCpu();
  const total = b.total - a.total;
  const idle = b.idle - a.idle;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

function aggregateCpu(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function readMemoryPercent(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total === 0) return 0;
  return Math.round(((total - free) / total) * 100);
}

async function readDiskFreeGb(): Promise<number> {
  try {
    // Sample the media root (where source.mp4 + clips land). On the VPS
    // that's /opt/content-forge/media, but the hub may be deployed
    // elsewhere — fall back to '/' if not configured.
    const root = process.env["LOCAL_MEDIA_ROOT"] ?? "/";
    const s = await statfs(root);
    const free = s.bsize * s.bfree;
    return Math.round((free / 1024 / 1024 / 1024) * 10) / 10;
  } catch {
    return -1;
  }
}
