/**
 * Compute-node registry (migration 0044) — §2.5 compute topology.
 *
 * Konrad's desktop, laptop, the VPS, and the QEMU VMs modelled as toggleable
 * render / GPU nodes. The ONE control he asked for is `enabled` — flip it and
 * the node's agent stops accepting new work and drains.
 *
 * SECURITY GATE (VPS compromise, plan §0): building this registry is safe, but
 * NO home node may be tunnelled to the VPS (WireGuard / pull-agent) until the
 * box is confirmed clean and every key rotated. `enabled` therefore defaults to
 * FALSE — a node does nothing until an operator deliberately turns it on AND
 * the security remediation is done. Do not add automatic activation here.
 *
 * Status is DERIVED from `last_heartbeat_at`, never stored:
 *   online   heartbeat < 90 s        stale   < 10 min
 *   offline  older / never           disabled enabled = false
 *   draining drain_requested_at set
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const computeNodes = pgTable(
  "compute_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    /** vps | desktop | laptop | vm | gpu_box */
    kind: text("kind").notNull(),
    /** Operator toggle. Defaults FALSE — gated on VPS remediation (§0). */
    enabled: boolean("enabled").notNull().default(false),
    /** render.ffmpeg | render.remotion | whisper | llm.lmstudio | image.local */
    capabilities: text("capabilities").array().notNull().default([]),
    /** Per-capability { max_concurrent } map. */
    capacity: jsonb("capacity").$type<Record<string, unknown>>(),
    /** { cpu_pct, mem_gb, quiet_hours } — the load budget for this node. */
    budget: jsonb("budget").$type<Record<string, unknown>>(),
    last_heartbeat_at: timestamp("last_heartbeat_at", { withTimezone: true }),
    agent_version: text("agent_version"),
    os: text("os"),
    cpu_model: text("cpu_model"),
    cpu_cores: integer("cpu_cores"),
    gpu_model: text("gpu_model"),
    vram_gb: integer("vram_gb"),
    /** Set to request a graceful drain (finish current work, accept no new). */
    drain_requested_at: timestamp("drain_requested_at", { withTimezone: true }),
    note: text("note"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    enabledIdx: index("idx_compute_nodes_enabled").on(t.enabled),
    heartbeatIdx: index("idx_compute_nodes_heartbeat").on(t.last_heartbeat_at),
  }),
);

/** Heartbeat history — live CPU/RAM/GPU/queue-depth samples per node. */
export const computeNodeHeartbeats = pgTable(
  "compute_node_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    node_id: uuid("node_id").notNull(),
    cpu_pct: integer("cpu_pct"),
    mem_gb: integer("mem_gb"),
    gpu_pct: integer("gpu_pct"),
    queue_depth: integer("queue_depth"),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    reported_at: timestamp("reported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nodeTimeIdx: index("idx_compute_node_heartbeats_node_time").on(
      t.node_id,
      t.reported_at,
    ),
  }),
);

export type ComputeNodeRow = typeof computeNodes.$inferSelect;
export type NewComputeNodeRow = typeof computeNodes.$inferInsert;
export type ComputeNodeHeartbeatRow = typeof computeNodeHeartbeats.$inferSelect;
export type NewComputeNodeHeartbeatRow =
  typeof computeNodeHeartbeats.$inferInsert;
