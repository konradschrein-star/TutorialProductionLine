"use client";

import { useEffect, useState } from "react";

/**
 * TTS health badge for the Tutorial Studio header.
 *
 * Polls GET /api/health/tts on mount and every 5 minutes, rendering a coloured
 * status dot + latency/credit. Matches the PulseStatusBadge look.
 *
 * It used to poll AI33 and had therefore read "AI33 TTS · DOWN" in red,
 * permanently, since AI33 stopped being the TTS provider — an alarm about a
 * dependency the pipeline no longer has, displayed above a pipeline that was
 * working. It now reports the engine that actually speaks the scripts, which
 * the probe route names, so this component does not hard-code a vendor.
 */

type TtsStatus = "ok" | "degraded" | "down" | "loading";

interface HealthResponse {
  status: "ok" | "degraded" | "down";
  provider: string;
  latencyMs: number;
  credits: number | null;
  httpStatus: number;
  error?: string;
  checkedAt: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

const STYLE: Record<
  TtsStatus,
  { color: string; glow: string; label: string; pulse: boolean }
> = {
  ok: {
    color: "#23decb",
    glow: "rgba(35,222,203,0.5)",
    label: "OK",
    pulse: false,
  },
  degraded: {
    color: "#f97316",
    glow: "rgba(249,115,22,0.5)",
    label: "SLOW",
    pulse: true,
  },
  down: {
    color: "#ffb4ab",
    glow: "rgba(255,180,171,0.5)",
    label: "DOWN",
    pulse: true,
  },
  loading: {
    color: "#4b4455",
    glow: "rgba(75,68,85,0.4)",
    label: "CHECKING",
    pulse: false,
  },
};

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function TtsHealthBadge() {
  const [status, setStatus] = useState<TtsStatus>("loading");
  const [detail, setDetail] = useState<string>("");
  const [provider, setProvider] = useState("TTS");
  /**
   * Set when the probe is not ours to see — the badge then renders nothing.
   *
   * The read-only demo role is refused /api/health/tts in middleware, and it
   * should be: this badge names the TTS vendor and prints the remaining
   * ACCOUNT CREDIT IN DOLLARS, which is exactly the operational detail a
   * prospective buyer must not be shown. Rendering "DOWN" instead would be
   * both a lie and an odd first impression, so it disappears.
   */
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health/tts", { cache: "no-store" });

        // A NON-OK RESPONSE IS NOT A HEALTH READING. This used to go straight
        // to res.json() and trust whatever came back: a 401/403/500 carrying a
        // JSON error body parses fine, so `data.status` was undefined,
        // STYLE[undefined] was undefined, and the render threw
        // "Cannot read properties of undefined (reading 'pulse')" — taking the
        // whole Studio page down with it. The catch below never saw it,
        // because valid JSON is not a parse error.
        if (!res.ok) {
          if (cancelled) return;
          setUnavailable(res.status === 401 || res.status === 403);
          setStatus("down");
          setDetail(`probe ${res.status}`);
          return;
        }

        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        // Guard the key too: the style lookup must never be handed a value the
        // map has no entry for, whatever the route decides to send one day.
        setStatus(data.status in STYLE ? data.status : "down");
        if (data.provider) setProvider(data.provider);
        const parts = [fmtLatency(data.latencyMs)];
        if (typeof data.credits === "number") {
          // Fish denominates credit in dollars, so show it as money rather
          // than as an opaque "cr" count.
          parts.push(`$${data.credits.toFixed(2)}`);
        }
        setDetail(parts.join(" · "));
      } catch {
        if (cancelled) return;
        setStatus("down");
        setDetail("unreachable");
      }
    }

    void check();
    const id = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (unavailable) return null;

  // Belt and braces: even if some future path sets an unmapped status, the
  // badge degrades to "checking" instead of crashing the page it sits on.
  const s = STYLE[status] ?? STYLE.loading;

  return (
    <div
      className="flex items-center gap-1.5"
      title={`${provider} TTS health — polls every 5 min${detail ? `. ${detail}` : ""}`}
      style={{
        marginLeft: "auto",
        padding: "5px 11px",
        borderRadius: 9999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        alignSelf: "center",
      }}
    >
      <div
        className={s.pulse ? "animate-pulse" : ""}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: s.color,
          boxShadow: `0 0 6px ${s.glow}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: s.color,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {provider} · {s.label}
      </span>
      {detail && status !== "loading" && (
        <span
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
