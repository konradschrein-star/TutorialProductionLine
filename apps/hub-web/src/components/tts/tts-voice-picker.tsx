"use client";

import { useState, useEffect } from "react";

interface TTSVoice {
  id: string;
  name: string;
  voice_id: string;
  provider: string;
  language: string;
  settings: string | null;
}

interface TTSVoicePickerProps {
  value: string;
  onChange: (voiceId: string) => void;
  language?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  AI33: "AI33 (Standard)",
  ElevenLabs: "ElevenLabs (Premium)",
  Minimax: "AI33 Minimax",
  EdgeTTS: "EdgeTTS (Free)",
};

const PROVIDER_ORDER = ["EdgeTTS", "AI33", "Minimax", "ElevenLabs"];

export function TTSVoicePicker({
  value,
  onChange,
  language = "en",
}: TTSVoicePickerProps) {
  const [voices, setVoices] = useState<Record<string, TTSVoice[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await fetch("/api/tts-voices");
        if (!response.ok) {
          throw new Error("Failed to fetch TTS voices");
        }
        const data = await response.json();
        setVoices(data.voices);
      } catch (err) {
        console.error("Failed to fetch TTS voices:", err);
        setError("Failed to load TTS voices");
      } finally {
        setLoading(false);
      }
    }

    fetchVoices();
  }, []);

  // Filter voices by language if specified
  const filteredVoices = Object.entries(voices).reduce(
    (acc, [provider, providerVoices]) => {
      const filtered = providerVoices.filter(
        (v) => !language || v.language === language || v.language === "multi",
      );
      if (filtered.length > 0) {
        acc[provider] = filtered;
      }
      return acc;
    },
    {} as Record<string, TTSVoice[]>,
  );

  // Sort providers by defined order
  const sortedProviders = PROVIDER_ORDER.filter((p) => filteredVoices[p]);

  if (loading) {
    return (
      <div>
        <label
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 8,
          }}
        >
          TTS Voice
        </label>
        <select
          disabled
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 8,
            color: "#e5e2e1",
            fontSize: 13,
            outline: "none",
            opacity: 0.5,
          }}
        >
          <option>Loading voices...</option>
        </select>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <label
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 8,
          }}
        >
          TTS Voice
        </label>
        <div style={{ fontSize: 12, color: "#ff6b6b" }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(205,195,215,0.6)",
          marginBottom: 8,
        }}
      >
        TTS Voice
        <span
          style={{
            marginLeft: 8,
            fontSize: 9,
            fontWeight: 400,
            textTransform: "none",
            opacity: 0.7,
          }}
        >
          (EdgeTTS is free)
        </span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
        <option value="">Select TTS voice</option>
        {sortedProviders.map((provider) => (
          <optgroup
            key={provider}
            label={PROVIDER_LABELS[provider] || provider}
          >
            {filteredVoices[provider].map((voice) => (
              <option key={voice.voice_id} value={voice.voice_id}>
                {voice.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
