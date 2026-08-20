"use client";

import { useEffect, useState } from "react";
import { cfApi, type CfApiPersona } from "../_lib/api";

const LANG_OPTIONS = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onIngested?: () => void;
}

/**
 * Modal for kicking off the real pipeline:
 *  1. Pick (or create) a persona.
 *  2. Paste a YouTube URL.
 *  3. POST → /api/v1/clip-forge/sources, which inserts the cf_sources row and
 *     enqueues a CF_INGEST job. The worker downloads, transcribes,
 *     detects clips, and renders them to 9:16.
 */
export function IngestModal({ open, onClose, onIngested }: Props) {
  const [personas, setPersonas] = useState<CfApiPersona[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string>("");
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaLang, setNewPersonaLang] = useState<string>("en");
  const [creatingPersona, setCreatingPersona] = useState(false);

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setLoadingPersonas(true);
    cfApi
      .listPersonas()
      .then((r) => {
        setPersonas(r.personas);
        if (r.personas.length > 0 && !selectedPersona) {
          setSelectedPersona(r.personas[0].id);
          setLanguage(r.personas[0].default_language || "en");
        }
      })
      .catch((e) =>
        setError(
          `Could not load personas: ${(e as Error).message}. The cf_personas table probably hasn't been migrated yet — apply migration 0015_clip_forge.sql first.`,
        ),
      )
      .finally(() => setLoadingPersonas(false));
  }, [open]);

  // When the user picks a different persona, snap the source language to
  // that persona's default. They can still override below.
  useEffect(() => {
    const p = personas.find((x) => x.id === selectedPersona);
    if (p?.default_language) setLanguage(p.default_language);
  }, [selectedPersona, personas]);

  if (!open) return null;

  async function createPersona() {
    if (!newPersonaName.trim()) return;
    setCreatingPersona(true);
    setError(null);
    try {
      const r = await cfApi.createPersona({
        name: newPersonaName.trim(),
        default_language: newPersonaLang,
      });
      setPersonas((prev) => [...prev, r.persona]);
      setSelectedPersona(r.persona.id);
      setLanguage(r.persona.default_language || newPersonaLang);
      setNewPersonaName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingPersona(false);
    }
  }

  async function submit() {
    if (!selectedPersona) {
      setError("Pick or create a persona first.");
      return;
    }
    if (!url.trim()) {
      setError("Paste a source URL.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await cfApi.createSource({
        persona_id: selectedPersona,
        source_url: url.trim(),
        title: title.trim() || undefined,
        language,
      });
      setSuccess(
        `Queued. source_id=${r.source.id.slice(0, 8)}… — worker will download + transcribe.`,
      );
      setUrl("");
      setTitle("");
      onIngested?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,6,8,.62)",
        backdropFilter: "blur(2px)",
        zIndex: 70,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: "92vw",
          background: "#0e1217",
          border: "1px solid #2b333c",
          borderRadius: 10,
          boxShadow: "0 24px 70px rgba(0,0,0,.6)",
          padding: 20,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 16 }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Ingest a new source
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              color: "#7d8893",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: ".12em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
              marginBottom: 6,
            }}
          >
            PERSONA
          </div>
          {loadingPersonas ? (
            <div style={{ fontSize: 11, color: "#7d8893" }}>loading…</div>
          ) : personas.length === 0 ? (
            <div style={{ fontSize: 11, color: "#9b8aa8" }}>
              No personas yet. Create one below.
            </div>
          ) : (
            <select
              value={selectedPersona}
              onChange={(e) => setSelectedPersona(e.target.value)}
              style={{
                width: "100%",
                background: "#10141a",
                border: "1px solid #232a32",
                borderRadius: 6,
                color: "#e6e9ed",
                fontFamily: "inherit",
                fontSize: 12,
                padding: "8px 10px",
                outline: "none",
              }}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
            <input
              value={newPersonaName}
              onChange={(e) => setNewPersonaName(e.target.value)}
              placeholder="+ new persona name (e.g. Marck Gebauer)"
              style={{
                flex: 1,
                background: "#10141a",
                border: "1px solid #232a32",
                borderRadius: 6,
                color: "#e6e9ed",
                fontFamily: "inherit",
                fontSize: 12,
                padding: "7px 10px",
                outline: "none",
              }}
            />
            <select
              value={newPersonaLang}
              onChange={(e) => setNewPersonaLang(e.target.value)}
              title="default language for this creator"
              style={{
                background: "#10141a",
                border: "1px solid #232a32",
                borderRadius: 6,
                color: "#e6e9ed",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                padding: "6px 8px",
                outline: "none",
              }}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
            <button
              onClick={createPersona}
              disabled={creatingPersona || !newPersonaName.trim()}
              style={{
                border: "1px solid #3f4954",
                background: creatingPersona ? "#10141a" : "#1a212a",
                color: "#eef1f4",
                borderRadius: 6,
                padding: "6px 12px",
                cursor: creatingPersona ? "wait" : "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                opacity: !newPersonaName.trim() ? 0.5 : 1,
              }}
            >
              create
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: ".12em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
              marginBottom: 6,
            }}
          >
            SOURCE URL OR LOCAL PATH
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube URL · twitch.tv/videos/… · /opt/content-forge/media/…mp4"
            style={{
              width: "100%",
              background: "#10141a",
              border: "1px solid #232a32",
              borderRadius: 6,
              color: "#e6e9ed",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              padding: "8px 10px",
              outline: "none",
            }}
          />
          <div
            style={{
              fontSize: 10.5,
              color: "#6b727b",
              marginTop: 5,
              lineHeight: 1.5,
            }}
          >
            YouTube → yt-dlp (needs a cookie jar) · Twitch → TwitchDownloaderCLI
            (not installed yet) · an{" "}
            <span style={{ color: "#9aa1a9" }}>absolute path</span> or{" "}
            <span style={{ color: "#9aa1a9" }}>file://</span> URL to a video
            already on the server is ingested directly — no downloader required.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: ".12em",
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: 6,
              }}
            >
              TITLE (optional)
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="defaults to the URL"
              style={{
                width: "100%",
                background: "#10141a",
                border: "1px solid #232a32",
                borderRadius: 6,
                color: "#e6e9ed",
                fontFamily: "inherit",
                fontSize: 12,
                padding: "8px 10px",
                outline: "none",
              }}
            />
          </div>
          <div style={{ width: 150 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: ".12em",
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: 6,
              }}
            >
              LANGUAGE
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              title="Whisper transcribes in this language; DeepSeek writes captions in it"
              style={{
                width: "100%",
                background: "#10141a",
                border: "1px solid #232a32",
                borderRadius: 6,
                color: "#e6e9ed",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11.5,
                padding: "7px 10px",
                outline: "none",
              }}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div
            style={{
              fontSize: 11.5,
              color: "#dd8d83",
              background: "rgba(207,116,104,.08)",
              border: "1px solid #5a4046",
              borderRadius: 6,
              padding: "9px 11px",
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            style={{
              fontSize: 11.5,
              color: "#7fc79b",
              background: "rgba(87,165,120,.08)",
              border: "1px solid #2c5e42",
              borderRadius: 6,
              padding: "9px 11px",
              marginBottom: 12,
            }}
          >
            {success}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #2b333c",
              background: "transparent",
              color: "#aeb4bb",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            close
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={submit}
            disabled={submitting || !selectedPersona || !url.trim()}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 6,
              padding: "8px 18px",
              cursor: submitting ? "wait" : "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              opacity: !selectedPersona || !url.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? "queuing…" : "ingest →"}
          </button>
        </div>
      </div>
    </div>
  );
}
