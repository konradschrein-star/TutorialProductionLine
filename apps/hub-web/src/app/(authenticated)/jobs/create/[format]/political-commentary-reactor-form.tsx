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

interface PoliticalCommentaryReactorFormProps {
  channels: Channel[];
  templates: Template[];
}

const sliderLabelStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 4,
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#a855f7",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(205,195,215,0.4)",
  marginTop: 4,
};

export function PoliticalCommentaryReactorForm({
  channels,
  templates,
}: PoliticalCommentaryReactorFormProps) {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [ttsProvider, setTtsProvider] = useState<"elevenlabs" | "minimax">(
    "elevenlabs",
  );
  const [ttsVoiceId, setTtsVoiceId] = useState("");
  const [avatarPath, setAvatarPath] = useState("");
  const [avatarIntensity, setAvatarIntensity] = useState(0.6);
  const [maxScaleDelta, setMaxScaleDelta] = useState(0.05);
  const [saturationBoost, setSaturationBoost] = useState(5);
  const [sourceAttribution, setSourceAttribution] = useState("");
  const [advanced, setAdvanced] = useState<AdvancedOptions>({
    ...DEFAULT_ADVANCED,
    language: "de",
  });
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
    if (saved.skip_final_qc !== undefined)
      setAdvanced((a) => ({ ...a, skip_final_qc: saved.skip_final_qc! }));
    if (saved.reactor_tts_provider) setTtsProvider(saved.reactor_tts_provider);
    if (saved.reactor_tts_voice_id) setTtsVoiceId(saved.reactor_tts_voice_id);
    if (saved.reactor_avatar_intensity != null)
      setAvatarIntensity(saved.reactor_avatar_intensity);
    if (saved.reactor_max_scale_delta != null)
      setMaxScaleDelta(saved.reactor_max_scale_delta);
    if (saved.reactor_saturation_boost != null)
      setSaturationBoost(saved.reactor_saturation_boost);
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "POLITICAL_COMMENTARY_REACTOR",
      channel_id: channelId,
      template_id: templateId,
      language: advanced.language,
      production_version: advanced.production_version,
      skip_final_qc: advanced.skip_final_qc,
      reactor_tts_provider: ttsProvider,
      reactor_tts_voice_id: ttsVoiceId || undefined,
      reactor_avatar_intensity: avatarIntensity,
      reactor_max_scale_delta: maxScaleDelta,
      reactor_saturation_boost: saturationBoost,
    });
  }, [
    channelId,
    templateId,
    advanced,
    ttsProvider,
    ttsVoiceId,
    avatarIntensity,
    maxScaleDelta,
    saturationBoost,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!youtubeUrl.trim()) {
      setError("YouTube URL is required");
      return;
    }
    if (!ttsVoiceId.trim()) {
      setError("TTS Voice ID is required");
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
      format: "POLITICAL_COMMENTARY_REACTOR",
      template_id: templateId,
      initial_topic: youtubeUrl.trim(),
      metadata: {
        youtube_url: youtubeUrl.trim(),
        tts_provider: ttsProvider,
        tts_voice_id: ttsVoiceId.trim(),
        avatar_path: avatarPath.trim() || null,
        avatar_animation: {
          intensity: avatarIntensity,
          max_scale_delta: maxScaleDelta,
        },
        overlay: {
          saturation_boost: saturationBoost,
          source_attribution: sourceAttribution.trim(),
        },
      },
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
        <label style={labelStyle}>YouTube URL</label>
        <input
          type="url"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={inputStyle}
          required
        />
        <p style={hintStyle}>
          The video will be downloaded, auto-transcribed with FasterWhisper, and
          used as the reference for your reactor commentary.
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div>
          <label style={labelStyle}>TTS Provider</label>
          <select
            value={ttsProvider}
            onChange={(e) =>
              setTtsProvider(e.target.value as "elevenlabs" | "minimax")
            }
            style={selectStyle}
          >
            <option value="elevenlabs">ElevenLabs</option>
            <option value="minimax">Minimax</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>TTS Voice ID</label>
          <input
            type="text"
            value={ttsVoiceId}
            onChange={(e) => setTtsVoiceId(e.target.value)}
            placeholder="e.g. pNInz6obpgDQGcFmaJgB"
            style={inputStyle}
            required
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          Avatar Image Path{" "}
          <span
            style={{
              color: "rgba(205,195,215,0.4)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            optional
          </span>
        </label>
        <input
          type="text"
          value={avatarPath}
          onChange={(e) => setAvatarPath(e.target.value)}
          placeholder="/opt/content-forge/media/avatars/my-avatar.png"
          style={inputStyle}
        />
        <p style={hintStyle}>
          Absolute path to a PNG with transparent background on the VPS. Shown
          as animated commentator overlay.
        </p>
      </div>

      <div>
        <div style={sliderLabelStyle}>
          <label style={{ ...labelStyle, margin: 0 }}>
            Avatar Animation Intensity
          </label>
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            {avatarIntensity.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1.0}
          step={0.05}
          value={avatarIntensity}
          onChange={(e) => setAvatarIntensity(parseFloat(e.target.value))}
          style={sliderStyle}
        />
        <p style={hintStyle}>
          How much the avatar bounces to audio volume. 0.1 = subtle, 1.0 =
          exaggerated.
        </p>
      </div>

      <div>
        <div style={sliderLabelStyle}>
          <label style={{ ...labelStyle, margin: 0 }}>Max Scale Delta</label>
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            ±{(maxScaleDelta * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min={0.0}
          max={0.1}
          step={0.01}
          value={maxScaleDelta}
          onChange={(e) => setMaxScaleDelta(parseFloat(e.target.value))}
          style={sliderStyle}
        />
        <p style={hintStyle}>
          Maximum scale change driven by audio amplitude. Default ±5%.
        </p>
      </div>

      <div>
        <div style={sliderLabelStyle}>
          <label style={{ ...labelStyle, margin: 0 }}>
            Video Saturation Boost
          </label>
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            +{saturationBoost}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={15}
          step={1}
          value={saturationBoost}
          onChange={(e) => setSaturationBoost(parseInt(e.target.value))}
          style={sliderStyle}
        />
        <p style={hintStyle}>
          Extra color saturation applied to the reference video frame. Default
          +5%.
        </p>
      </div>

      <div>
        <label style={labelStyle}>
          Source Attribution{" "}
          <span
            style={{
              color: "rgba(205,195,215,0.4)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            optional
          </span>
        </label>
        <input
          type="text"
          value={sourceAttribution}
          onChange={(e) => setSourceAttribution(e.target.value)}
          placeholder="e.g. ARD Talkshow · 2024"
          style={inputStyle}
        />
        <p style={hintStyle}>
          Shown in the news-style overlay (top-right corner of the video frame).
        </p>
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
        disabled={!youtubeUrl.trim() || !ttsVoiceId.trim()}
      />
    </form>
  );
}
