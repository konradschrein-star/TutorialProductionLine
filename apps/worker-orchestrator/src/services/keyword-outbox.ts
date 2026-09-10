import { sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";

export async function deliverKeywordMilestone(db: DrizzleClient, options: { url: string; secret: string; fetch?: typeof fetch; jobId?: string }) {
  const url = new URL(options.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Keyword webhook requires HTTPS");
  if (url.username || url.password || !options.secret) throw new Error("Configure a separate authenticated Keyword webhook credential");
  const rows = await db.execute(sql`
    WITH candidate AS (
      SELECT o.id FROM tutorial_keyword_outbox o
      WHERE o.delivered_at IS NULL AND o.available_at <= now()
        AND (${options.jobId ?? null}::uuid IS NULL OR o.tutorial_job_id=${options.jobId ?? null}::uuid)
        AND (o.lease_until IS NULL OR o.lease_until < now())
        AND NOT EXISTS (SELECT 1 FROM tutorial_keyword_outbox prior WHERE prior.tutorial_job_id=o.tutorial_job_id AND prior.event_sequence<o.event_sequence AND prior.delivered_at IS NULL)
      ORDER BY o.id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE tutorial_keyword_outbox o SET lease_until=now()+interval '30 seconds', attempts=attempts+1
    FROM candidate WHERE o.id=candidate.id RETURNING o.id,o.payload,o.attempts
  `);
  const row = rows[0] as { id: string; payload: unknown; attempts: number } | undefined;
  if (!row) return { delivered: false, pending: false };
  try {
    const response = await (options.fetch ?? fetch)(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.secret}` }, body: JSON.stringify(row.payload), signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const receipt = await response.json().catch(() => null) as { verified?: boolean; reconciliationRequired?: boolean; forge_job_id?: unknown; keyword_ref?: unknown; event_sequence?: unknown; dedup_key?: unknown } | null;
    if (receipt?.verified !== true || receipt.reconciliationRequired) throw new Error("Receiver did not confirm a verified milestone");
    const sent = row.payload as { forge_job_id: string; keyword_ref: string; event_sequence: number; dedup_key: string };
    if (receipt.forge_job_id !== sent.forge_job_id || receipt.keyword_ref !== sent.keyword_ref || receipt.event_sequence !== sent.event_sequence || receipt.dedup_key !== sent.dedup_key) throw new Error("Receiver acknowledgement does not match the sent milestone");
    await db.execute(sql`UPDATE tutorial_keyword_outbox SET delivered_at=now(),lease_until=NULL,last_error=NULL WHERE id=${row.id} AND attempts=${row.attempts}`);
    return { delivered: true, pending: true };
  } catch {
    const delay = Math.min(3600, 5 * 2 ** Math.min(row.attempts, 10));
    await db.execute(sql`UPDATE tutorial_keyword_outbox SET lease_until=NULL, available_at=now()+${delay}*interval '1 second',last_error='Keyword Tool did not confirm delivery; retry scheduled' WHERE id=${row.id} AND attempts=${row.attempts}`);
    return { delivered: false, pending: true };
  }
}

export function startKeywordOutbox(db: DrizzleClient) {
  const url = process.env.KT_STATUS_WEBHOOK_URL; const secret = process.env.KT_WEBHOOK_SECRET;
  if (!url || !secret) return () => {};
  let busy = false; let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try { for (let count = 0; count < 10 && !stopped; count++) if (!(await deliverKeywordMilestone(db, { url, secret })).pending) break; }
    catch { console.warn("Keyword milestone delivery unavailable; durable pending events retained"); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 15_000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
