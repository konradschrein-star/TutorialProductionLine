"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  BatchDefaultsPanel,
  type BatchDefaults,
} from "@/components/ingestion/batch-defaults-panel";
import {
  StagingTable,
  type StagedJob,
} from "@/components/ingestion/staging-table";
import {
  dispatchStagedJobs,
  type StagedJobPayload,
} from "@/app/actions/zip-ingestion";
import { getFormatConfig } from "@/lib/format-config";
import {
  formatDisplayName,
  FORMAT_META,
} from "@/components/formats/format-card";
import { StyleCollectionPicker } from "@/components/style-collections/style-collection-picker";
import { getAssetConfig, getRequiredAssetIds } from "@/lib/asset-type-registry";
import { CharacterPicker } from "@/components/characters/character-picker";
import { AssetDropZones } from "@/components/job-creation/asset-drop-zones";
import { type DropZoneAsset } from "@/components/job-creation/drop-zone-card";

interface Channel {
  id: string;
  name: string;
  youtube_channel_id: string;
  language: string;
}

interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
}

interface CreateJobFormProps {
  channels: Channel[];
  templates: Template[];
  initialFormat?: string;
}

const ALL_FORMATS = [
  "EXPLAINER",
  "DOCUMENTARY",
  "TECH_COMPARISON",
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  "RANKING",
] as const;

export function CreateJobForm({
  channels,
  templates,
  initialFormat,
}: CreateJobFormProps) {
  const router = useRouter();

  // Step 1: Format selection
  const [selectedFormat, setSelectedFormat] = useState<string>(
    initialFormat ?? "",
  );

  // Ingestion state (same pattern as IngestionTab)
  const [defaults, setDefaults] = useState<BatchDefaults>({
    template_id: "",
    channel_id: channels[0]?.id ?? "",
    production_version: "V2",
    subtitles: true,
    auto_start: true,
    skip_image_qc: false,
    skip_final_qc: false,
    language: channels[0]?.language ?? "en",
  });
  const [stagedJobs, setStagedJobs] = useState<StagedJob[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    queued: number;
    errors: string[];
  } | null>(null);

  // Asset drop zones state
  const [assetsByZone, setAssetsByZone] = useState<
    Map<string, DropZoneAsset[]>
  >(new Map());

  // Style collection selection (available for ALL formats)
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  const [archetypeId, setArchetypeId] = useState<string | null>(null);

  // Determine which pickers to show based on format configuration
  const assetConfig = getAssetConfig(selectedFormat);
  // All formats use style_collections system
  const needsStylePicker = selectedFormat !== "";
  const usesStyleCollections = needsStylePicker;

  // Environment selection for photorealistic formats
  const needsEnvironmentPicker = selectedFormat !== "";
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<
    string | null
  >(null);
  const [environments, setEnvironments] = useState<
    Array<{ id: string; name: string; description: string }>
  >([]);

  // Character selection for character-based formats
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(
    [],
  );
  const needsCharacterPicker = selectedFormat === "CASUALLY_EXPLAINED";

  // Bundestag clip paths (file path input for pre-uploaded videos)
  const [clipPaths, setClipPaths] = useState<string>("");

  // Image generation mode (manual upload vs auto AI generation)
  // Only available for formats using script-based image generation
  const FORMATS_SUPPORTING_MANUAL_IMAGE_MODE = [
    "EXPLAINER",
    "CASUALLY_EXPLAINED",
    "DOCUMENTARY",
    "VIDEO_ESSAY",
  ];
  const supportsManualImageMode =
    FORMATS_SUPPORTING_MANUAL_IMAGE_MODE.includes(selectedFormat);
  const [imageGenerationMode, setImageGenerationMode] = useState<
    "auto" | "manual"
  >("auto");

  useEffect(() => {
    if (!needsEnvironmentPicker) return;
    fetch("/api/environments")
      .then((r) => r.json())
      .then((d) => setEnvironments(d.environments ?? []))
      .catch(() => setEnvironments([]));
  }, [needsEnvironmentPicker]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults.language intentionally omitted: effect must only fire on channel change, not when user manually selects a language
  useEffect(() => {
    const selectedChannel = channels.find((c) => c.id === defaults.channel_id);
    if (selectedChannel && selectedChannel.language !== defaults.language) {
      setDefaults((prev) => ({ ...prev, language: selectedChannel.language }));
    }
  }, [defaults.channel_id, channels]);

  // Lock format when initialFormat is provided (format-specific routes)
  useEffect(() => {
    if (initialFormat && !selectedFormat) {
      setSelectedFormat(initialFormat);
      const firstTemplate = templates.find((t) => t.format === initialFormat);
      if (firstTemplate) {
        setDefaults((prev) => ({ ...prev, template_id: firstTemplate.id }));
      }
    }
  }, [initialFormat, selectedFormat, templates]);

  // Fetch archetype and default style from selected template
  useEffect(() => {
    const selectedTemplate = templates.find(
      (t) => t.id === defaults.template_id,
    );
    if (selectedTemplate) {
      // Templates store archetype_id as top-level column
      const metadata = selectedTemplate as any;
      setArchetypeId(metadata.archetype_id ?? null);

      // Auto-select default style library if template has one
      const defaultStyleId =
        metadata.default_style_library_id ??
        metadata.default_style_collection_id;
      if (defaultStyleId && !selectedCollectionId) {
        setSelectedCollectionId(defaultStyleId);
      }
    }
  }, [defaults.template_id, templates]);

  // Format-filtered templates
  const formatTemplates = templates
    .filter((t) => t.format === selectedFormat)
    .map((t) => ({
      id: t.id,
      name: t.name,
      format: t.format,
      description: t.description,
    }));

  const formatConfig = getFormatConfig(selectedFormat);

  // When format changes, reset template and staged jobs
  function handleFormatChange(format: string) {
    const firstTemplate = templates.find((t) => t.format === format);
    setSelectedFormat(format);
    setDefaults((prev) => ({
      ...prev,
      template_id: firstTemplate?.id ?? "",
    }));
    setStagedJobs([]);
    setDispatchResult(null);
    setWarnings([]);
    setActivityLog([]);
  }

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setActivityLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 200));
  }, []);

  // Validation — accepts currentDefaults explicitly to avoid stale closure issues
  function validateJob(
    job: StagedJob,
    currentDefaults: BatchDefaults,
  ): StagedJob {
    const messages: string[] = [];
    let status: StagedJob["validation_status"] = "valid";

    // Basic validations
    if (!job.topic.trim()) {
      messages.push("Topic is required");
      status = "error";
    }
    if (!job.channel_id) {
      messages.push("Select a channel");
      status = "error";
    }
    if (!currentDefaults.template_id) {
      messages.push("Select a template");
      status = "error";
    }

    // Validate required assets based on format
    const requiredAssetIds = getRequiredAssetIds(selectedFormat);
    for (const assetId of requiredAssetIds) {
      const assets = assetsByZone.get(assetId);
      if (!assets || assets.length === 0) {
        const zone = assetConfig.zones.find((z) => z.id === assetId);
        const label = zone?.label ?? assetId;
        messages.push(`Required asset missing: ${label}`);
        status = "error";
      }
    }

    // Bundestag format: validate clip paths
    if (selectedFormat === "BUNDESTAG") {
      if (!job.clip_paths || job.clip_paths.length === 0) {
        messages.push("At least one video clip path is required");
        status = "error";
      } else {
        const invalidPaths = job.clip_paths.filter((p) => !p.startsWith("/"));
        if (invalidPaths.length > 0) {
          messages.push(
            `Invalid paths (must be absolute): ${invalidPaths.slice(0, 3).join(", ")}${invalidPaths.length > 3 ? "..." : ""}`,
          );
          status = "error";
        }
      }
    }

    // Script warning (only if not error already)
    if (status !== "error") {
      if (!job.script_text && job.topic.trim()) {
        messages.push("No script provided — AI will generate one");
        status = "warning";
      }
    }

    return { ...job, validation_status: status, validation_messages: messages };
  }

  function revalidateAll(
    jobs: StagedJob[],
    currentDefaults: BatchDefaults,
  ): StagedJob[] {
    return jobs.map((j) => validateJob(j, currentDefaults));
  }

  const handleDefaultsChange = useCallback(
    (newDefaults: BatchDefaults) => {
      setDefaults(newDefaults);
      setStagedJobs((prev) =>
        revalidateAll(
          prev.map((job) => {
            const updated = { ...job };
            if (!job.overrides.has("channel_id")) {
              updated.channel_id = newDefaults.channel_id;
            }
            if (!job.overrides.has("subtitles")) {
              updated.subtitles = newDefaults.subtitles;
            }
            return updated;
          }),
          newDefaults,
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleAddJobs = useCallback(
    (newJobs: StagedJob[]) => {
      setStagedJobs((prev) => revalidateAll([...prev, ...newJobs], defaults));
      setDispatchResult(null);
      newJobs.forEach((j) => {
        const parts = [j.topic || "(no topic)"];
        if (j.script_filename) parts.push(`script: ${j.script_filename}`);
        if (j.video_filename) parts.push(`video: ${j.video_filename}`);
        log(`Staged: ${parts.join(" | ")}`);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log],
  );

  const handleUpdateJob = useCallback(
    (id: string, updates: Partial<StagedJob>) => {
      setStagedJobs((prev) =>
        revalidateAll(
          prev.map((j) => (j.id === id ? { ...j, ...updates } : j)),
          defaults,
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDeleteJob = useCallback((id: string) => {
    setStagedJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const handleClearAll = useCallback(() => {
    setStagedJobs([]);
    setWarnings([]);
    setDispatchResult(null);
  }, []);

  const handleWarnings = useCallback(
    (newWarnings: string[]) => {
      setWarnings((prev) => [...prev, ...newWarnings]);
      newWarnings.forEach((w) => log(`WARN: ${w}`));
    },
    [log],
  );

  const handleAssetsChange = useCallback(
    (assets: Map<string, DropZoneAsset[]>) => {
      setAssetsByZone(assets);
    },
    [],
  );

  // Manual job creation from topic + assets
  const handleCreateJobFromTopic = useCallback(
    (topic: string) => {
      if (!topic.trim()) return;

      // Parse clip paths for Bundestag format
      const parsedClipPaths =
        selectedFormat === "BUNDESTAG"
          ? clipPaths
              .split("\n")
              .map((p) => p.trim())
              .filter((p) => p.length > 0)
          : undefined;

      const newJob: StagedJob = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        topic: topic.trim(),
        script_text: null,
        script_filename: null,
        video_file: null,
        video_filename: null,
        channel_id: defaults.channel_id,
        subtitles: defaults.subtitles,
        character_ids: needsCharacterPicker ? selectedCharacterIds : undefined,
        clip_paths: parsedClipPaths,
        overrides: new Set(),
        validation_status: "valid",
        validation_messages: [],
      };

      handleAddJobs([newJob]);
    },
    [
      defaults.channel_id,
      defaults.subtitles,
      needsCharacterPicker,
      selectedCharacterIds,
      selectedFormat,
      clipPaths,
      handleAddJobs,
    ],
  );

  const handleDispatch = useCallback(async () => {
    const validJobs = stagedJobs.filter((j) => j.validation_status !== "error");
    if (validJobs.length === 0) return;

    setDispatching(true);
    setDispatchResult(null);
    log(
      `Dispatching ${validJobs.length} job${validJobs.length !== 1 ? "s" : ""}...`,
    );

    try {
      // Upload video files to R2
      const uploadedAssets = new Map<
        string,
        { key: string; type: string; size_bytes: number }
      >();

      for (const job of validJobs) {
        if (!job.video_file) continue;

        log(
          `Uploading video: ${job.video_file.name} (${(job.video_file.size / 1024 / 1024).toFixed(1)} MB)...`,
        );

        const uploadForm = new FormData();
        uploadForm.append("file", job.video_file);
        uploadForm.append("channel_id", job.channel_id);

        const resp = await fetch("/api/upload", {
          method: "POST",
          body: uploadForm,
          credentials: "same-origin",
        });

        const contentType = resp.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          const text = await resp.text();
          throw new Error(
            `Video upload for "${job.topic}" returned ${resp.status} (non-JSON): ${text.slice(0, 200)}`,
          );
        }

        const uploadResult = await resp.json();
        if (!resp.ok || !uploadResult.success) {
          throw new Error(
            `Video upload failed for "${job.topic}": ${uploadResult.error ?? resp.statusText}`,
          );
        }

        log(`Video uploaded: ${uploadResult.key}`);
        uploadedAssets.set(job.id, {
          key: uploadResult.key,
          type: uploadResult.type,
          size_bytes: uploadResult.size_bytes,
        });
      }

      // Build payloads
      const formData = new FormData();
      const payloads: StagedJobPayload[] = validJobs.map((job) => {
        const asset = uploadedAssets.get(job.id);
        return {
          topic: job.topic,
          script_text: job.script_text,
          channel_id: job.channel_id,
          template_id: defaults.template_id,
          format: selectedFormat,
          production_version: defaults.production_version,
          subtitles: job.subtitles,
          skip_image_qc: defaults.skip_image_qc,
          skip_final_qc: defaults.skip_final_qc,
          language: defaults.language,
          voice_id: defaults.voice_id ?? null,
          video_key: null,
          pre_uploaded_asset: asset ?? null,
          environment_id: needsEnvironmentPicker
            ? (selectedEnvironmentId ?? null)
            : null,
          character_ids: needsCharacterPicker
            ? selectedCharacterIds
            : undefined,
          image_generation_mode: supportsManualImageMode
            ? imageGenerationMode
            : undefined,
          bundestag_clip_paths: job.clip_paths ?? undefined,
          archetype_id: archetypeId ?? undefined,
          style_library_id: selectedCollectionId ?? undefined,
        };
      });

      log(
        `Sending ${payloads.length} payload${payloads.length !== 1 ? "s" : ""} to ingest queue...`,
      );
      formData.append("jobs", JSON.stringify(payloads));

      const result = await dispatchStagedJobs(formData);

      const errors = result.results
        .filter((r) => !r.success)
        .map((r) => `${r.topic}: ${r.error}`);

      setDispatchResult({ queued: result.queued, errors });

      if (result.queued > 0) {
        log(
          `OK: ${result.queued} job${result.queued !== 1 ? "s" : ""} queued successfully`,
        );
        const failedTopics = new Set(
          result.results.filter((r) => !r.success).map((r) => r.topic),
        );
        setStagedJobs((prev) =>
          prev.filter(
            (j) => j.validation_status === "error" || failedTopics.has(j.topic),
          ),
        );
      }
      errors.forEach((e) => log(`ERROR: ${e}`));
    } catch (err) {
      const detail =
        err instanceof Error
          ? `${err.message}${err.stack ? "\n" + err.stack : ""}`
          : String(err);
      log(`FATAL: ${detail}`);
      setDispatchResult({ queued: 0, errors: [detail] });
    } finally {
      setDispatching(false);
    }
  }, [
    stagedJobs,
    defaults.template_id,
    selectedFormat,
    needsEnvironmentPicker,
    selectedEnvironmentId,
    needsCharacterPicker,
    selectedCharacterIds,
    log,
  ]);

  // --- Format picker ---
  // Skip format picker if format is pre-selected via initialFormat prop
  if (!selectedFormat && !initialFormat) {
    return (
      <div>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 16,
          }}
        >
          Select Content Format
        </h2>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            marginBottom: 24,
          }}
        >
          Choose the format for this batch. The ingestion UI will adapt to the
          format&apos;s requirements.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {ALL_FORMATS.map((fmt) => {
            const meta = FORMAT_META[fmt];
            const iconName = meta?.iconName ?? "menu_book";
            const hasTemplates = templates.some((t) => t.format === fmt);
            const templateCount = templates.filter(
              (t) => t.format === fmt,
            ).length;

            return (
              <button
                key={fmt}
                onClick={() => {
                  if (hasTemplates) handleFormatChange(fmt);
                }}
                disabled={!hasTemplates}
                className="v2-format-card"
                style={{
                  padding: 20,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                  borderRadius: 12,
                  textAlign: "left",
                  cursor: hasTemplates ? "pointer" : "not-allowed",
                  opacity: hasTemplates ? 1 : 0.4,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (hasTemplates) {
                    e.currentTarget.style.background =
                      "rgba(var(--v2-accent-rgb), 0.08)";
                    e.currentTarget.style.borderColor =
                      "rgba(var(--v2-accent-rgb), 0.3)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                  e.currentTarget.style.borderColor =
                    "rgba(var(--v2-accent-rgb), 0.1)";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 24,
                      color: hasTemplates
                        ? "var(--v2-accent)"
                        : "rgba(205,195,215,0.3)",
                    }}
                  >
                    {iconName}
                  </span>
                  <div style={{ flex: 1 }}>
                    <h3
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#e5e2e1",
                        margin: "0 0 4px 0",
                      }}
                    >
                      {formatDisplayName(fmt)}
                    </h3>
                    {hasTemplates && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--v2-accent)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                        }}
                      >
                        {templateCount} template{templateCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {hasTemplates && (
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 18,
                        color: "var(--v2-accent)",
                        opacity: 0.5,
                      }}
                    >
                      arrow_forward
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.6)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {meta?.description ?? ""}
                </p>
                {!hasTemplates && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "6px 10px",
                      background: "rgba(255,180,0,0.1)",
                      border: "1px solid rgba(255,180,0,0.2)",
                      borderRadius: 6,
                      fontSize: 10,
                      color: "#ffb400",
                      fontWeight: 600,
                    }}
                  >
                    No templates available
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // --- Full ingestion UI ---
  return (
    <div className="space-y-4">
      {/* Format breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => {
            setSelectedFormat("");
            setStagedJobs([]);
            setDispatchResult(null);
            setWarnings([]);
            setActivityLog([]);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            arrow_back
          </span>
          Back to formats
        </button>
        <span style={{ fontSize: 11, color: "rgba(205,195,215,0.3)" }}>/</span>
        <span
          style={{ fontSize: 13, fontWeight: 700, color: "var(--v2-accent)" }}
        >
          {formatConfig.label}
        </span>
        <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
          — {formatConfig.description}
        </span>
      </div>

      {/* Style Collection Picker — for formats that use style_collections */}
      {usesStyleCollections && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <StyleCollectionPicker
            channelId={defaults.channel_id}
            archetypeId={archetypeId ?? undefined}
            format={selectedFormat}
            selectedCollectionId={selectedCollectionId}
            onSelect={setSelectedCollectionId}
          />
        </div>
      )}

      {/* Character Picker — only for formats that need it */}
      {needsCharacterPicker && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <CharacterPicker
            channelId={defaults.channel_id}
            selectedCharacterId={selectedCharacterIds[0] ?? null}
            onSelect={(id) => setSelectedCharacterIds(id ? [id] : [])}
          />
        </div>
      )}

      {/* Environment Picker — photorealistic formats only */}
      {needsEnvironmentPicker && environments.length > 0 && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <label
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
              }}
            >
              Environment{" "}
              <span
                style={{
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "none",
                  fontWeight: 400,
                }}
              >
                (optional)
              </span>
            </label>
            {selectedEnvironmentId && (
              <button
                onClick={() => setSelectedEnvironmentId(null)}
                style={{
                  fontSize: 10,
                  color: "rgba(205,195,215,0.5)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </div>
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              marginBottom: 12,
            }}
          >
            Attaches a visual setting to every scene — injects spatial hints and
            location context into image prompts for consistent backgrounds.
          </p>
          <select
            value={selectedEnvironmentId ?? ""}
            onChange={(e) => setSelectedEnvironmentId(e.target.value || null)}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 13,
              outline: "none",
            }}
          >
            <option value="">No environment</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          {selectedEnvironmentId &&
            (() => {
              const env = environments.find(
                (e) => e.id === selectedEnvironmentId,
              );
              return env ? (
                <p
                  style={{
                    fontSize: 10,
                    color: "rgba(205,195,215,0.5)",
                    fontStyle: "italic",
                    marginTop: 8,
                  }}
                >
                  {env.description}
                </p>
              ) : null;
            })()}
        </div>
      )}

      {/* Image Generation Mode Toggle — only for formats with script-based image generation */}
      {supportsManualImageMode && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <label
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "rgba(205,195,215,0.6)",
              display: "block",
              marginBottom: 8,
            }}
          >
            Image Generation Mode
          </label>
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              marginBottom: 12,
            }}
          >
            Choose how scene images are created: AI generates them
            automatically, or you upload them manually after script approval.
          </p>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <button
              onClick={() => setImageGenerationMode("auto")}
              style={{
                flex: 1,
                padding: "12px 16px",
                background:
                  imageGenerationMode === "auto"
                    ? "var(--v2-accent)"
                    : "rgba(255,255,255,0.03)",
                border:
                  imageGenerationMode === "auto"
                    ? "none"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 8,
                color: imageGenerationMode === "auto" ? "#000" : "#e5e2e1",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                auto_awesome
              </span>
              Auto (AI Generated)
            </button>
            <button
              onClick={() => setImageGenerationMode("manual")}
              style={{
                flex: 1,
                padding: "12px 16px",
                background:
                  imageGenerationMode === "manual"
                    ? "var(--v2-accent)"
                    : "rgba(255,255,255,0.03)",
                border:
                  imageGenerationMode === "manual"
                    ? "none"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 8,
                color: imageGenerationMode === "manual" ? "#000" : "#e5e2e1",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                upload_file
              </span>
              Manual Upload
            </button>
          </div>
          {imageGenerationMode === "auto" && (
            <p
              style={{
                fontSize: 10,
                color: "rgba(205,195,215,0.5)",
                fontStyle: "italic",
              }}
            >
              AI automatically generates scene images from script → Image QC →
              Render. Fully automated workflow.
            </p>
          )}
          {imageGenerationMode === "manual" && (
            <p
              style={{
                fontSize: 10,
                color: "rgba(205,195,215,0.5)",
                fontStyle: "italic",
              }}
            >
              Job pauses at Image QC. Production VA uploads manually-created
              images, then resumes to Render. Ideal for custom artwork or
              specific visual requirements.
            </p>
          )}
        </div>
      )}

      {/* Batch Defaults */}
      <BatchDefaultsPanel
        templates={formatTemplates}
        channels={channels}
        defaults={defaults}
        onChange={handleDefaultsChange}
        format={selectedFormat}
      />

      {/* No templates warning */}
      {formatTemplates.length === 0 && (
        <div className="px-4 py-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
          No active templates for {formatConfig.label}. Add a template in
          Settings first.
        </div>
      )}

      {/* Asset Drop Zones */}
      {selectedFormat && (
        <AssetDropZones
          format={selectedFormat}
          onAssetsChange={handleAssetsChange}
          onWarnings={handleWarnings}
        />
      )}

      {/* Bundestag Clip Paths — file path input for pre-uploaded videos */}
      {selectedFormat === "BUNDESTAG" && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <label
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "rgba(205,195,215,0.6)",
              display: "block",
              marginBottom: 8,
            }}
          >
            Video Clip File Paths
          </label>
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              marginBottom: 12,
            }}
          >
            Enter absolute paths to pre-uploaded video files (one per line).
            Files must be uploaded to the server via SCP before creating the
            job.
          </p>
          <textarea
            value={clipPaths}
            onChange={(e) => setClipPaths(e.target.value)}
            rows={6}
            placeholder="/opt/content-forge/media/bundestag/staging/clip1.mp4&#10;/opt/content-forge/media/bundestag/staging/clip2.mp4&#10;/opt/content-forge/media/bundestag/staging/clip3.mp4"
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 12,
              fontFamily: "monospace",
              outline: "none",
              resize: "vertical",
            }}
          />
          <p
            style={{
              fontSize: 10,
              color: "rgba(205,195,215,0.5)",
              fontStyle: "italic",
              marginTop: 8,
            }}
          >
            Note: TUS upload is deferred to Phase 2. For now, manually stage
            files via SCP and provide absolute paths here.
          </p>
        </div>
      )}

      {/* Manual Job Creation */}
      {selectedFormat && (
        <ManualJobCreator
          onCreateJob={handleCreateJobFromTopic}
          topicPlaceholder={formatConfig.topicPlaceholder}
        />
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <ErrorLogPanel
          title="Warnings"
          messages={warnings}
          type="warning"
          onDismiss={() => setWarnings([])}
        />
      )}

      {/* Dispatch Result */}
      {dispatchResult && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          {dispatchResult.queued > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <p style={{ fontSize: 13, color: "var(--v2-success)" }}>
                {dispatchResult.queued} job
                {dispatchResult.queued !== 1 ? "s" : ""} queued successfully
              </p>
              <button
                onClick={() => router.push("/jobs")}
                className="v2-btn-accent"
              >
                View Jobs
              </button>
            </div>
          )}
          {dispatchResult.errors.length > 0 && (
            <ErrorLogPanel
              title="Dispatch Errors"
              messages={dispatchResult.errors}
              type="error"
              onDismiss={() => setDispatchResult(null)}
            />
          )}
        </div>
      )}

      {/* Staging Table */}
      <StagingTable
        jobs={stagedJobs}
        channels={channels}
        onUpdateJob={handleUpdateJob}
        onDeleteJob={handleDeleteJob}
        onDeleteSelected={(ids) => {
          const set = new Set(ids);
          setStagedJobs((prev) => prev.filter((j) => !set.has(j.id)));
        }}
        onClearAll={handleClearAll}
        onDispatch={handleDispatch}
        onDispatchSelected={(ids) => {
          const set = new Set(ids);
          const valid = stagedJobs.filter(
            (j) => set.has(j.id) && j.validation_status !== "error",
          );
          if (valid.length > 0) handleDispatch();
        }}
        dispatching={dispatching}
        videoLabel={formatConfig.videoLabel}
        scriptLabel={formatConfig.scriptLabel}
        topicPlaceholder={formatConfig.topicPlaceholder}
      />

      {/* Activity Log */}
      <ActivityLog entries={activityLog} onClear={() => setActivityLog([])} />
    </div>
  );
}

// --- Manual Job Creator ---

function ManualJobCreator({
  onCreateJob,
  topicPlaceholder = "Enter topic...",
}: {
  onCreateJob: (topic: string) => void;
  topicPlaceholder?: string;
}) {
  const [topic, setTopic] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (topic.trim()) {
      onCreateJob(topic);
      setTopic("");
    }
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h3
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(205,195,215,0.6)",
          margin: "0 0 12px 0",
        }}
      >
        Create Job
      </h3>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12 }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={topicPlaceholder}
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 8,
            color: "#e5e2e1",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!topic.trim()}
          style={{
            padding: "12px 24px",
            background: topic.trim()
              ? "var(--v2-accent)"
              : "rgba(255,255,255,0.05)",
            border: "none",
            borderRadius: 8,
            color: topic.trim() ? "#000" : "rgba(205,195,215,0.3)",
            fontSize: 13,
            fontWeight: 600,
            cursor: topic.trim() ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "all 0.2s ease",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            add
          </span>
          Add Job
        </button>
      </form>
      <p
        style={{
          fontSize: 10,
          color: "rgba(205,195,215,0.5)",
          margin: "8px 0 0 0",
        }}
      >
        Enter a topic and click Add Job to stage it for dispatch. Add multiple
        jobs, then dispatch all at once.
      </p>
    </div>
  );
}

// --- Error Log Panel ---

function ErrorLogPanel({
  title,
  messages,
  type,
  onDismiss,
}: {
  title: string;
  messages: string[];
  type: "warning" | "error";
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const fullLog = `[${title}] ${new Date().toISOString()}\n${messages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;

  const borderColor =
    type === "error" ? "rgba(255,80,80,0.3)" : "rgba(255,180,0,0.3)";
  const bgColor =
    type === "error" ? "rgba(255,80,80,0.1)" : "rgba(255,180,0,0.1)";
  const textColor = type === "error" ? "#ff8080" : "#ffb400";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = fullLog;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color: textColor }}
          >
            {type === "error" ? "error" : "warning"}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
            {title} ({messages.length})
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              background: "none",
              border: "none",
              borderRadius: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              cursor: "pointer",
            }}
            title="Copy error log to clipboard"
          >
            {copied ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14, color: "var(--v2-success)" }}
                >
                  check
                </span>
                <span style={{ color: "var(--v2-success)" }}>Copied</span>
              </>
            ) : (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  content_copy
                </span>
                <span>Copy Log</span>
              </>
            )}
          </button>
          <button
            onClick={onDismiss}
            style={{
              padding: "4px 8px",
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div style={{ padding: "12px 16px", maxHeight: 200, overflowY: "auto" }}>
        {messages.map((msg, i) => (
          <p
            key={i}
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              fontFamily: "monospace",
              marginBottom: 4,
              wordBreak: "break-all",
            }}
          >
            {msg}
          </p>
        ))}
      </div>
    </div>
  );
}

// --- Activity Log Panel ---

function ActivityLog({
  entries,
  onClear,
}: {
  entries: string[];
  onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (entries.length === 0) return null;

  const fullLog = entries.join("\n");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = fullLog;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color: "rgba(205,195,215,0.6)" }}
          >
            terminal
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(205,195,215,0.6)",
            }}
          >
            Activity Log ({entries.length})
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              background: "none",
              border: "none",
              borderRadius: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              cursor: "pointer",
            }}
            title="Copy full log"
          >
            {copied ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14, color: "var(--v2-success)" }}
                >
                  check
                </span>
                <span style={{ color: "var(--v2-success)" }}>Copied</span>
              </>
            ) : (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  content_copy
                </span>
                <span>Copy Log</span>
              </>
            )}
          </button>
          <button
            onClick={onClear}
            style={{
              padding: "4px 8px",
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        style={{
          padding: "12px 16px",
          maxHeight: 250,
          overflowY: "auto",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {entries.map((entry, i) => {
          let color = "rgba(205,195,215,0.6)";
          if (entry.includes("ERROR") || entry.includes("FATAL"))
            color = "#ff8080";
          else if (entry.includes("WARN")) color = "#ffb400";
          else if (entry.includes("OK:")) color = "var(--v2-success)";

          return (
            <p
              key={i}
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color,
                lineHeight: 1.6,
                marginBottom: 2,
                wordBreak: "break-all",
              }}
            >
              {entry}
            </p>
          );
        })}
      </div>
    </div>
  );
}
