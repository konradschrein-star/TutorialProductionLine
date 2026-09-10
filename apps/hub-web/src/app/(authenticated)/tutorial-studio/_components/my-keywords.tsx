"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { V2Button, GlassCard } from "../../_components";
import { keywordIsProduced } from "@/lib/keyword-tool/workflow";

/**
 * "My claimed keywords" — the VA's work queue, at the top of the Create form.
 *
 * The owner's read: "The Create tab is also outdated because it doesn't show
 * the claimed keywords. I want the keyword system to be more integrated with
 * the tutorial system, where the virtual assistants can, from his claimed
 * keywords, work faster through them, track them, know what he's worked
 * through."
 *
 * So this is deliberately a QUEUE and not a browser: it shows only what this VA
 * has claimed, marks the ones they have already made, and its primary action
 * fills the form below rather than opening another tool. Claiming and releasing
 * stay on the board (the Keywords tab) — that is where the competition for a
 * keyword is arbitrated, and duplicating it here would let two VAs claim the
 * same keyword from two different screens.
 *
 * Picking one binds the job to the keyword (`keyword_ref`), which is what makes
 * the board advance on its own: Content Forge fires a status webhook to the
 * Keyword Tool on every transition of a job that carries one.
 */

export interface MyKeyword {
  id: number;
  keyword: string;
  topic: string | null;
  status: string;
  lengthClass: string | null;
  durationSec: number | null;
  priorityScore: number | null;
  destination: string | null;
  note: string | null;
  referenceUrl: string | null;
  ktUrl: string;
  assignedChannelId?: string | null;
  job: { id: string; status: string; title: string } | null;
}

interface Response {
  integration?: "configured" | "disabled" | "unconfigured";
  ktUser: string;
  total: number;
  remaining: number;
  keywords: MyKeyword[];
}

interface Props {
  /** The keyword currently loaded into the form, if any. */
  selectedId: number | null;
  onPick: (keyword: MyKeyword) => void;
  onClear: () => void;
  /** Bumped by the parent after a job is created, to re-read "already made". */
  refreshToken: number;
  /**
   * Load the keyword AND queue it in one press, using whatever the form below
   * is already set to. Optional so the panel still renders anywhere that has
   * no form to submit.
   */
  onSendToProduction?: (keyword: MyKeyword) => void;
  /** Id currently being queued, so its button can show progress. */
  sending?: number | null;
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

const metadataChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "2px 7px",
  border: "1px solid var(--v2-border-1)",
  borderRadius: 6,
  color: "var(--v2-text-2)",
  fontSize: 10,
};

export function MyKeywords({
  selectedId,
  onPick,
  onClear,
  refreshToken,
  onSendToProduction,
  sending = null,
}: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/keywords/mine?includeDone=1");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Response);
      setError(null);
    } catch (err) {
      // Never render "you have no keywords" for a connection failure — a VA
      // would take that as "nothing to do today".
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (loading && !data) {
    return (
      <GlassCard style={{ padding: 16, fontSize: 12, opacity: 0.75 }}>
        Loading your claimed keywords…
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: "#f87171" }}>
          Could not load your claimed keywords: {error}
        </div>
        <div style={{ marginTop: 10 }}>
          <V2Button variant="outline" onClick={() => void load()}>
            Try again
          </V2Button>
        </div>
      </GlassCard>
    );
  }

  if (!data) return null;
  if (data.integration === "disabled" || data.integration === "unconfigured") {
    return (
      <GlassCard
        style={{ padding: 16, color: "var(--v2-text-2)", fontSize: 13 }}
      >
        {data.integration === "disabled"
          ? "Keyword Tool is switched off for this workspace."
          : "Keyword Tool has not been connected yet."}{" "}
        You can still prepare a tutorial below.
      </GlassCard>
    );
  }

  const visible = showDone
    ? data.keywords
    : data.keywords.filter((k) => !keywordIsProduced(k));

  return (
    <GlassCard style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--v2-text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Your claimed keywords
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {data.remaining} unfinished · {data.total - data.remaining} produced
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {data.total > data.remaining && (
            <V2Button
              variant={showDone ? "accent" : "outline"}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? "Hide finished" : "Show finished"}
            </V2Button>
          )}
          <V2Button variant="outline" onClick={() => void load()}>
            Refresh
          </V2Button>
        </div>
      </div>

      {data.total === 0 && (
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.6 }}>
          You have not claimed any keywords yet. Open the research board in the{" "}
          <a
            href="/tutorial-studio?tab=keywords"
            style={{ color: "var(--v2-accent)", fontWeight: 700 }}
          >
            Keywords tab
          </a>{" "}
          to claim work, or use Direct intake to create from an approved list.
        </div>
      )}

      {data.total > 0 && visible.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Every claimed keyword is complete. Claim more on the{" "}
          <a
            href="/tutorial-studio?tab=keywords"
            style={{ color: "var(--v2-accent)", fontWeight: 700 }}
          >
            research board
          </a>
          .
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((k) => {
          const done = keywordIsProduced(k);
          const bound = k.job !== null;
          const selected = selectedId === k.id;
          const duration = formatDuration(k.durationSec);
          return (
            <div
              key={k.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "9px 12px",
                borderRadius: 8,
                background: selected
                  ? "rgba(var(--v2-accent-rgb), 0.12)"
                  : "rgba(255,255,255,0.03)",
                border: selected
                  ? "1px solid var(--v2-accent)"
                  : "1px solid transparent",
                opacity: done ? 0.6 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{k.keyword}</div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 5,
                    marginTop: 6,
                  }}
                >
                  <span style={metadataChip}>
                    {k.topic ?? "Topic not classified"}
                  </span>
                  {k.lengthClass && (
                    <span style={metadataChip}>{k.lengthClass}</span>
                  )}
                  {duration && <span style={metadataChip}>{duration}</span>}
                  <span
                    style={metadataChip}
                    title={
                      k.priorityScore === null
                        ? "The research source did not provide a score."
                        : "Priority supplied by the Keyword Tool. This is not estimated search volume."
                    }
                  >
                    {k.priorityScore === null
                      ? "No research score"
                      : `Research priority ${k.priorityScore}`}
                  </span>
                  {k.destination && k.destination !== "TUTORIAL" && (
                    <span style={metadataChip}>Route: {k.destination}</span>
                  )}
                  {(bound || done) && (
                    <span style={metadataChip}>
                      {bound
                        ? `${done ? "Produced" : "In Studio"}: ${k.job!.status.replaceAll("_", " ").toLowerCase()}`
                        : "Produced"}
                    </span>
                  )}
                </div>
                {(k.referenceUrl || k.note) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 6,
                      fontSize: 11,
                      color: "var(--v2-text-2)",
                    }}
                  >
                    {k.referenceUrl && (
                      <a
                        href={k.referenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--v2-accent)" }}
                      >
                        Open source video
                      </a>
                    )}
                    {k.note && (
                      <span title={k.note}>Research note: {k.note}</span>
                    )}
                  </div>
                )}
              </div>
              <a
                href={k.ktUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-2)",
                  textDecoration: "underline",
                  whiteSpace: "nowrap",
                }}
              >
                on the board
              </a>
              {/*
                TWO buttons, because "load it into the form" and "make it" are
                different jobs and only the first existed. A VA who deleted a
                job in Studio came back here, found the keyword available
                again, and still had to press Use this, scroll the whole form
                and press Generate to re-send something the tool already knew
                everything about. The Keyword Tool board has a one-press
                Produce; this is the same thing on this side.
              */}
              {!done && !bound && !selected && onSendToProduction && (
                <V2Button
                  variant="outline"
                  disabled={sending === k.id}
                  onClick={() => onSendToProduction(k)}
                  title="Queue this keyword straight away, using the settings below"
                >
                  {sending === k.id ? "Sending…" : "Send to production"}
                </V2Button>
              )}
              {bound ? (
                <a
                  href={`/tutorial-studio?tab=${done ? "review" : "dashboard"}&jobId=${encodeURIComponent(k.job!.id)}`}
                  style={{
                    color: "var(--v2-accent)",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  Open tutorial
                </a>
              ) : selected ? (
                <V2Button variant="outline" onClick={onClear}>
                  Clear
                </V2Button>
              ) : (
                <V2Button
                  variant={done ? "outline" : "accent"}
                  disabled={done}
                  onClick={() => onPick(k)}
                >
                  {done ? "Made" : "Use this"}
                </V2Button>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
