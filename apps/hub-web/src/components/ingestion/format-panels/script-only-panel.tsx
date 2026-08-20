"use client";

/**
 * ScriptOnlyPanel
 *
 * Ingestion panel for formats where the operator provides a finished script but no
 * avatar video recording is needed:
 *   - VIDEO_ESSAY   — author's essay drives the content; AI does not write essays
 *
 * Script is a hard requirement (error, not warning). Topic defaults from filename.
 */

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, Plus } from "lucide-react";
import type { StagedJob } from "@/components/ingestion/staging-table";
import type { BatchDefaults } from "@/components/ingestion/batch-defaults-panel";

interface ScriptOnlyPanelProps {
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

export function ScriptOnlyPanel({
  defaults,
  format,
  onAddJobs,
}: ScriptOnlyPanelProps) {
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [topic, setTopic] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setScriptFile(file);
    setPasteMode(false);
    setTopic((prev) => prev || topicFromFilename(file.name));
    setScriptText(await readFileAsText(file));
  }, []);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  }

  function togglePaste() {
    setPasteMode((m) => !m);
    setScriptFile(null);
    setScriptText(null);
    setPastedText("");
  }

  const effectiveScript = pasteMode ? pastedText.trim() || null : scriptText;
  const canStage = effectiveScript !== null && topic.trim().length > 0;

  function handleStage() {
    if (!canStage) return;
    const job: StagedJob = {
      id: Math.random().toString(36).slice(2),
      topic: topic.trim(),
      script_text: effectiveScript,
      script_filename: pasteMode ? null : (scriptFile?.name ?? null),
      video_file: null,
      video_filename: null,
      channel_id: defaults.channel_id,
      subtitles: defaults.subtitles,
      validation_status: "valid",
      validation_messages: [],
      overrides: new Set(),
    };
    onAddJobs([job]);
    setScriptFile(null);
    setScriptText(null);
    setPastedText("");
    setTopic("");
  }

  const isEssay = format === "VIDEO_ESSAY";

  return (
    <div className="glass rounded-lg border border-surface-bright p-4 space-y-4">
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          {isEssay ? "Add Essay" : "Add Script"}
        </p>
        <p className="text-[11px] text-text-muted">
          {isEssay
            ? "A pre-written essay script is required — this format preserves your voice. AI does not write essays."
            : "Drop your finished script. Stickman visuals and TTS audio are generated automatically — no recording needed."}
        </p>
      </div>

      {/* Script input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium uppercase tracking-wider flex items-center gap-1">
            <span className="text-error/80">Script</span>
            <span className="text-error/70">*</span>
          </label>
          <button
            onClick={togglePaste}
            className="text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            {pasteMode ? "Upload file instead" : "Paste text instead"}
          </button>
        </div>

        {pasteMode ? (
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste full script here..."
            rows={9}
            className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors resize-none font-mono text-xs leading-relaxed"
          />
        ) : scriptFile ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-success/10 border border-success/20 rounded-lg">
            <FileText className="w-4 h-4 text-success flex-shrink-0" />
            <span className="text-xs text-text truncate flex-1">
              {scriptFile.name}
            </span>
            <button
              onClick={() => {
                setScriptFile(null);
                setScriptText(null);
              }}
              className="text-text-muted hover:text-text transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-lg px-3 py-7 text-center cursor-pointer transition-colors ${
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
            <div className="flex flex-col items-center gap-1.5 text-text-muted">
              <Upload className="w-5 h-5" />
              <span className="text-xs">.txt / .md / .srt</span>
              <span className="text-[10px] text-text-muted/50">
                or click to browse
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.md,.srt"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {/* Topic */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wider flex items-center gap-1">
          <span className="text-error/80">Topic</span>
          <span className="text-error/70">*</span>
          <span className="text-text-muted/50 normal-case font-normal ml-1">
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
          placeholder={
            isEssay
              ? "e.g. Why social media destroyed attention spans"
              : "e.g. Why humans are terrible at making decisions"
          }
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
        {!effectiveScript
          ? "Add Script First"
          : !topic.trim()
            ? "Enter a Topic"
            : "Stage This Job"}
      </button>
    </div>
  );
}
