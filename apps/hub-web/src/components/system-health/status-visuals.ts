import type { ProviderStatus } from "@repo/provider-registry";

/**
 * One place that decides what each status LOOKS like.
 *
 * "unknown" is deliberately grey and labelled "NOT PROBED" — not green, not
 * amber. The page must never imply we know something we do not.
 * "expired" gets its own colour and word, distinct from "down": fastgen is
 * not unreachable, it is out of licence, and those need different responses.
 */

export interface StatusVisual {
  label: string;
  color: string;
  background: string;
  border: string;
  icon: string;
  /** Sort weight — worst first, so problems float to the top of a list. */
  severity: number;
  hint: string;
}

export const STATUS_VISUALS: Record<ProviderStatus, StatusVisual> = {
  down: {
    label: "DOWN",
    color: "#ffb4ab",
    background: "rgba(255,180,171,0.10)",
    border: "rgba(255,180,171,0.30)",
    icon: "cancel",
    severity: 0,
    hint: "The last probe failed — unreachable, timed out, or rejected.",
  },
  expired: {
    label: "EXPIRED",
    color: "#f97316",
    background: "rgba(249,115,22,0.10)",
    border: "rgba(249,115,22,0.30)",
    icon: "event_busy",
    severity: 1,
    hint: "Plan or licence is over. Not probed — it may still answer, and must still not be used.",
  },
  no_key: {
    label: "NO KEY",
    color: "#f5c26b",
    background: "rgba(245,194,107,0.10)",
    border: "rgba(245,194,107,0.30)",
    icon: "key_off",
    severity: 2,
    hint: "The credential env var is not set on this host.",
  },
  degraded: {
    label: "SLOW",
    color: "#f5c26b",
    background: "rgba(245,194,107,0.10)",
    border: "rgba(245,194,107,0.28)",
    icon: "warning",
    severity: 3,
    hint: "Reachable, but responding slower than its threshold.",
  },
  disabled: {
    label: "OFF",
    color: "#8b8b8b",
    background: "rgba(139,139,139,0.10)",
    border: "rgba(139,139,139,0.28)",
    icon: "toggle_off",
    severity: 4,
    hint: "Switched off by an operator. Never dispatched to.",
  },
  unknown: {
    label: "NOT PROBED",
    color: "#9aa0a6",
    background: "rgba(154,160,166,0.08)",
    border: "rgba(154,160,166,0.24)",
    icon: "help",
    severity: 5,
    hint: "No safe probe exists, or it has never been probed. This is honestly unknown — not healthy.",
  },
  up: {
    label: "UP",
    color: "#23decb",
    background: "rgba(35,222,203,0.10)",
    border: "rgba(35,222,203,0.28)",
    icon: "check_circle",
    severity: 6,
    hint: "Last probe succeeded.",
  },
};

export const COST_TIER_LABEL: Record<string, string> = {
  free: "free",
  cheap: "€",
  standard: "€€",
  premium: "€€€",
  unknown: "cost unknown",
};

export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatTimestamp(value: string | Date): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}
