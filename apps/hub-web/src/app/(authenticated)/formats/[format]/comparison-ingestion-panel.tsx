"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { createJob } from "@/app/actions/jobs";
import { deleteJob } from "@/app/actions/jobs";
import { V2Select } from "@/components/ui/v2-select";
import type { RecentJob } from "@/components/formats/recent-jobs-poller";

// Status → pipeline progress %
const PIPELINE_PROGRESS: Record<string, number> = {
  IDEA_GENERATION: 5,
  SCRIPTING: 10,
  AWAITING_RESEARCH: 12,
  ASSET_COLLECTION: 20,
  AWAITING_PRODUCTION_VA: 30,
  AWAITING_IMAGE_QC: 40,
  QMS_VALIDATING: 50,
  ROUTING_RENDER: 55,
  RENDERING_FFMPEG: 65,
  RENDERING_REMOTION: 65,
  AWAITING_QC: 80,
  AWAITING_UPLOADER: 88,
  UPLOADING: 94,
  PUBLISHED: 100,
};

const STATUS_LABELS: Record<string, string> = {
  IDEA_GENERATION: "Queued",
  SCRIPTING: "Scripting",
  AWAITING_RESEARCH: "Awaiting Research",
  RESEARCH_UPLOADED: "Research Uploaded",
  ASSET_COLLECTION: "Collecting Assets",
  AWAITING_PRODUCTION_VA: "VA Review",
  QMS_VALIDATING: "Validating",
  ROUTING_RENDER: "Routing",
  RENDERING_REMOTION: "Rendering",
  RENDERING_FFMPEG: "Rendering",
  AWAITING_QC: "QC Review",
  AWAITING_UPLOADER: "Ready to Upload",
  UPLOADING: "Uploading",
  PUBLISHED: "Published",
  FAILED_RENDER: "Failed",
  FAILED_QMS: "Failed QMS",
  FAILED_GENERAL: "Failed",
  PAUSED: "Paused",
};

const TERMINAL = new Set([
  "PUBLISHED",
  "CANCELLED",
  "DELETED",
  "FAILED_QMS",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
  "MARKED_FOR_DELETION",
]);
const FAILED = new Set([
  "FAILED_QMS",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
]);

type Subformat = "TECH_SOFTWARE" | "TECH_HARDWARE" | "TECH_SAAS";

const SUBFORMATS: {
  value: Subformat;
  label: string;
  icon: string;
  hint: string;
}[] = [
  {
    value: "TECH_SOFTWARE",
    label: "Software",
    icon: "deployed_code",
    hint: "Apps, CLI tools, dev platforms",
  },
  {
    value: "TECH_HARDWARE",
    label: "Hardware",
    icon: "memory",
    hint: "Devices, components, peripherals",
  },
  {
    value: "TECH_SAAS",
    label: "SaaS",
    icon: "cloud",
    hint: "Cloud services, APIs, subscriptions",
  },
];

const PIPELINE_STEPS_RESEARCH = [
  {
    icon: "psychology",
    label: "Research prompts",
    detail: "AI generates targeted research questions (~5s)",
  },
  {
    icon: "upload_file",
    label: "VA researches",
    detail: "You upload findings from Perplexity or similar",
  },
  {
    icon: "edit_note",
    label: "AI scripts",
    detail: "Claude writes the comparison script from research",
  },
  {
    icon: "movie",
    label: "Renders",
    detail: "Remotion builds the final video",
  },
];

const PIPELINE_STEPS_AUTO = [
  {
    icon: "edit_note",
    label: "AI scripts",
    detail: "Claude writes the comparison script from its own knowledge",
  },
  {
    icon: "movie",
    label: "Renders",
    detail: "Remotion builds the final video",
  },
];

interface ComparisonIngestionPanelProps {
  format: string;
  templates: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string; language: string }>;
  recentJobs: RecentJob[];
}

export function ComparisonIngestionPanel({
  format,
  templates,
  channels,
  recentJobs: initialJobs,
}: ComparisonIngestionPanelProps) {
  const [productA, setProductA] = useState("");
  const [productB, setProductB] = useState("");
  const [subformat, setSubformat] = useState<Subformat>("TECH_SOFTWARE");
  // Research is optional. Default to skipping it — the script writer works from
  // its own knowledge, no VA/Perplexity step. Toggle off to run the research
  // gate (generate prompts → VA pastes findings → script from research).
  const [skipResearch, setSkipResearch] = useState(true);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [jobs, setJobs] = useState<RecentJob[]>(initialJobs);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/jobs/recent?format=${encodeURIComponent(format)}&limit=20`,
        { credentials: "same-origin" },
      );
      if (res.ok) setJobs(await res.json());
    } catch {
      /* keep stale */
    }
  }, [format]);

  useEffect(() => {
    function schedule() {
      timerRef.current = setTimeout(async () => {
        await fetchJobs();
        schedule();
      }, 5000);
    }
    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchJobs]);

  async function handleDeleteJob(job: RecentJob) {
    if (!confirm(`Delete "${job.title || "this job"}"?`)) return;
    setDeletingId(job.id);
    const result = await deleteJob(job.id);
    if (result.success) setJobs((prev) => prev.filter((j) => j.id !== job.id));
    else toast.error(result.error ?? "Failed to delete");
    setDeletingId(null);
  }

  const pipelineSteps = skipResearch
    ? PIPELINE_STEPS_AUTO
    : PIPELINE_STEPS_RESEARCH;
  const selectedChannel = channels.find((c) => c.id === channelId);
  const canSubmit =
    productA.trim().length > 0 &&
    productB.trim().length > 0 &&
    channelId &&
    templateId &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const result = await createJob({
        channel_id: channelId,
        template_id: templateId,
        format,
        production_version: "V3",
        initial_topic: `${productA.trim()} vs ${productB.trim()}`,
        language: selectedChannel?.language ?? "en",
        skip_research: skipResearch,
        metadata: {
          comparison: {
            product_a_name: productA.trim(),
            product_b_name: productB.trim(),
            subformat,
          },
        },
      });

      if (result.success) {
        setSessionCount((n) => n + 1);
        toast.success(`${productA.trim()} vs ${productB.trim()}`, {
          description: skipResearch
            ? "Queued — auto-scripting from AI knowledge (research skipped)"
            : "Queued — AI is generating research prompts",
          action: {
            label: "View Jobs",
            onClick: () => {
              window.location.href = "/jobs";
            },
          },
        });
        setProductA("");
        setProductB("");
      } else {
        toast.error("Failed to queue", {
          description: result.error ?? "Unknown error",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Creation panel */}
      <form onSubmit={handleSubmit}>
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {/* Header row */}
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "rgba(205,195,215,0.45)",
                textTransform: "uppercase",
              }}
            >
              New Comparison
            </span>
            {sessionCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--v2-accent)",
                  fontWeight: 600,
                }}
              >
                {sessionCount} queued this session
              </span>
            )}
          </div>

          {/* VS arena */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 56px 1fr",
              gap: 0,
            }}
          >
            {/* Product A */}
            <div
              style={{
                padding: "20px 20px 20px 20px",
                borderRight: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(255,120,100,0.7)",
                  marginBottom: 8,
                }}
              >
                Product A
              </label>
              <input
                type="text"
                value={productA}
                onChange={(e) => setProductA(e.target.value)}
                placeholder="e.g. Notion"
                autoFocus
                style={{
                  width: "100%",
                  background: "rgba(255,107,107,0.04)",
                  border: productA
                    ? "1px solid rgba(255,107,107,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                  padding: "11px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#e5e2e1",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,107,107,0.5)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = productA
                    ? "rgba(255,107,107,0.3)"
                    : "rgba(255,255,255,0.08)";
                }}
              />
            </div>

            {/* VS divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRight: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(170,255,0,0.02)",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  letterSpacing: "0.05em",
                  color: "var(--v2-accent)",
                  opacity: productA && productB ? 1 : 0.3,
                  transition: "opacity 0.2s ease",
                }}
              >
                VS
              </span>
            </div>

            {/* Product B */}
            <div style={{ padding: "20px 20px 20px 20px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(72,219,251,0.7)",
                  marginBottom: 8,
                }}
              >
                Product B
              </label>
              <input
                type="text"
                value={productB}
                onChange={(e) => setProductB(e.target.value)}
                placeholder="e.g. Obsidian"
                style={{
                  width: "100%",
                  background: "rgba(72,219,251,0.04)",
                  border: productB
                    ? "1px solid rgba(72,219,251,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                  padding: "11px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#e5e2e1",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(72,219,251,0.5)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = productB
                    ? "rgba(72,219,251,0.3)"
                    : "rgba(255,255,255,0.08)";
                }}
              />
            </div>
          </div>

          {/* Subformat + selectors */}
          <div
            style={{
              padding: "16px 20px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Subformat pills */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(205,195,215,0.4)",
                }}
              >
                Category
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {SUBFORMATS.map((sf) => {
                  const active = subformat === sf.value;
                  return (
                    <button
                      key={sf.value}
                      type="button"
                      onClick={() => setSubformat(sf.value)}
                      title={sf.hint}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "7px 12px",
                        borderRadius: 7,
                        border: active
                          ? "1px solid rgba(170,255,0,0.4)"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: active
                          ? "rgba(170,255,0,0.08)"
                          : "transparent",
                        color: active
                          ? "var(--v2-accent)"
                          : "rgba(205,195,215,0.5)",
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        {sf.icon}
                      </span>
                      {sf.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Channel + Template */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgba(205,195,215,0.4)",
                  }}
                >
                  Channel
                </span>
                <V2Select
                  value={channelId}
                  onChange={setChannelId}
                  options={channels.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  placeholder="Select channel"
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgba(205,195,215,0.4)",
                  }}
                >
                  Template
                </span>
                <V2Select
                  value={templateId}
                  onChange={setTemplateId}
                  options={
                    templates.length > 0
                      ? templates.map((t) => ({ value: t.id, label: t.name }))
                      : [{ value: "", label: "No templates" }]
                  }
                  placeholder="Select template"
                />
              </div>
            </div>

            {/* Skip-research toggle — fully-automatic testing (no VA / Perplexity step) */}
            <button
              type="button"
              onClick={() => setSkipResearch((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: skipResearch
                  ? "1px solid rgba(170,255,0,0.35)"
                  : "1px solid rgba(255,255,255,0.08)",
                background: skipResearch
                  ? "rgba(170,255,0,0.06)"
                  : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s ease",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 18,
                  color: skipResearch
                    ? "var(--v2-accent)"
                    : "rgba(205,195,215,0.35)",
                }}
              >
                {skipResearch ? "check_box" : "check_box_outline_blank"}
              </span>
              <span
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: skipResearch ? "var(--v2-accent)" : "#e5e2e1",
                  }}
                >
                  Skip research (auto-script)
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(205,195,215,0.4)",
                    lineHeight: 1.3,
                  }}
                >
                  Fully automatic — Claude writes from its own knowledge. No
                  research prompts, no VA upload step. For testing.
                </span>
              </span>
            </button>
          </div>

          {/* Submit */}
          <div
            style={{
              padding: "14px 20px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: canSubmit
                  ? "var(--v2-accent)"
                  : "rgba(255,255,255,0.05)",
                color: canSubmit ? "#000" : "rgba(205,195,215,0.3)",
                fontSize: 13,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition: "all 0.15s ease",
              }}
            >
              {submitting ? (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 16,
                      animation: "spin 1s linear infinite",
                    }}
                  >
                    progress_activity
                  </span>
                  Queuing…
                </>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    rocket_launch
                  </span>
                  Queue Comparison
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Pipeline preview */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(205,195,215,0.3)",
          }}
        >
          What happens after submit
        </span>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {pipelineSteps.map((step, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", flex: 1 }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 8px",
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgba(170,255,0,0.08)",
                    border: "1px solid rgba(170,255,0,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14, color: "var(--v2-accent)" }}
                  >
                    {step.icon}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "rgba(205,195,215,0.7)",
                    textAlign: "center",
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(205,195,215,0.35)",
                    textAlign: "center",
                    lineHeight: 1.3,
                  }}
                >
                  {step.detail}
                </span>
              </div>
              {i < pipelineSteps.length - 1 && (
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 14,
                    color: "rgba(205,195,215,0.2)",
                    flexShrink: 0,
                    margin: "0 4px",
                  }}
                >
                  arrow_forward
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent jobs — V2 native */}
      {jobs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(205,195,215,0.3)",
            }}
          >
            Recent Comparisons
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {jobs.map((job) => {
              const progress = PIPELINE_PROGRESS[job.status] ?? null;
              const isFailed = FAILED.has(job.status);
              const isPublished = job.status === "PUBLISHED";
              const isTerminal = TERMINAL.has(job.status);
              const label = STATUS_LABELS[job.status] ?? job.status;

              return (
                <div
                  key={job.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 8,
                  }}
                >
                  {/* Title */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link
                      href={`/jobs/${job.id}`}
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#e5e2e1",
                        textDecoration: "none",
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {job.title || "Untitled"}
                    </Link>
                    {/* Progress bar */}
                    {!isTerminal && progress !== null && (
                      <div
                        style={{
                          marginTop: 5,
                          height: 2,
                          borderRadius: 1,
                          background: "rgba(255,255,255,0.06)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 1,
                            background: "var(--v2-accent)",
                            width: `${progress}%`,
                            transition: "width 0.6s ease",
                          }}
                        />
                      </div>
                    )}
                    {isPublished && (
                      <div
                        style={{
                          marginTop: 5,
                          height: 2,
                          borderRadius: 1,
                          background: "rgba(52,211,153,0.15)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 1,
                            background: "#34d399",
                            width: "100%",
                          }}
                        />
                      </div>
                    )}
                    {isFailed && (
                      <div
                        style={{
                          marginTop: 5,
                          height: 2,
                          borderRadius: 1,
                          background: "rgba(248,113,113,0.15)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 1,
                            background: "#f87171",
                            width: "100%",
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {/* Status + time */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 3,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: isFailed
                          ? "#f87171"
                          : isPublished
                            ? "#34d399"
                            : "rgba(205,195,215,0.5)",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{ fontSize: 10, color: "rgba(205,195,215,0.3)" }}
                    >
                      {formatDistanceToNow(new Date(job.updated_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => handleDeleteJob(job)}
                    disabled={deletingId === job.id}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      color: "rgba(205,195,215,0.25)",
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                    onMouseEnter={(e: React.MouseEvent) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#f87171";
                    }}
                    onMouseLeave={(e: React.MouseEvent) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "rgba(205,195,215,0.25)";
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 15 }}
                    >
                      {deletingId === job.id ? "progress_activity" : "delete"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
