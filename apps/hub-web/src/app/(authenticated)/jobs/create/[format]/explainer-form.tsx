"use client";

import { useState, useEffect } from "react";
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

interface ExplainerFormProps {
  channels: Channel[];
  templates: Template[];
}

export function ExplainerForm({ channels, templates }: ExplainerFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [narrationPath, setNarrationPath] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [advanced, setAdvanced] = useState<AdvancedOptions>(DEFAULT_ADVANCED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "EXPLAINER",
      channel_id: channelId,
      template_id: templateId,
      language: advanced.language,
      production_version: advanced.production_version,
      skip_image_qc: advanced.skip_image_qc,
      skip_final_qc: advanced.skip_final_qc,
    });
  }, [channelId, templateId, advanced]);

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
    setLoading(true);
    setError(null);
    const result = await createJob({
      channel_id: channelId,
      format: "EXPLAINER",
      template_id: templateId,
      initial_topic: topic.trim() || undefined,
      script_text: scriptText.trim() || undefined,
      narration_source_path: narrationPath.trim() || undefined,
      ...advanced,
    });
    if (result.success) {
      router.push("/jobs");
    } else {
      setError(result.error ?? "Failed to create job");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={sectionStyle}>
      <div>
        <label style={labelStyle}>Topic</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. How quantum computing works"
          style={inputStyle}
        />
        <p
          style={{ fontSize: 10, color: "rgba(205,195,215,0.4)", marginTop: 4 }}
        >
          Required unless you provide a script below
        </p>
      </div>

      {templates.length > 1 && (
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
        </div>
      )}

      <div>
        <label style={labelStyle}>Channel</label>
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          style={selectStyle}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Script{" "}
          <span
            style={{
              color: "rgba(205,195,215,0.4)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            optional — skips AI scripting
          </span>
        </label>
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          rows={8}
          placeholder="Paste a pre-written script here..."
          style={textareaStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>
          Narration File Path{" "}
          <span
            style={{
              color: "rgba(205,195,215,0.4)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            optional — skips TTS
          </span>
        </label>
        <input
          type="text"
          value={narrationPath}
          onChange={(e) => setNarrationPath(e.target.value)}
          placeholder="/opt/content-forge/media/channel/job/narration.mp3"
          style={inputStyle}
        />
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
