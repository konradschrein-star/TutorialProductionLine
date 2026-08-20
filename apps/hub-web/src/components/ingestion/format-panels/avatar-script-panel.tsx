"use client";

/**
 * AvatarScriptPanel
 *
 * Ingestion panel for formats that require BOTH an avatar video and a pre-written script:
 *   - CASUALLY_EXPLAINED
 *
 * Both files are hard requirements — the "Stage" button is disabled until both
 * are present. Topic auto-fills from the video filename but is editable.
 */

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Film, X, Plus } from "lucide-react";
import type { StagedJob } from "@/components/ingestion/staging-table";
import type { BatchDefaults } from "@/components/ingestion/batch-defaults-panel";

interface AvatarScriptPanelProps {
  defaults: BatchDefaults;
  format: string;
  onAddJobs: (jobs: StagedJob[]) => void;
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) ?? "");
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function topicFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function AvatarScriptPanel({
  defaults,
  format,
  onAddJobs,
}: AvatarScriptPanelProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [topic, setTopic] = useState("");

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const scriptInputRef = useRef<HTMLInputElement | null>(null);

  const handleVideoFile = useCallback((file: File) => {
    setVideoFile(file);
    setTopic((prev) => prev || topicFromFilename(file.name));
  }, []);

  const handleScriptFile = useCallback(async (file: File) => {
    setScriptFile(file);
    setTopic((prev) => prev || topicFromFilename(file.name));
    const text = await readFileAsText(file);
    setScriptText(text);
  }, []);

  function clearVideo() {
    setVideoFile(null);
  }
  function clearScript() {
    setScriptFile(null);
    setScriptText(null);
  }

  const canStage =
    videoFile !== null && scriptText !== null && topic.trim().length > 0;

  function handleStage() {
    if (!canStage) return;
    const job: StagedJob = {
      id: Math.random().toString(36).slice(2),
      topic: topic.trim(),
      script_text: scriptText,
      script_filename: scriptFile?.name ?? null,
      video_file: videoFile,
      video_filename: videoFile?.name ?? null,
      channel_id: defaults.channel_id,
      subtitles: defaults.subtitles,
      validation_status: "valid",
      validation_messages: [],
      overrides: new Set(),
    };
    onAddJobs([job]);
    setVideoFile(null);
    setScriptFile(null);
    setScriptText(null);
    setTopic("");
  }

  const videoLabel = "Avatar Video";
  const formatNote =
    format === "CASUALLY_EXPLAINED"
      ? "Drop the avatar recording and the comedy script. Style assets above determine the visual treatment."
      : "Both files are required. The script drives timing — upload the final version, not a draft.";

  return (
    <div className="glass rounded-lg border border-surface-bright p-4 space-y-4">
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Add Job
        </p>
        <p className="text-[11px] text-text-muted">{formatNote}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FileDropZone
          label={videoLabel}
          required
          accept=".mp4,.mov"
          acceptDisplay=".mp4 / .mov"
          icon={<Film className="w-5 h-5" />}
          file={videoFile}
          onFile={handleVideoFile}
          onClear={clearVideo}
          inputRef={videoInputRef}
          isVideo
        />
        <FileDropZone
          label="Script"
          required
          accept=".txt,.md,.srt"
          acceptDisplay=".txt / .md / .srt"
          icon={<FileText className="w-5 h-5" />}
          file={scriptFile}
          onFile={handleScriptFile}
          onClear={clearScript}
          inputRef={scriptInputRef}
          isVideo={false}
        />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
          Topic{" "}
          <span className="text-text-muted/50 normal-case font-normal">
            (auto-fills from filename)
          </span>
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canStage) handleStage();
          }}
          placeholder="e.g. Why the economy is broken"
          className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      <button
        onClick={handleStage}
        disabled={!canStage}
        className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
          canStage
            ? "bg-primary hover:bg-primary/90 text-black"
            : "bg-surface-bright/30 text-text-muted cursor-not-allowed"
        }`}
      >
        <Plus className="w-4 h-4" />
        {!videoFile
          ? `Select ${videoLabel} to continue`
          : !scriptText
            ? "Select Script to continue"
            : !topic.trim()
              ? "Enter a topic"
              : "Stage This Job"}
      </button>
    </div>
  );
}

// ── Shared drop zone tile ─────────────────────────────────────────────────────

interface FileDropZoneProps {
  label: string;
  required: boolean;
  accept: string;
  acceptDisplay: string;
  icon: React.ReactNode;
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  inputRef: { current: HTMLInputElement | null };
  isVideo: boolean;
}

function FileDropZone({
  label,
  required,
  accept,
  acceptDisplay,
  icon,
  file,
  onFile,
  onClear,
  inputRef,
  isVideo,
}: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (
      isVideo &&
      !f.type.startsWith("video/") &&
      !f.name.match(/\.(mp4|mov)$/i)
    )
      return;
    onFile(f);
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium uppercase tracking-wider flex items-center gap-1">
        <span
          className={required && !file ? "text-error/80" : "text-text-muted"}
        >
          {label}
        </span>
        {required && <span className="text-error/70">*</span>}
      </label>

      {file ? (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-success/10 border border-success/20 rounded-lg min-h-[3rem]">
          <div className="text-success flex-shrink-0">{icon}</div>
          <span className="text-xs text-text truncate flex-1">{file.name}</span>
          <button
            onClick={onClear}
            className="text-text-muted hover:text-text transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg px-3 py-5 text-center cursor-pointer transition-colors min-h-[3rem] flex flex-col items-center justify-center gap-1 ${
            dragOver
              ? "border-primary/60 bg-primary/5"
              : "border-surface-bright/60 hover:border-primary/30 hover:bg-surface-bright/10"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-4 h-4 text-text-muted" />
          <span className="text-[11px] text-text-muted">{acceptDisplay}</span>
          <span className="text-[10px] text-text-muted/50">
            or click to browse
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
