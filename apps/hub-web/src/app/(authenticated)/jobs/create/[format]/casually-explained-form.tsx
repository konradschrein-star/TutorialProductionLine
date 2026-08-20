"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createJob } from "@/app/actions/create-job";
import {
  AdvancedOptionsPanel,
  DEFAULT_ADVANCED,
  type AdvancedOptions,
} from "../_components/advanced-options-panel";
import { SubmitButton } from "../_components/submit-button";
import {
  labelStyle,
  inputStyle,
  selectStyle,
  textareaStyle,
  sectionStyle,
} from "../_components/form-field-styles";
import {
  saveJobCreationSession,
  loadJobCreationSession,
} from "@/lib/session-storage";

interface Channel {
  id: string;
  name: string;
  language: string;
}
interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
}
interface Archetype {
  id: string;
  name: string;
}
interface Character {
  id: string;
  name: string;
  archetype_id: string | null;
}
interface StyleLibrary {
  id: string;
  name: string;
}
interface TTSVoice {
  id: string;
  name: string;
  voice_id: string;
  provider: string;
  language: string;
  settings: string | null;
}
interface MusicTrack {
  id: string;
  name: string;
  file_path: string;
  duration_seconds: number;
  genre: string | null;
}

interface CasuallyExplainedFormProps {
  channels: Channel[];
  templates: Template[];
  archetypes: Archetype[];
  characters: Character[];
  styleCollections: StyleLibrary[];
}

type ImageModel =
  | "bytedance-seedream-4.5"
  | "bytedance-seedream-4.5-1k"
  | "gemini-3.1-flash-image-preview";

const IMAGE_MODELS: { value: ImageModel; label: string }[] = [
  { value: "bytedance-seedream-4.5", label: "SeedDream 4.5" },
  { value: "bytedance-seedream-4.5-1k", label: "SeedDream 4.5 1K (high-res)" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini Flash Image" },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const sectionHeaderStyle = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "rgba(205,195,215,0.4)",
  marginBottom: 12,
};

const dividerStyle = {
  borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
  paddingTop: 20,
  marginTop: 4,
};

export function CasuallyExplainedForm({
  channels,
  templates,
  archetypes,
  characters,
  styleCollections,
}: CasuallyExplainedFormProps) {
  const router = useRouter();

  // Core fields
  const [topic, setTopic] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  // Audio source
  const [audioSource, setAudioSource] = useState<"tts" | "upload">("tts");
  const [narrationFilePath, setNarrationFilePath] = useState<string | null>(
    null,
  );
  const [narrationFileName, setNarrationFileName] = useState<string | null>(
    null,
  );
  const [narrationUploading, setNarrationUploading] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);

  // TTS voices
  const [voicesByProvider, setVoicesByProvider] = useState<
    Record<string, TTSVoice[]>
  >({});
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(true);

  // Music
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [selectedMusicId, setSelectedMusicId] = useState("");
  const [musicLoading, setMusicLoading] = useState(true);

  // Subtitles — OFF by default for FFmpeg renders (the stock ASS overlay
  // looks ugly; the dedicated subtitle system is the only path that gets
  // per-format-tuned styling). User must explicitly opt in.
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [subtitleFont, setSubtitleFont] = useState("Arial");
  const [subtitleFontSize, setSubtitleFontSize] = useState(72);
  const [subtitleColorScheme, setSubtitleColorScheme] = useState<
    "white_black" | "yellow_black" | "black"
  >("white_black");

  // Visual assets
  const [archetypeId, setArchetypeId] = useState("");
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(
    [],
  );
  const [styleLibraryId, setStyleLibraryId] = useState("");
  const [imageModel, setImageModel] = useState<ImageModel>(
    "bytedance-seedream-4.5",
  );
  const [imageGenerationMode, setImageGenerationMode] = useState<
    "auto" | "manual"
  >("auto");

  // Form state
  const [advanced, setAdvanced] = useState<AdvancedOptions>(DEFAULT_ADVANCED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scriptFileRef = useRef<HTMLInputElement>(null);
  const narrationFileRef = useRef<HTMLInputElement>(null);
  const [scriptDragOver, setScriptDragOver] = useState(false);
  const [narrationDragOver, setNarrationDragOver] = useState(false);

  const filteredCharacters = archetypeId
    ? characters.filter(
        (c) => c.archetype_id === archetypeId || !c.archetype_id,
      )
    : characters;

  // Fetch TTS voices
  useEffect(() => {
    fetch("/api/tts-voices")
      .then((r) => r.json())
      .then((data) => {
        const grouped: Record<string, TTSVoice[]> = data.voices ?? {};
        setVoicesByProvider(grouped);
        // Default to first ElevenLabs Multilingual voice, else first available
        const elevenlabsVoices =
          grouped["ElevenLabs"] ?? grouped["ELEVENLABS"] ?? [];
        const multilingualFirst =
          elevenlabsVoices.find((v) => {
            const s = v.settings ? JSON.parse(v.settings) : {};
            return s.model?.includes("multilingual");
          }) ?? elevenlabsVoices[0];
        if (multilingualFirst) {
          setSelectedVoiceId(multilingualFirst.id);
        } else {
          const allVoices = Object.values(grouped).flat();
          if (allVoices[0]) setSelectedVoiceId(allVoices[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
  }, []);

  // Auto-select the CASUALLY_EXPLAINED archetype so ingest never fails with MISSING_ARCHETYPE_ID
  useEffect(() => {
    if (archetypes.length > 0 && !archetypeId) {
      const ce =
        archetypes.find((a) => a.name === "CASUALLY_EXPLAINED") ??
        archetypes[0];
      if (ce) setArchetypeId(ce.id);
    }
  }, [archetypes]);

  // Fetch music library
  useEffect(() => {
    fetch("/api/music-library")
      .then((r) => r.json())
      .then((data) => setMusicTracks(data.tracks ?? []))
      .catch(() => {})
      .finally(() => setMusicLoading(false));
  }, []);

  // Session persistence (load)
  useEffect(() => {
    const saved = loadJobCreationSession();
    if (!saved) return;
    if (saved.channel_id && channels.find((c) => c.id === saved.channel_id))
      setChannelId(saved.channel_id);
    if (saved.template_id && templates.find((t) => t.id === saved.template_id))
      setTemplateId(saved.template_id);
    if (saved.language)
      setAdvanced((a) => ({ ...a, language: saved.language! }));
    if (saved.production_version)
      setAdvanced((a) => ({
        ...a,
        production_version:
          saved.production_version as AdvancedOptions["production_version"],
      }));
    if (saved.skip_image_qc !== undefined)
      setAdvanced((a) => ({ ...a, skip_image_qc: saved.skip_image_qc! }));
    if (saved.skip_final_qc !== undefined)
      setAdvanced((a) => ({ ...a, skip_final_qc: saved.skip_final_qc! }));
    if (saved.image_model) setImageModel(saved.image_model);
    if (saved.style_library_id) setStyleLibraryId(saved.style_library_id ?? "");
    if (saved.character_id)
      setSelectedCharacterIds(saved.character_id ? [saved.character_id] : []);
  }, []);

  // Session persistence (save)
  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "CASUALLY_EXPLAINED",
      channel_id: channelId,
      template_id: templateId,
      language: advanced.language,
      production_version: advanced.production_version,
      skip_image_qc: advanced.skip_image_qc,
      skip_final_qc: advanced.skip_final_qc,
      image_model: imageModel,
      style_library_id: styleLibraryId || null,
      character_id: selectedCharacterIds[0] ?? null,
    });
  }, [
    channelId,
    templateId,
    advanced,
    imageModel,
    styleLibraryId,
    selectedCharacterIds,
  ]);

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  const readScriptFile = useCallback((file: File) => {
    if (!file.name.match(/\.(txt|md)$/i)) {
      setError("Script file must be .txt or .md");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setScriptText((e.target?.result as string) ?? "");
    reader.readAsText(file);
  }, []);

  const uploadNarrationFile = useCallback(async (file: File) => {
    const allowed = /\.(mp3|wav|m4a|ogg|mp4|webm|aac|flac)$/i;
    if (!allowed.test(file.name)) {
      setNarrationError(
        "Unsupported format. Use MP3, WAV, M4A, OGG, MP4, AAC, or FLAC.",
      );
      return;
    }
    setNarrationUploading(true);
    setNarrationError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/narration-upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setNarrationFilePath(data.path);
      setNarrationFileName(file.name);
    } catch (err) {
      setNarrationError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setNarrationUploading(false);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() && !scriptText.trim()) {
      setError("Topic or script is required");
      return;
    }
    if (!templateId) {
      setError("Please select a template");
      return;
    }
    if (audioSource === "upload" && !narrationFilePath) {
      setError("Please upload a narration audio file or switch to TTS");
      return;
    }
    setLoading(true);
    setError(null);

    const metadata: Record<string, unknown> = {
      style_library_id: styleLibraryId || undefined,
      image_model: imageModel,
    };
    if (audioSource === "tts" && selectedVoiceId) {
      metadata.voice_id = selectedVoiceId;
    }
    if (selectedMusicId) {
      metadata.music_track_id = selectedMusicId;
    }
    metadata.subtitle_config = {
      enabled: subtitlesEnabled,
      font: subtitleFont,
      fontSize: subtitleFontSize,
      colorScheme: subtitleColorScheme,
    };

    const result = await createJob({
      channel_id: channelId,
      format: "CASUALLY_EXPLAINED",
      template_id: templateId,
      initial_topic: topic.trim() || undefined,
      script_text: scriptText.trim() || undefined,
      narration_source_path:
        audioSource === "upload" ? (narrationFilePath ?? undefined) : undefined,
      archetype_id: archetypeId || undefined,
      character_ids: selectedCharacterIds.length
        ? selectedCharacterIds
        : undefined,
      image_generation_mode: imageGenerationMode,
      metadata,
      ...advanced,
    });

    if (result.success) {
      router.push("/jobs");
    } else {
      setError(result.error ?? "Failed to create job");
      setLoading(false);
    }
  }

  const allVoices = Object.values(voicesByProvider).flat();

  return (
    <form onSubmit={handleSubmit} style={sectionStyle}>
      {/* ── Topic ── */}
      <div>
        <label style={labelStyle}>Topic</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Why people are bad at estimating time"
          style={inputStyle}
        />
        <p
          style={{ fontSize: 10, color: "rgba(205,195,215,0.4)", marginTop: 4 }}
        >
          Required unless you provide a script below
        </p>
      </div>

      {/* ── Template ── */}
      {templates.length > 0 && (
        <div>
          <label style={labelStyle}>Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            style={selectStyle}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {templates.find((t) => t.id === templateId)?.description && (
            <p
              style={{
                fontSize: 11,
                color: "rgba(205,195,215,0.5)",
                marginTop: 6,
              }}
            >
              {templates.find((t) => t.id === templateId)!.description}
            </p>
          )}
        </div>
      )}

      {/* ── Channel ── */}
      <div>
        <label style={labelStyle}>Channel</label>
        <select
          value={channelId}
          onChange={(e) => {
            const id = e.target.value;
            setChannelId(id);
            // Load channel-level subtitle defaults
            if (id) {
              fetch(`/api/channels/${id}/subtitle-config`)
                .then((r) => r.json())
                .then((data) => {
                  const cfg = data?.subtitle_config;
                  if (cfg) {
                    if (cfg.font) setSubtitleFont(cfg.font);
                    if (cfg.fontSize) setSubtitleFontSize(cfg.fontSize);
                    if (cfg.colorScheme)
                      setSubtitleColorScheme(cfg.colorScheme);
                  }
                })
                .catch(() => {});
            }
          }}
          style={selectStyle}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Script ── */}
      <div style={dividerStyle}>
        <div style={sectionHeaderStyle}>Script</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={7}
              placeholder="Paste a pre-written script here to skip AI generation…"
              style={{
                ...textareaStyle,
                border: scriptDragOver
                  ? "1px solid rgba(var(--v2-accent-rgb), 0.6)"
                  : (textareaStyle.border as string),
                background: scriptDragOver
                  ? "rgba(var(--v2-accent-rgb), 0.05)"
                  : (textareaStyle.background as string),
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setScriptDragOver(true);
              }}
              onDragLeave={() => setScriptDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setScriptDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) readScriptFile(file);
              }}
            />
            {scriptDragOver && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  color: "var(--v2-accent)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Drop .txt file to load
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => scriptFileRef.current?.click()}
              style={{
                padding: "7px 14px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                background: "rgba(255,255,255,0.02)",
                color: "#cdc3d7",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                upload_file
              </span>
              Load from file
            </button>
            {scriptText && (
              <button
                type="button"
                onClick={() => setScriptText("")}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid rgba(255,100,100,0.2)",
                  background: "rgba(255,80,80,0.04)",
                  color: "rgba(255,120,120,0.7)",
                }}
              >
                Clear
              </button>
            )}
            {scriptText && (
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.4)",
                  marginLeft: 4,
                }}
              >
                {scriptText.split(/\s+/).filter(Boolean).length} words
              </span>
            )}
            <input
              ref={scriptFileRef}
              type="file"
              accept=".txt,.md"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readScriptFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Audio Source ── */}
      <div style={dividerStyle}>
        <div style={sectionHeaderStyle}>Audio</div>

        {/* Source toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["tts", "upload"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setAudioSource(mode);
                setNarrationError(null);
              }}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                border:
                  audioSource === mode
                    ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                background:
                  audioSource === mode
                    ? "rgba(var(--v2-accent-rgb), 0.12)"
                    : "rgba(255,255,255,0.02)",
                color: audioSource === mode ? "var(--v2-accent)" : "#cdc3d7",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13 }}
              >
                {mode === "tts" ? "record_voice_over" : "mic"}
              </span>
              {mode === "tts" ? "Text-to-Speech" : "Upload Narration"}
            </button>
          ))}
        </div>

        {/* TTS voice picker */}
        {audioSource === "tts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Voice</label>
              {voicesLoading ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(205,195,215,0.4)",
                    padding: "10px 0",
                  }}
                >
                  Loading voices…
                </div>
              ) : allVoices.length === 0 ? (
                <div
                  style={{
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "rgba(205,195,215,0.5)",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                    borderRadius: 8,
                  }}
                >
                  No TTS voices configured.{" "}
                  <a
                    href="/settings/voices"
                    style={{ color: "var(--v2-accent)" }}
                  >
                    Add voices →
                  </a>
                </div>
              ) : (
                <select
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">— Auto (use default for language) —</option>
                  {Object.entries(voicesByProvider).map(
                    ([provider, voices]) => {
                      const isEdgeTts =
                        provider === "EdgeTTS" || provider === "EDGE_TTS";
                      const label = isEdgeTts
                        ? `${provider} — TEST ONLY, do not use for production`
                        : provider;
                      return (
                        <optgroup key={provider} label={label}>
                          {voices.map((v) => {
                            const settings = v.settings
                              ? JSON.parse(v.settings)
                              : {};
                            const model: string = settings.model ?? "";
                            const modelLabel = model.includes("multilingual")
                              ? " · Multilingual"
                              : model.includes("turbo") ||
                                  model.includes("flash")
                                ? " · Fast"
                                : model.includes("monolingual") ||
                                    model.includes("english")
                                  ? " · English only"
                                  : "";
                            const langLabel =
                              v.language !== "en"
                                ? ` [${v.language.toUpperCase()}]`
                                : "";
                            return (
                              <option key={v.id} value={v.id}>
                                {v.name}
                                {modelLabel}
                                {langLabel}
                              </option>
                            );
                          })}
                        </optgroup>
                      );
                    },
                  )}
                </select>
              )}
            </div>

            {/* Show selected voice settings summary */}
            {selectedVoiceId &&
              (() => {
                const voice = allVoices.find((v) => v.id === selectedVoiceId);
                if (!voice) return null;
                const settings = voice.settings
                  ? JSON.parse(voice.settings)
                  : {};
                const model: string = settings.model ?? "";
                const isMultilingual = model.includes("multilingual");
                return (
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.5)",
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px 16px",
                    }}
                  >
                    <span>
                      <strong style={{ color: "rgba(205,195,215,0.7)" }}>
                        Provider:
                      </strong>{" "}
                      {voice.provider}
                    </span>
                    {model && (
                      <span>
                        <strong style={{ color: "rgba(205,195,215,0.7)" }}>
                          Model:
                        </strong>{" "}
                        {model}
                      </span>
                    )}
                    {isMultilingual && (
                      <span style={{ color: "var(--v2-accent)" }}>
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 11, verticalAlign: "middle" }}
                        >
                          language
                        </span>{" "}
                        Supports German &amp; other languages
                      </span>
                    )}
                    {settings.speed !== undefined && (
                      <span>
                        <strong style={{ color: "rgba(205,195,215,0.7)" }}>
                          Speed:
                        </strong>{" "}
                        {settings.speed}x
                      </span>
                    )}
                    {settings.stability !== undefined && (
                      <span>
                        <strong style={{ color: "rgba(205,195,215,0.7)" }}>
                          Stability:
                        </strong>{" "}
                        {settings.stability}
                      </span>
                    )}
                  </div>
                );
              })()}
          </div>
        )}

        {/* Narration upload */}
        {audioSource === "upload" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {narrationFilePath ? (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(100,220,100,0.25)",
                  background: "rgba(100,220,100,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: "#6ddc6d" }}
                  >
                    audio_file
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#e5e2e1",
                        fontWeight: 600,
                      }}
                    >
                      {narrationFileName}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(205,195,215,0.4)",
                        marginTop: 2,
                      }}
                    >
                      Uploaded — TTS will be skipped, this audio will be used
                      for transcription
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNarrationFilePath(null);
                    setNarrationFileName(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "rgba(205,195,215,0.5)",
                    padding: 4,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    close
                  </span>
                </button>
              </div>
            ) : (
              <div
                style={{
                  border: narrationDragOver
                    ? "2px dashed rgba(var(--v2-accent-rgb), 0.6)"
                    : "2px dashed rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 10,
                  padding: "28px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: narrationDragOver
                    ? "rgba(var(--v2-accent-rgb), 0.05)"
                    : "rgba(255,255,255,0.01)",
                  transition: "all 0.15s ease",
                }}
                onClick={() => narrationFileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setNarrationDragOver(true);
                }}
                onDragLeave={() => setNarrationDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setNarrationDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) uploadNarrationFile(file);
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 28,
                    color: "rgba(var(--v2-accent-rgb), 0.5)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  {narrationUploading ? "hourglass_top" : "mic"}
                </span>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(205,195,215,0.7)",
                    fontWeight: 600,
                  }}
                >
                  {narrationUploading
                    ? "Uploading…"
                    : "Drop audio file here or click to browse"}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(205,195,215,0.35)",
                    marginTop: 4,
                  }}
                >
                  MP3, WAV, M4A, OGG, MP4, AAC, FLAC
                </div>
              </div>
            )}
            {narrationError && (
              <div
                style={{
                  fontSize: 11,
                  color: "#ff8080",
                  padding: "6px 10px",
                  background: "rgba(255,80,80,0.06)",
                  borderRadius: 6,
                }}
              >
                {narrationError}
              </div>
            )}
            <input
              ref={narrationFileRef}
              type="file"
              accept=".mp3,.wav,.m4a,.ogg,.mp4,.webm,.aac,.flac"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadNarrationFile(file);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {/* ── Music ── */}
      <div style={dividerStyle}>
        <div style={sectionHeaderStyle}>Background Music</div>
        {musicLoading ? (
          <div style={{ fontSize: 12, color: "rgba(205,195,215,0.4)" }}>
            Loading music library…
          </div>
        ) : (
          <div>
            <label style={labelStyle}>Track</label>
            <select
              value={selectedMusicId}
              onChange={(e) => setSelectedMusicId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— No music —</option>
              {musicTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.genre ? ` · ${t.genre}` : ""}
                  {t.duration_seconds
                    ? ` · ${formatDuration(t.duration_seconds)}`
                    : ""}
                </option>
              ))}
            </select>
            {musicTracks.length === 0 && (
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.4)",
                  marginTop: 6,
                }}
              >
                No tracks in library yet.{" "}
                <a href="/settings/music" style={{ color: "var(--v2-accent)" }}>
                  Add tracks →
                </a>
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Subtitles ── */}
      <div style={dividerStyle}>
        <div style={sectionHeaderStyle}>Subtitles</div>

        {/* Enable toggle — off by default */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            background: subtitlesEnabled
              ? "rgba(var(--v2-accent-rgb), 0.08)"
              : "rgba(255,255,255,0.03)",
            border: subtitlesEnabled
              ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
              : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              flex: 1,
            }}
          >
            <input
              type="checkbox"
              checked={subtitlesEnabled}
              onChange={(e) => setSubtitlesEnabled(e.target.checked)}
              style={{ accentColor: "var(--v2-accent)" }}
            />
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "#e5e2e1",
                  fontWeight: 600,
                }}
              >
                Burn subtitles into video
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(205,195,215,0.5)",
                  marginTop: 2,
                }}
              >
                Off by default. When enabled, captions are drawn over the video
                using the styling below.
              </div>
            </div>
          </label>
        </div>

        {!subtitlesEnabled && (
          <div
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.4)",
              fontStyle: "italic",
              marginBottom: 12,
            }}
          >
            Styling controls are inactive while subtitles are disabled.
          </div>
        )}

        {/* Live text preview */}
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: subtitleColorScheme === "black" ? "#fff" : "#111",
            marginBottom: 14,
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily:
                subtitleFont === "Montserrat"
                  ? "var(--font-montserrat), sans-serif"
                  : subtitleFont === "Comic Neue"
                    ? "var(--font-comic-neue), cursive"
                    : "Arial, sans-serif",
              fontSize: Math.round(subtitleFontSize * 0.3),
              fontWeight: 700,
              color:
                subtitleColorScheme === "yellow_black"
                  ? "#ffff00"
                  : subtitleColorScheme === "black"
                    ? "#000"
                    : "#fff",
              WebkitTextStroke:
                subtitleColorScheme === "black" ? "1px #fff" : "1px #000",
            }}
          >
            The quick{" "}
            <span
              style={{
                color:
                  subtitleColorScheme === "yellow_black"
                    ? "#fff"
                    : subtitleColorScheme === "black"
                      ? "#aaff00"
                      : "#aaff00",
              }}
            >
              brown fox
            </span>{" "}
            jumps
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Font */}
          <div>
            <label style={labelStyle}>Font</label>
            <select
              value={subtitleFont}
              onChange={(e) => setSubtitleFont(e.target.value)}
              style={selectStyle}
            >
              <option value="Arial">Arial (default)</option>
              <option value="Montserrat">Montserrat</option>
              <option value="Comic Neue">Comic Neue</option>
            </select>
          </div>

          {/* Size slider */}
          <div>
            <label
              style={{
                ...labelStyle,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Font Size</span>
              <span style={{ color: "var(--v2-accent)", fontWeight: 600 }}>
                {subtitleFontSize}pt
              </span>
            </label>
            <input
              type="range"
              min={48}
              max={96}
              step={4}
              value={subtitleFontSize}
              onChange={(e) => setSubtitleFontSize(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--v2-accent)" }}
            />
          </div>

          {/* Color scheme */}
          <div>
            <label style={labelStyle}>Color Scheme</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  {
                    value: "white_black",
                    label: "White / Black",
                    bg: "#111",
                    fg: "#fff",
                    hl: "#aaff00",
                  },
                  {
                    value: "yellow_black",
                    label: "Yellow / Black",
                    bg: "#111",
                    fg: "#ffff00",
                    hl: "#fff",
                  },
                  {
                    value: "black",
                    label: "Black",
                    bg: "#fff",
                    fg: "#000",
                    hl: "#aaff00",
                  },
                ] as const
              ).map((scheme) => (
                <button
                  key={scheme.value}
                  type="button"
                  onClick={() => setSubtitleColorScheme(scheme.value)}
                  style={{
                    flex: 1,
                    padding: "8px 4px",
                    borderRadius: 8,
                    border: `2px solid ${subtitleColorScheme === scheme.value ? "var(--v2-accent)" : "rgba(255,255,255,0.1)"}`,
                    background:
                      subtitleColorScheme === scheme.value
                        ? "rgba(var(--v2-accent-rgb),0.1)"
                        : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: scheme.bg,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    <span style={{ color: scheme.hl }}>Hi</span>
                    <span style={{ color: scheme.fg }}> text</span>
                  </span>
                  <span style={{ fontSize: 10, color: "#cdc3d7" }}>
                    {scheme.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Save as channel default */}
          {channelId && (
            <button
              type="button"
              onClick={async () => {
                await fetch(`/api/channels/${channelId}/subtitle-config`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    font: subtitleFont,
                    fontSize: subtitleFontSize,
                    colorScheme: subtitleColorScheme,
                  }),
                });
              }}
              style={{
                alignSelf: "flex-start",
                fontSize: 11,
                color: "var(--v2-accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Save as channel default →
            </button>
          )}
        </div>
      </div>

      {/* ── Visual Assets ── */}
      <div style={dividerStyle}>
        <div style={sectionHeaderStyle}>Visual Assets</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {archetypes.length > 0 && (
            <div>
              <label style={labelStyle}>Archetype</label>
              <select
                value={archetypeId}
                onChange={(e) => {
                  setArchetypeId(e.target.value);
                  setSelectedCharacterIds([]);
                }}
                style={selectStyle}
              >
                <option value="">— None (auto) —</option>
                {archetypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {styleCollections.length > 0 && (
            <div>
              <label style={labelStyle}>Style Collection</label>
              <select
                value={styleLibraryId}
                onChange={(e) => setStyleLibraryId(e.target.value)}
                style={selectStyle}
              >
                <option value="">— None (auto) —</option>
                {styleCollections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filteredCharacters.length > 0 && (
            <div>
              <label style={labelStyle}>
                Characters{" "}
                <span
                  style={{
                    fontWeight: 400,
                    textTransform: "none",
                    letterSpacing: 0,
                    color: "rgba(205,195,215,0.4)",
                  }}
                >
                  multi-select
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                {filteredCharacters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: selectedCharacterIds.includes(c.id)
                        ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
                        : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                      background: selectedCharacterIds.includes(c.id)
                        ? "rgba(var(--v2-accent-rgb), 0.15)"
                        : "rgba(255,255,255,0.02)",
                      color: selectedCharacterIds.includes(c.id)
                        ? "var(--v2-accent)"
                        : "#cdc3d7",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            <div>
              <label style={labelStyle}>Image Model</label>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageModel)}
                style={selectStyle}
              >
                {IMAGE_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Image Generation</label>
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                {(["auto", "manual"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setImageGenerationMode(mode)}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      cursor: "pointer",
                      border:
                        imageGenerationMode === mode
                          ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                          : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                      background:
                        imageGenerationMode === mode
                          ? "rgba(var(--v2-accent-rgb), 0.12)"
                          : "rgba(255,255,255,0.02)",
                      color:
                        imageGenerationMode === mode
                          ? "var(--v2-accent)"
                          : "#cdc3d7",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AdvancedOptionsPanel value={advanced} onChange={setAdvanced} />

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.2)",
            borderRadius: 8,
            fontSize: 12,
            color: "#ff8080",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            error
          </span>
          {error}
        </div>
      )}

      <SubmitButton
        loading={loading}
        disabled={!topic.trim() && !scriptText.trim()}
      />
    </form>
  );
}
