"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import type {
  ChainView,
  ConsumerPriorityRow,
  ProviderRow,
} from "@/app/(authenticated)/system-health/_lib/registry-view";
import {
  COST_TIER_LABEL,
  STATUS_VISUALS,
  formatLatency,
  formatRelative,
} from "./status-visuals";
import { ProviderDetailModal } from "./provider-detail-modal";

/**
 * The whiteboard: every provider, every capability chain, and the controls to
 * change both. Read-only status was the old page's failure — seeing a problem
 * and being unable to act on it is the thing Konrad hates most, so every
 * switch on this page writes back.
 */

interface Props {
  providers: ProviderRow[];
  chains: ChainView[];
  consumerPriorities: ConsumerPriorityRow[];
  migrated: boolean;
}

async function postSettings(body: unknown): Promise<string | null> {
  const res = await fetch("/api/providers/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}

export function ProviderBoard({
  providers,
  chains,
  consumerPriorities,
  migrated,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Provider key whose full operations view is open (double-click). */
  const [detail, setDetail] = useState<string | null>(null);

  const mutate = useCallback(
    async (id: string, body: unknown) => {
      setBusy(id);
      setError(null);
      const err = await postSettings(body);
      setBusy(null);
      if (err) {
        setError(err);
        return;
      }
      startTransition(() => router.refresh());
    },
    [router],
  );

  const probeAll = useCallback(async () => {
    setProbing(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/probe", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        note?: string;
      };
      if (!res.ok) setError(data.error ?? `Probe failed (${res.status})`);
      else if (data.note) setError(data.note);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  }, [router]);

  const sorted = useMemo(
    () =>
      [...providers].sort(
        (a, b) =>
          STATUS_VISUALS[a.status].severity - STATUS_VISUALS[b.status].severity,
      ),
    [providers],
  );

  const neverProbed = providers.filter(
    (p) => p.lastCheckedAt === null && p.status === "unknown",
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Action bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Providers
          </p>
          <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
            {providers.length} known
            {neverProbed > 0 && ` · ${neverProbed} never probed`}
            {" · double-click a card for its operations view"}
          </span>
        </div>
        <button
          type="button"
          onClick={probeAll}
          disabled={probing}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            fontSize: 11,
            fontWeight: 700,
            color: probing ? "rgba(205,195,215,0.5)" : "var(--v2-accent)",
            background: "rgba(var(--v2-accent-rgb), 0.1)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
            borderRadius: 8,
            cursor: probing ? "wait" : "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {probing ? "hourglass_top" : "network_ping"}
          </span>
          {probing ? "Probing…" : "Probe all now"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            fontSize: 11,
            color: "#ffb4ab",
            background: "rgba(255,180,171,0.08)",
            border: "1px solid rgba(255,180,171,0.25)",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Provider grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 14,
          opacity: pending ? 0.6 : 1,
        }}
      >
        {sorted.map((p) => {
          const v = STATUS_VISUALS[p.status];
          const isOpen = expanded === p.key;
          return (
            // GlassCard takes no event props (it is shared), so the
            // double-click target is this wrapper. Kept as a plain div rather
            // than a button because the card already contains real controls —
            // nesting interactive elements would break them.
            <div
              key={p.key}
              onDoubleClick={() => setDetail(p.key)}
              title={`Double-click for ${p.displayName} operations`}
              style={{ display: "flex", cursor: "context-menu" }}
            >
              <GlassCard
                style={{
                  flex: 1,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  border: `1px solid ${v.border}`,
                  background: p.deprecated
                    ? "rgba(255,255,255,0.015)"
                    : undefined,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: "#e5e2e1",
                        }}
                      >
                        {p.displayName}
                      </span>
                      {p.deprecated && (
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 700,
                            color: "#9aa0a6",
                            padding: "1px 5px",
                            background: "rgba(154,160,166,0.12)",
                            borderRadius: 3,
                            textTransform: "uppercase",
                          }}
                        >
                          dead code
                        </span>
                      )}
                    </div>
                    <span
                      style={{ fontSize: 10, color: "rgba(205,195,215,0.45)" }}
                    >
                      {p.vendor} · {p.capabilities.join(", ")}
                    </span>
                  </div>
                  <span
                    title={v.hint}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                      color: v.color,
                      background: v.background,
                      border: `1px solid ${v.border}`,
                      padding: "3px 8px",
                      borderRadius: 12,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13 }}
                    >
                      {v.icon}
                    </span>
                    {v.label}
                  </span>
                </div>

                {/* Why unknown / why expired — the honest part */}
                {p.status === "unknown" && p.unknownReason && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "rgba(205,195,215,0.55)",
                      margin: 0,
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}
                  >
                    Not probed: {p.unknownReason}
                  </p>
                )}
                {p.status === "expired" && p.planNote && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "#f97316",
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {p.planNote}
                  </p>
                )}
                {/* Expiry clocks (Phase C / C1): subscriptions, api keys, cookie
                  files, credit balances. A provider can carry several. */}
                {p.expiries.length > 0 &&
                  p.expiries.map((clock, ci) => {
                    const tone =
                      clock.status === "expired"
                        ? "#ffb4ab"
                        : clock.status === "expiring_soon"
                          ? "#f5c26b"
                          : clock.status === "unknown"
                            ? "rgba(205,195,215,0.55)"
                            : "#23decb";
                    const when =
                      clock.expiresAt != null
                        ? new Date(clock.expiresAt).toISOString().slice(0, 10)
                        : "date unknown — supply it";
                    return (
                      <p
                        key={`exp-${ci}`}
                        style={{
                          fontSize: 10,
                          color: tone,
                          margin: 0,
                          lineHeight: 1.5,
                        }}
                      >
                        {clock.status === "expired"
                          ? "⛔"
                          : clock.status === "expiring_soon"
                            ? "⚠️"
                            : clock.status === "unknown"
                              ? "❔"
                              : "🕑"}{" "}
                        {clock.label}: {clock.status.replace("_", " ")} ({when})
                        {clock.source === "manual" ? " · from operator" : ""}
                      </p>
                    );
                  })}
                {p.status === "up" && p.probeMeaning && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "rgba(205,195,215,0.45)",
                      margin: 0,
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}
                  >
                    {p.probeMeaning}
                  </p>
                )}
                {p.status === "down" && p.probeError && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "#ffb4ab",
                      margin: 0,
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                  >
                    {p.probeError}
                  </p>
                )}

                {/* Fact row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: "6px 12px",
                    fontSize: 10,
                    color: "rgba(205,195,215,0.6)",
                  }}
                >
                  <Fact
                    label="Key"
                    value={
                      p.keyStatus === "present"
                        ? `${p.keyEnvVar} set`
                        : p.keyStatus === "missing"
                          ? `${p.keyEnvVar} MISSING`
                          : p.keyStatus === "per-user"
                            ? "per-user (encrypted)"
                            : "none needed"
                    }
                    danger={p.keyStatus === "missing"}
                  />
                  <Fact label="Latency" value={formatLatency(p.latencyMs)} />
                  <Fact
                    label="Checked"
                    value={formatRelative(p.lastCheckedAt)}
                    danger={p.lastCheckedAt === null}
                  />
                  <Fact
                    label="Cost"
                    value={COST_TIER_LABEL[p.costTier] ?? p.costTier}
                  />
                  <Fact
                    label="Calls 24h"
                    value={
                      p.callsLast24h === null
                        ? "not tracked yet"
                        : String(p.callsLast24h)
                    }
                  />
                  <Fact
                    label="Plan"
                    value={
                      p.planExpiresAt
                        ? `${p.planState} → ${p.planExpiresAt}`
                        : p.planState
                    }
                    danger={p.planState === "expired"}
                  />
                </div>

                {p.probeDetail && Object.keys(p.probeDetail).length > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--v2-accent)",
                      background: "rgba(var(--v2-accent-rgb), 0.07)",
                      padding: "5px 9px",
                      borderRadius: 6,
                    }}
                  >
                    {Object.entries(p.probeDetail)
                      .map(([k, val]) => `${k}: ${String(val)}`)
                      .join(" · ")}
                  </div>
                )}

                {/* Controls */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
                    flexWrap: "wrap",
                  }}
                >
                  <Toggle
                    on={p.enabled}
                    disabled={!migrated || busy === `enabled:${p.key}`}
                    label={p.enabled ? "Enabled" : "Disabled"}
                    onClick={() =>
                      void mutate(`enabled:${p.key}`, {
                        action: "provider-enabled",
                        key: p.key,
                        enabled: !p.enabled,
                      })
                    }
                  />
                  <ConcurrencyControl
                    value={p.concurrencyCap}
                    source={p.concurrencySource}
                    disabled={!migrated}
                    onChange={(next) =>
                      void mutate(`cap:${p.key}`, {
                        action: "provider-concurrency",
                        key: p.key,
                        maxConcurrent: next,
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : p.key)}
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "rgba(205,195,215,0.6)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {isOpen ? "less" : "details"}
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                </div>

                {isOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
                      fontSize: 10,
                      color: "rgba(205,195,215,0.6)",
                      lineHeight: 1.6,
                    }}
                  >
                    <p style={{ margin: 0 }}>{p.description}</p>
                    {p.deprecationNote && (
                      <p style={{ margin: 0, color: "#f5c26b" }}>
                        {p.deprecationNote}
                      </p>
                    )}
                    {p.baseUrl && (
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                        }}
                      >
                        {p.baseUrl}
                      </p>
                    )}
                    {p.hostProcess && (
                      <p style={{ margin: 0 }}>Runs as: {p.hostProcess}</p>
                    )}
                    <div>
                      <span style={{ color: "rgba(205,195,215,0.4)" }}>
                        Called from:
                      </span>
                      <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                        {p.usedBy.map((u) => (
                          <li key={u} style={{ fontFamily: "monospace" }}>
                            {u}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </GlassCard>
            </div>
          );
        })}
      </div>

      {/* Capability chains */}
      <div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e5e2e1",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: "0 0 6px 0",
          }}
        >
          Capability chains
        </p>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "0 0 16px 0",
          }}
        >
          Left to right: primary first, then fallbacks. A fallback is used only
          if its link is switched on — switching one on is how you deliberately
          permit a substitution.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {chains.map((chain) => (
            <GlassCard key={chain.capability} style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#e5e2e1",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {chain.capability}
                </span>
                {chain.primary === null && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#ffb4ab",
                      background: "rgba(255,180,171,0.1)",
                      border: "1px solid rgba(255,180,171,0.3)",
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}
                  >
                    NO ELIGIBLE PROVIDER — this capability cannot run
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {chain.entries.map((entry, i) => {
                  const v = STATUS_VISUALS[entry.status];
                  const isPrimary = entry.providerKey === chain.primary;
                  return (
                    <div
                      key={entry.providerKey}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 170,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: isPrimary
                            ? "1px solid rgba(35,222,203,0.45)"
                            : `1px solid ${entry.eligible ? v.border : "rgba(139,139,139,0.25)"}`,
                          background: isPrimary
                            ? "rgba(35,222,203,0.07)"
                            : entry.eligible
                              ? "rgba(255,255,255,0.03)"
                              : "rgba(255,255,255,0.012)",
                          opacity: entry.eligible ? 1 : 0.65,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: entry.eligible ? "#e5e2e1" : "#8b8b8b",
                            }}
                          >
                            {entry.displayName}
                          </span>
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 800,
                              color: v.color,
                            }}
                          >
                            {v.label}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              color: isPrimary
                                ? "#23decb"
                                : "rgba(205,195,215,0.45)",
                              fontWeight: isPrimary ? 700 : 400,
                            }}
                          >
                            {isPrimary
                              ? "PRIMARY"
                              : `fallback #${entry.position - 1}`}
                          </span>
                          <Toggle
                            small
                            on={entry.linkEnabled}
                            disabled={
                              !migrated ||
                              busy ===
                                `link:${chain.capability}:${entry.providerKey}`
                            }
                            label={entry.linkEnabled ? "on" : "off"}
                            onClick={() =>
                              void mutate(
                                `link:${chain.capability}:${entry.providerKey}`,
                                {
                                  action: "link-enabled",
                                  capability: chain.capability,
                                  providerKey: entry.providerKey,
                                  consumer: null,
                                  enabled: !entry.linkEnabled,
                                },
                              )
                            }
                          />
                        </div>

                        {!entry.eligible && entry.ineligibleReason && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "rgba(205,195,215,0.45)",
                              fontStyle: "italic",
                            }}
                          >
                            {entry.ineligibleReason}
                          </span>
                        )}
                        {entry.note && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "#f5c26b",
                              lineHeight: 1.4,
                            }}
                          >
                            {entry.note}
                          </span>
                        )}
                      </div>
                      {i < chain.entries.length - 1 && (
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 18,
                            color: "rgba(205,195,215,0.25)",
                          }}
                        >
                          arrow_forward
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Priorities */}
      <div>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e5e2e1",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: "0 0 6px 0",
          }}
        >
          Consumer priority
        </p>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "0 0 16px 0",
          }}
        >
          Higher wins the next free slot out of the shared pool. Formats do not
          get their own capacity — they queue against one global cap per
          provider, in this order.
        </p>
        <GlassCard style={{ padding: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {consumerPriorities.map((c) => (
              <PriorityRow
                key={c.consumer}
                row={c}
                disabled={!migrated}
                busy={busy === `prio:${c.consumer}`}
                onChange={(priority) =>
                  void mutate(`prio:${c.consumer}`, {
                    action: "consumer-priority",
                    consumer: c.consumer,
                    capability: null,
                    priority,
                  })
                }
              />
            ))}
          </div>
        </GlassCard>
      </div>

      {detail && (
        <ProviderDetailModal
          providerKey={detail}
          displayName={
            providers.find((p) => p.key === detail)?.displayName ?? detail
          }
          status={providers.find((p) => p.key === detail)?.status ?? "unknown"}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Fact({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        style={{
          fontSize: 8,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "rgba(205,195,215,0.35)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: danger ? "#f5c26b" : "#cdc3d7",
          fontWeight: danger ? 700 : 400,
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Toggle({
  on,
  label,
  onClick,
  disabled,
  small,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: small ? "2px 6px" : "4px 10px",
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        color: on ? "#23decb" : "#8b8b8b",
        background: on ? "rgba(35,222,203,0.1)" : "rgba(139,139,139,0.1)",
        border: `1px solid ${on ? "rgba(35,222,203,0.3)" : "rgba(139,139,139,0.25)"}`,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: small ? 12 : 14 }}
      >
        {on ? "toggle_on" : "toggle_off"}
      </span>
      {label}
    </button>
  );
}

function ConcurrencyControl({
  value,
  source,
  onChange,
  disabled,
}: {
  value: number | null;
  source: "operator" | "catalog" | "uncapped";
  onChange: (next: number | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string>(
    value == null ? "" : String(value),
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 14, color: "rgba(205,195,215,0.5)" }}
        title={`Concurrency cap (${source})`}
      >
        speed
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const next = draft.trim() === "" ? null : Number(draft);
          if (next !== value) onChange(next);
        }}
        placeholder="∞"
        disabled={disabled}
        style={{
          width: 42,
          padding: "3px 6px",
          fontSize: 10,
          color: "#e5e2e1",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
          borderRadius: 5,
          textAlign: "center",
        }}
      />
      <span style={{ fontSize: 9, color: "rgba(205,195,215,0.35)" }}>
        {source === "operator" ? "set" : source === "catalog" ? "default" : ""}
      </span>
    </div>
  );
}

function PriorityRow({
  row,
  onChange,
  disabled,
  busy,
}: {
  row: ConsumerPriorityRow;
  onChange: (priority: number) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(String(row.priority));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "7px 10px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 7,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "#cdc3d7",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.consumer}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {row.isOverride && (
          <span
            style={{ fontSize: 8, color: "var(--v2-accent)" }}
            title="Overridden from the built-in default"
          >
            set
          </span>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => {
            const next = Number(draft);
            if (Number.isInteger(next) && next !== row.priority) onChange(next);
          }}
          disabled={disabled}
          style={{
            width: 46,
            padding: "3px 6px",
            fontSize: 10,
            fontWeight: 700,
            color: "#e5e2e1",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
            borderRadius: 5,
            textAlign: "center",
          }}
        />
      </div>
    </div>
  );
}
