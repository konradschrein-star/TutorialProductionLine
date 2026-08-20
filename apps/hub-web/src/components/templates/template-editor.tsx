"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTemplate, toggleTemplateActive } from "@/app/actions/templates";
import type { Template } from "@/lib/repositories/template-repository";

/**
 * Template Editor Component
 *
 * Two-column layout: form on left, JSON preview on right.
 * Validates JSONB fields with client-side parsing before submission.
 */

interface TemplateEditorProps {
  template: Template;
}

// Shared V2 input style
const inputCls = `
  w-full px-3 py-2 text-sm font-mono
  bg-[#111] border border-[rgba(75,68,85,0.4)] rounded-lg
  text-[#e5e2e1] placeholder:text-[rgba(205,195,215,0.3)]
  focus:outline-none focus:border-[var(--v2-accent,#aaff00)]
  transition-colors
`
  .replace(/\s+/g, " ")
  .trim();

const textCls = `
  w-full px-3 py-2 text-sm
  bg-[#111] border border-[rgba(75,68,85,0.4)] rounded-lg
  text-[#e5e2e1] placeholder:text-[rgba(205,195,215,0.3)]
  focus:outline-none focus:border-[var(--v2-accent,#aaff00)]
  transition-colors
`
  .replace(/\s+/g, " ")
  .trim();

const cardCls =
  "bg-[#151515] border border-[rgba(255,255,255,0.07)] rounded-xl p-6";
const subPanelCls =
  "bg-[#0e0e0e] border border-[rgba(75,68,85,0.2)] rounded-lg p-4 space-y-4";
const labelCls =
  "block text-xs font-semibold text-[rgba(205,195,215,0.7)] mb-1.5 uppercase tracking-wide";
const dimCls = "text-[10px] text-[rgba(205,195,215,0.3)] mt-1";
const errorCls = "mt-1 text-[11px] text-[#ffb4ab]";

export function TemplateEditor({ template }: TemplateEditorProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || "");
  const [format, setFormat] = useState(template.format);
  const [pipelineStages, setPipelineStages] = useState<string[]>(
    template.pipeline_stages,
  );
  const [prompts, setPrompts] = useState<Record<string, any>>(template.prompts);
  const [renderConfig, setRenderConfig] = useState<Record<string, any>>(
    template.render_config,
  );
  const [requiredAssets, setRequiredAssets] = useState<string[]>(
    template.required_assets,
  );
  const [supportsCharacterTracking, setSupportsCharacterTracking] = useState(
    template.supports_character_tracking ?? false,
  );

  const [pipelineStagesJson, setPipelineStagesJson] = useState(
    JSON.stringify(template.pipeline_stages, null, 2),
  );
  const [promptsJson, setPromptsJson] = useState(
    JSON.stringify(template.prompts, null, 2),
  );
  const [renderConfigJson, setRenderConfigJson] = useState(
    JSON.stringify(template.render_config, null, 2),
  );
  const [requiredAssetsJson, setRequiredAssetsJson] = useState(
    JSON.stringify(template.required_assets, null, 2),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const generatePreview = () => {
    try {
      return JSON.stringify(
        {
          id: template.id,
          name,
          description: description || null,
          format,
          pipeline_stages: pipelineStages,
          prompts,
          render_config: renderConfig,
          required_assets: requiredAssets,
          is_active: template.is_active,
          created_at: template.created_at,
          updated_at: template.updated_at,
        },
        null,
        2,
      );
    } catch {
      return "// Invalid JSON in one or more fields";
    }
  };

  const validateAndParseJson = (
    field: string,
    json: string,
    expectedType: "array" | "object",
  ): any | null => {
    try {
      const parsed = JSON.parse(json);
      if (expectedType === "array" && !Array.isArray(parsed)) {
        setErrors((prev) => ({
          ...prev,
          [field]: "Must be a valid JSON array",
        }));
        return null;
      }
      if (expectedType === "object" && typeof parsed !== "object") {
        setErrors((prev) => ({
          ...prev,
          [field]: "Must be a valid JSON object",
        }));
        return null;
      }
      setErrors((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
      return parsed;
    } catch {
      setErrors((prev) => ({ ...prev, [field]: "Invalid JSON syntax" }));
      return null;
    }
  };

  const handlePipelineStagesChange = (value: string) => {
    setPipelineStagesJson(value);
    const parsed = validateAndParseJson("pipeline_stages", value, "array");
    if (parsed !== null) setPipelineStages(parsed);
  };

  const handlePromptsChange = (value: string) => {
    setPromptsJson(value);
    const parsed = validateAndParseJson("prompts", value, "object");
    if (parsed !== null) setPrompts(parsed);
  };

  const handleRenderConfigChange = (value: string) => {
    setRenderConfigJson(value);
    const parsed = validateAndParseJson("render_config", value, "object");
    if (parsed !== null) setRenderConfig(parsed);
  };

  function getPacing(): Record<string, unknown> {
    return ((renderConfig as any)?.pacing ?? {}) as Record<string, unknown>;
  }

  function setPacingField(field: string, value: unknown): void {
    const newConfig = {
      ...(renderConfig as any),
      pacing: { ...getPacing(), [field]: value },
    };
    handleRenderConfigChange(JSON.stringify(newConfig));
  }

  const handleRequiredAssetsChange = (value: string) => {
    setRequiredAssetsJson(value);
    const parsed = validateAndParseJson("required_assets", value, "array");
    if (parsed !== null) setRequiredAssets(parsed);
  };

  const handleSave = async () => {
    if (Object.keys(errors).length > 0) {
      alert("Please fix validation errors before saving");
      return;
    }
    setLoading(true);
    const result = await updateTemplate(template.id, {
      name,
      description: description || null,
      format,
      pipeline_stages: pipelineStages,
      prompts,
      render_config: renderConfig,
      required_assets: requiredAssets,
      supports_character_tracking: supportsCharacterTracking,
    });
    if (result.success) {
      router.refresh();
      alert("Template updated successfully");
    } else {
      alert(result.error || "Failed to update template");
    }
    setLoading(false);
  };

  const handleToggleActive = async () => {
    setLoading(true);
    const result = await toggleTemplateActive(template.id, !template.is_active);
    if (result.success) router.refresh();
    else alert(result.error || "Failed to toggle template status");
    setLoading(false);
  };

  // Option button style (selected / unselected)
  const optBtn = (selected: boolean) =>
    `px-3 py-2 rounded-lg border text-left transition-colors ${
      selected
        ? "border-[var(--v2-accent,#aaff00)] bg-[rgba(170,255,0,0.08)] text-[#e5e2e1]"
        : "border-[rgba(75,68,85,0.4)] bg-[#111] text-[rgba(205,195,215,0.55)] hover:border-[rgba(170,255,0,0.35)]"
    }`;

  // Toggle switch
  const Toggle = ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: "relative",
        display: "inline-flex",
        width: 44,
        height: 24,
        borderRadius: 9999,
        transition: "background 0.2s",
        background: checked
          ? "var(--v2-accent, #aaff00)"
          : "rgba(75,68,85,0.5)",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 4,
          left: checked ? 24 : 4,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#cdc3d7",
          transition: "left 0.15s",
        }}
      />
    </button>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ---- Left column: Form ---- */}
      <div className="space-y-6">
        {/* Basic Info */}
        <div className={cardCls}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
            Basic Info
          </h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={textCls}
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={textCls}
              />
            </div>
            <div>
              <label className={labelCls}>Format</label>
              <input
                type="text"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className={textCls}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "rgba(205,195,215,0.7)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 2,
                  }}
                >
                  Per-scene character tracking
                </div>
                <div style={{ fontSize: 10, color: "rgba(205,195,215,0.3)" }}>
                  Track which characters appear in each scene for consistent
                  generation
                </div>
              </div>
              <Toggle
                checked={supportsCharacterTracking}
                onChange={() => setSupportsCharacterTracking((v) => !v)}
              />
            </div>
          </div>
        </div>

        {/* Pipeline Stages */}
        <div className={cardCls}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
            Pipeline Stages
          </h2>
          <div>
            <label className={labelCls}>Stages (JSON Array)</label>
            <textarea
              value={pipelineStagesJson}
              onChange={(e) => handlePipelineStagesChange(e.target.value)}
              rows={6}
              className={inputCls}
            />
            {errors.pipeline_stages && (
              <p className={errorCls}>{errors.pipeline_stages}</p>
            )}
          </div>
        </div>

        {/* Prompts */}
        <div className={cardCls}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
            Prompts
          </h2>
          <div>
            <label className={labelCls}>Prompts (JSON Object)</label>
            <textarea
              value={promptsJson}
              onChange={(e) => handlePromptsChange(e.target.value)}
              rows={8}
              className={inputCls}
            />
            {errors.prompts && <p className={errorCls}>{errors.prompts}</p>}
          </div>
        </div>

        {/* Render Config */}
        <div className={cardCls}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
            Render Config
          </h2>
          <div className="space-y-6">
            {/* Pacing sliders */}
            <div className={subPanelCls}>
              <h3 className="text-xs font-semibold text-[#e5e2e1]">Pacing</h3>

              {/* Hook duration */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Hook Duration (seconds)
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {renderConfig.hook_duration_seconds ?? 30}s
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={120}
                  step={5}
                  value={renderConfig.hook_duration_seconds ?? 30}
                  onChange={(e) => {
                    const updated = {
                      ...renderConfig,
                      hook_duration_seconds: Number(e.target.value),
                    };
                    setRenderConfig(updated);
                    setRenderConfigJson(JSON.stringify(updated, null, 2));
                  }}
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>5s</span>
                  <span>120s</span>
                </div>
              </div>

              {/* Hook scene duration */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Hook Scene Duration (seconds)
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {renderConfig.hook_scene_seconds ?? 1.5}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={renderConfig.hook_scene_seconds ?? 1.5}
                  onChange={(e) => {
                    const updated = {
                      ...renderConfig,
                      hook_scene_seconds: Number(e.target.value),
                    };
                    setRenderConfig(updated);
                    setRenderConfigJson(JSON.stringify(updated, null, 2));
                  }}
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>0.5s</span>
                  <span>5s</span>
                </div>
              </div>
            </div>

            {/* Image Pacing */}
            <div className={subPanelCls}>
              <h3 className="text-xs font-semibold text-[#e5e2e1]">
                Image Pacing
              </h3>

              {/* Sub-sentence toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-[rgba(205,195,215,0.6)]">
                    Sub-sentence splitting in intro
                  </div>
                  <div className={dimCls}>
                    Intro images switch at comma/clause level for faster visual
                    pace
                  </div>
                </div>
                <Toggle
                  checked={getPacing().hook_use_subsentences !== false}
                  onChange={() =>
                    setPacingField(
                      "hook_use_subsentences",
                      getPacing().hook_use_subsentences !== false
                        ? false
                        : true,
                    )
                  }
                />
              </div>

              {/* Early body end pct */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Early body ends at
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {(getPacing().early_body_end_pct as number) ?? 50}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={(getPacing().early_body_end_pct as number) ?? 50}
                  onChange={(e) =>
                    setPacingField("early_body_end_pct", Number(e.target.value))
                  }
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>10%</span>
                  <span>90%</span>
                </div>
                <p className={dimCls}>
                  After this % of scenes, images group 2-4 sentences each
                </p>
              </div>

              {/* Late body min */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Late body — min sentences/image
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {(getPacing()
                      .late_body_sentences_per_image_min as number) ?? 2}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={
                    (getPacing().late_body_sentences_per_image_min as number) ??
                    2
                  }
                  onChange={(e) =>
                    setPacingField(
                      "late_body_sentences_per_image_min",
                      Number(e.target.value),
                    )
                  }
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>1</span>
                  <span>4</span>
                </div>
              </div>

              {/* Late body max */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Late body — max sentences/image
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {(getPacing()
                      .late_body_sentences_per_image_max as number) ?? 4}
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={
                    (getPacing().late_body_sentences_per_image_max as number) ??
                    4
                  }
                  onChange={(e) =>
                    setPacingField(
                      "late_body_sentences_per_image_max",
                      Number(e.target.value),
                    )
                  }
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>2</span>
                  <span>8</span>
                </div>
              </div>

              {/* Max image duration */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Max image duration
                  </label>
                  <span className="text-xs font-mono text-[#e5e2e1]">
                    {(getPacing().max_image_duration_seconds as number) ?? 30}s
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={
                    (getPacing().max_image_duration_seconds as number) ?? 30
                  }
                  onChange={(e) =>
                    setPacingField(
                      "max_image_duration_seconds",
                      Number(e.target.value),
                    )
                  }
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.3)",
                    marginTop: 2,
                  }}
                >
                  <span>5s</span>
                  <span>60s</span>
                </div>
                <p className={dimCls}>
                  Hard cap on how long one image can show
                </p>
              </div>

              {/* KEY_FACT trigger */}
              <div>
                <label className="block text-xs text-[rgba(205,195,215,0.6)] mb-2">
                  KEY_FACT trigger
                </label>
                <div className="flex flex-col gap-2">
                  {(
                    [
                      {
                        value: "content_detection",
                        label: "Content detection (numbers, %, $)",
                      },
                      { value: "claude_flagged", label: "Claude-flagged" },
                      { value: "disabled", label: "Disabled" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setPacingField("key_fact_trigger", opt.value)
                      }
                      className={optBtn(
                        ((getPacing().key_fact_trigger as string) ??
                          "content_detection") === opt.value,
                      )}
                    >
                      <div className="text-xs font-medium">{opt.label}</div>
                    </button>
                  ))}
                </div>
                <p className={dimCls}>
                  When to show a text card instead of B-roll for a sentence
                </p>
              </div>
            </div>

            {/* Image Generation */}
            <div className={subPanelCls}>
              <h3 className="text-xs font-semibold text-[#e5e2e1]">
                Image Generation
              </h3>

              {/* Model selector */}
              <div>
                <label className="block text-xs text-[rgba(205,195,215,0.6)] mb-2">
                  Image Model
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      {
                        value: "seedream",
                        label: "Seedream 4.5",
                        sub: "ByteDance · 2K",
                      },
                      {
                        value: "nanob2",
                        label: "Nano Banana 2",
                        sub: "Google · 1K",
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const updated = {
                          ...renderConfig,
                          image_model: opt.value,
                        };
                        setRenderConfig(updated);
                        setRenderConfigJson(JSON.stringify(updated, null, 2));
                      }}
                      className={`flex-1 ${optBtn((renderConfig.image_model ?? "seedream") === opt.value)}`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className={dimCls}>
                        {opt.sub} · other auto-fallback
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Misgeneration tolerance */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[rgba(205,195,215,0.6)]">
                    Misgeneration Tolerance
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={renderConfig.misgeneration_tolerance_pct ?? 15}
                      onChange={(e) => {
                        const val = Math.max(
                          0,
                          Math.min(100, Number(e.target.value)),
                        );
                        const updated = {
                          ...renderConfig,
                          misgeneration_tolerance_pct: val,
                        };
                        setRenderConfig(updated);
                        setRenderConfigJson(JSON.stringify(updated, null, 2));
                      }}
                      className="w-14 px-2 py-1 bg-[#111] border border-[rgba(75,68,85,0.4)] rounded text-xs text-right font-mono text-[#e5e2e1] focus:outline-none"
                    />
                    <span className="text-xs text-[rgba(205,195,215,0.55)]">
                      %
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={renderConfig.misgeneration_tolerance_pct ?? 15}
                  onChange={(e) => {
                    const updated = {
                      ...renderConfig,
                      misgeneration_tolerance_pct: Number(e.target.value),
                    };
                    setRenderConfig(updated);
                    setRenderConfigJson(JSON.stringify(updated, null, 2));
                  }}
                  className="w-full"
                  style={{ accentColor: "var(--v2-accent, #aaff00)" }}
                />
                <p className={dimCls}>
                  Allow render if this % of scene images or fewer are
                  missing/failed
                </p>
              </div>

              {/* QC review toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-[rgba(205,195,215,0.6)]">
                    Image QC Review Required
                  </div>
                  <div className={dimCls}>
                    Pause job for VA to review scene images before rendering
                  </div>
                </div>
                <Toggle
                  checked={!!renderConfig.qc_image_review_required}
                  onChange={() => {
                    const updated = {
                      ...renderConfig,
                      qc_image_review_required:
                        !renderConfig.qc_image_review_required,
                    };
                    setRenderConfig(updated);
                    setRenderConfigJson(JSON.stringify(updated, null, 2));
                  }}
                />
              </div>
            </div>

            {/* Advanced JSON */}
            <div>
              <label className={labelCls}>Render Config (JSON)</label>
              <textarea
                value={renderConfigJson}
                onChange={(e) => handleRenderConfigChange(e.target.value)}
                rows={8}
                className={inputCls}
              />
              {errors.render_config && (
                <p className={errorCls}>{errors.render_config}</p>
              )}
            </div>
          </div>
        </div>

        {/* Required Assets */}
        <div className={cardCls}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
            Required Assets
          </h2>
          <div>
            <label className={labelCls}>Required Assets (JSON Array)</label>
            <textarea
              value={requiredAssetsJson}
              onChange={(e) => handleRequiredAssetsChange(e.target.value)}
              rows={6}
              className={inputCls}
            />
            {errors.required_assets && (
              <p className={errorCls}>{errors.required_assets}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={loading || Object.keys(errors).length > 0}
            className="v2-btn-accent"
            style={{
              opacity: loading || Object.keys(errors).length > 0 ? 0.5 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              save
            </span>
            Save Changes
          </button>
          <button
            onClick={handleToggleActive}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              transition: "background 0.15s",
              opacity: loading ? 0.5 : 1,
              ...(template.is_active
                ? { background: "rgba(249,115,22,0.1)", color: "#f97316" }
                : { background: "rgba(35,222,203,0.1)", color: "#23decb" }),
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              power_settings_new
            </span>
            {template.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>

      {/* ---- Right column: JSON Preview ---- */}
      <div className={`${cardCls} h-fit sticky top-6`}>
        <h2 className="text-xs font-bold uppercase tracking-widest text-[rgba(205,195,215,0.5)] mb-4">
          JSON Preview
        </h2>
        <pre
          className="text-xs whitespace-pre-wrap font-mono overflow-x-auto rounded-lg p-4"
          style={{
            background: "#0e0e0e",
            color: "#e5e2e1",
            maxHeight: "calc(100vh - 200px)",
            overflowY: "auto",
            lineHeight: 1.6,
          }}
        >
          {generatePreview()}
        </pre>
      </div>
    </div>
  );
}
