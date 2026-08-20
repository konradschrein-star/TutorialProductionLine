"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createJob } from "@/app/actions/create-job";
import { SubmitButton } from "../_components/submit-button";
import {
  labelStyle,
  inputStyle,
  selectStyle,
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

interface BundestagFormProps {
  channels: Channel[];
  templates: Template[];
}

const LANGUAGES = [
  { value: "de", label: "German (default)" },
  { value: "en", label: "English" },
];

export function BundestagForm({ channels, templates }: BundestagFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [clipPaths, setClipPaths] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [language, setLanguage] = useState("de");
  const [skipImageQc, setSkipImageQc] = useState(false);
  const [skipFinalQc, setSkipFinalQc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadJobCreationSession();
    if (!saved) return;
    if (saved.channel_id && channels.find((c) => c.id === saved.channel_id))
      setChannelId(saved.channel_id);
    if (saved.template_id && templates.find((t) => t.id === saved.template_id))
      setTemplateId(saved.template_id);
    if (saved.language) setLanguage(saved.language);
    if (saved.skip_image_qc !== undefined) setSkipImageQc(saved.skip_image_qc!);
    if (saved.skip_final_qc !== undefined) setSkipFinalQc(saved.skip_final_qc!);
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "BUNDESTAG",
      channel_id: channelId,
      template_id: templateId,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
    });
  }, [channelId, templateId, language, skipImageQc, skipFinalQc]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setError("Topic / session description is required");
      return;
    }
    if (!templateId) {
      setError("Please select a template");
      return;
    }
    setLoading(true);
    setError(null);

    // Single-stream architecture: the pipeline only ever processes one clip
    // path (see bundestag-payloads.ts) — the field stays an array for API
    // compatibility, but only ever holds this one entry.
    const trimmedPath = clipPaths.trim();

    const result = await createJob({
      channel_id: channelId,
      format: "BUNDESTAG",
      template_id: templateId,
      initial_topic: topic.trim(),
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
      bundestag_clip_paths: trimmedPath ? [trimmedPath] : undefined,
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
        <label style={labelStyle}>Session / Topic Description *</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Haushaltsdebatte 2026 — SPD vs CDU"
          style={inputStyle}
          required
        />
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
          Pre-uploaded Clip Path{" "}
          <span
            style={{
              color: "rgba(205,195,215,0.4)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            optional — single video file, camera angles already switched in the
            source stream
          </span>
        </label>
        <input
          type="text"
          value={clipPaths}
          onChange={(e) => setClipPaths(e.target.value)}
          placeholder="/opt/content-forge/media/bundestag/session.mp4"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 8,
            color: "#e5e2e1",
            fontSize: 12,
            outline: "none",
            fontFamily: "monospace",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={selectStyle}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={skipImageQc}
              onChange={(e) => setSkipImageQc(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              Skip Image QC
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={skipFinalQc}
              onChange={(e) => setSkipFinalQc(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              Skip Final QC
            </span>
          </label>
        </div>
      </div>

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

      <SubmitButton loading={loading} disabled={!topic.trim()} />
    </form>
  );
}
