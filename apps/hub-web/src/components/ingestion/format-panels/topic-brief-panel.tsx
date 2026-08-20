"use client";

/**
 * TopicBriefPanel
 *
 * Ingestion panel for AI-driven formats where the operator provides a topic and
 * optional context. The AI generates the full script from this input.
 *
 *   - EXPLAINER       — key points to cover improve script depth
 *   - DOCUMENTARY     — era/focus angle shapes the narrative
 *
 * Supports single-job and batch modes. Brief/context is embedded in the topic
 * string so it flows naturally into AI script generation prompts.
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import type { StagedJob } from "@/components/ingestion/staging-table";
import type { BatchDefaults } from "@/components/ingestion/batch-defaults-panel";

interface TopicBriefPanelProps {
  defaults: BatchDefaults;
  format: string;
  onAddJobs: (jobs: StagedJob[]) => void;
}

interface FormatHints {
  topicLabel: string;
  topicPlaceholder: string;
  briefLabel: string;
  briefRequired: boolean;
  briefPlaceholder: string;
  batchNote: string;
}

const FORMAT_HINTS: Record<string, FormatHints> = {
  EXPLAINER: {
    topicLabel: "Topic",
    topicPlaceholder: "e.g. How does CRISPR gene editing work?",
    briefLabel: "Key Points to Cover",
    briefRequired: false,
    briefPlaceholder:
      "e.g. What is CRISPR, Cas9 mechanism, how editing works step-by-step, medical applications, ethical concerns, current research state",
    batchNote:
      "One topic per line. Key points apply to all jobs in this batch.",
  },
  DOCUMENTARY: {
    topicLabel: "Subject",
    topicPlaceholder: "e.g. The Fall of the Roman Empire",
    briefLabel: "Narrative Angle / Focus",
    briefRequired: false,
    briefPlaceholder:
      "e.g. Focus on economic decline and political instability, 3rd–5th century AD. Tone: serious, investigative. Avoid battle details.",
    batchNote:
      "One subject per line. Narrative angle applies to all jobs in this batch.",
  },
};

const DEFAULT_HINTS: FormatHints = {
  topicLabel: "Topic",
  topicPlaceholder: "Enter topic...",
  briefLabel: "Additional Context",
  briefRequired: false,
  briefPlaceholder: "Any specific angles, key points, or notes for the AI...",
  batchNote: "One topic per line.",
};

function makeJob(
  topicStr: string,
  brief: string,
  hints: FormatHints,
  format: string,
  defaults: BatchDefaults,
): StagedJob {
  let fullTopic = topicStr.trim();

  if (brief.trim()) {
    fullTopic = `${fullTopic}\n\n${hints.briefLabel}:\n${brief.trim()}`;
  }

  return {
    id: Math.random().toString(36).slice(2),
    topic: fullTopic,
    script_text: null,
    script_filename: null,
    video_file: null,
    video_filename: null,
    channel_id: defaults.channel_id,
    subtitles: defaults.subtitles,
    validation_status: "valid",
    validation_messages: [],
    overrides: new Set(),
  };
}

export function TopicBriefPanel({
  defaults,
  format,
  onAddJobs,
}: TopicBriefPanelProps) {
  const hints = FORMAT_HINTS[format] ?? DEFAULT_HINTS;
  const isWhatIf = false;

  const [batchMode, setBatchMode] = useState(false);
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [batchText, setBatchText] = useState("");

  const batchLines = batchText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const canSingle =
    topic.trim().length > 0 &&
    (!hints.briefRequired || brief.trim().length > 0);
  const canBatch =
    batchLines.length > 0 && (!hints.briefRequired || brief.trim().length > 0);

  function handleSingle() {
    if (!canSingle) return;
    onAddJobs([makeJob(topic, brief, hints, format, defaults)]);
    setTopic("");
    setBrief("");
  }

  function handleBatch() {
    if (!canBatch) return;
    onAddJobs(
      batchLines.map((t) => makeJob(t, brief, hints, format, defaults)),
    );
    setBatchText("");
    setBrief("");
  }

  return (
    <div className="glass rounded-lg border border-surface-bright p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
            {batchMode ? "Batch Topics" : "Add Job"}
          </p>
          <p className="text-[11px] text-text-muted">
            {batchMode
              ? hints.batchNote
              : "AI generates the script. More context → higher quality output."}
          </p>
        </div>
        <button
          onClick={() => setBatchMode((m) => !m)}
          className="text-[10px] text-primary hover:text-primary/80 transition-colors whitespace-nowrap flex-shrink-0 mt-0.5"
        >
          {batchMode ? "← Single job" : "Batch mode →"}
        </button>
      </div>

      {/* Topic / topics input */}
      {batchMode ? (
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider flex items-center gap-1">
            <span className="text-error/80">{hints.topicLabel}s</span>
            <span className="text-error/70">*</span>
            <span className="text-text-muted/50 normal-case font-normal ml-1">
              — one per line
            </span>
          </label>
          <textarea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            placeholder={`${hints.topicPlaceholder}\n${hints.topicPlaceholder} 2\n...`}
            rows={5}
            className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors resize-none"
          />
          {batchLines.length > 0 && (
            <p className="text-[10px] text-text-muted">
              {batchLines.length} topic{batchLines.length !== 1 ? "s" : ""}{" "}
              ready to stage
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider flex items-center gap-1">
            <span className="text-error/80">{hints.topicLabel}</span>
            <span className="text-error/70">*</span>
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isWhatIf && canSingle) handleSingle();
            }}
            placeholder={hints.topicPlaceholder}
            className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      )}

      {/* Brief / context */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1">
          {hints.briefRequired ? (
            <span className="text-error/80">{hints.briefLabel}</span>
          ) : (
            <span>{hints.briefLabel}</span>
          )}
          {hints.briefRequired && <span className="text-error/70">*</span>}
          {!hints.briefRequired && (
            <span className="text-text-muted/50 normal-case font-normal ml-1">
              optional — improves output quality
            </span>
          )}
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={hints.briefPlaceholder}
          rows={isWhatIf ? 3 : 2}
          className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors resize-none"
        />
      </div>

      <button
        onClick={batchMode ? handleBatch : handleSingle}
        disabled={batchMode ? !canBatch : !canSingle}
        className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
          (batchMode ? canBatch : canSingle)
            ? "bg-primary hover:bg-primary/90 text-black"
            : "bg-surface-bright/30 text-text-muted cursor-not-allowed"
        }`}
      >
        <Plus className="w-4 h-4" />
        {batchMode
          ? canBatch
            ? `Stage ${batchLines.length} Job${batchLines.length !== 1 ? "s" : ""}`
            : `Enter ${hints.topicLabel}s`
          : canSingle
            ? "Stage This Job"
            : hints.briefRequired && !brief.trim()
              ? "Enter Counterfactual Premise"
              : `Enter ${hints.topicLabel}`}
      </button>
    </div>
  );
}
