"use client";

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import {
  Button,
  ErrorBanner,
  Field,
  Icon,
  Pill,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  inputStyle,
} from "./ui";
import type { MusicGenerationRow } from "./types";

/** Operator-facing explanation for each machine-readable failure class. */
const ERROR_HELP: Record<string, string> = {
  rate_limited:
    "AI33's task queue was full. This has happened before at 12/10 queued tasks. Wait for other AI33 work (TTS included) to drain, then retry.",
  server_busy: "AI33 reported it was busy. Transient — retry shortly.",
  no_credits: "The AI33 account is out of credits. Top up before retrying.",
  auth: "AI33 rejected the API key. Check AI33_API_KEY on the host.",
  timeout:
    "The task did not finish in time. It may still complete on AI33's side — check the task id before regenerating and paying twice.",
  no_audio: "AI33 reported the task done but returned no downloadable audio.",
  download_failed: "The generated audio could not be downloaded.",
  probe_failed: "The downloaded file could not be probed as valid audio.",
  unknown: "Unclassified failure — see the message.",
};

const STATUS_TONE: Record<
  string,
  "neutral" | "accent" | "warn" | "danger" | "ok"
> = {
  queued: "neutral",
  running: "accent",
  done: "ok",
  error: "danger",
};

export function GenerateCard({ onChanged }: { onChanged: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [format, setFormat] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<MusicGenerationRow[]>([]);
  const [inFlight, setInFlight] = useState(0);
  const [maxConcurrent, setMaxConcurrent] = useState(2);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/music-library/generate?limit=15", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        generations?: MusicGenerationRow[];
        inFlight?: number;
        maxConcurrent?: number;
      };
      setGenerations(data.generations ?? []);
      setInFlight(data.inFlight ?? 0);
      setMaxConcurrent(data.maxConcurrent ?? 2);
    } catch {
      /* transient — the next poll will pick it up */
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Suno runs for minutes; poll so a finished or failed run appears without
    // the operator having to guess.
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Describe the music you want.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/music-library/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          genre: genre.trim() || undefined,
          format: format.trim() || undefined,
          instrumental,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Failed to start (HTTP ${res.status})`);
        return;
      }
      setPrompt("");
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GlassCard style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Icon name="graphic_eq" size={18} color="var(--v2-accent)" />
          <h3
            style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: 0 }}
          >
            Generate with Suno
          </h3>
          <Pill tone={inFlight > 0 ? "accent" : "neutral"}>
            {inFlight}/{maxConcurrent} running
          </Pill>
        </div>
        <p
          style={{
            fontSize: 11,
            color: TEXT_FAINT,
            margin: "0 0 16px",
            maxWidth: 620,
          }}
        >
          Runs through AI33&apos;s Suno endpoint. A task takes roughly 3-8
          minutes and returns two clips — both are added to the library, each
          stamped with creator &ldquo;Suno (AI33)&rdquo; plus the prompt and
          task id. There is no fallback to another provider: if AI33 fails, the
          run is recorded as failed with the reason.
        </p>

        <form
          onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <Field
            label="Prompt"
            hint="Describe the vibe, instrumentation and what it must not do."
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Slow ambient bed under narration. Warm piano, low strings. No drums, no vocals, no melody hooks."
            />
          </Field>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
            }}
          >
            <Field label="Title">
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Generated track"
              />
            </Field>
            <Field label="Genre">
              <input
                style={inputStyle}
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              />
            </Field>
            <Field label="Format tag">
              <input
                style={inputStyle}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                placeholder="optional"
              />
            </Field>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: TEXT,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={instrumental}
              onChange={(e) => setInstrumental(e.target.checked)}
            />
            Instrumental only (no vocals)
          </label>

          {error && (
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          )}

          <div>
            <Button type="submit" variant="primary" disabled={submitting}>
              <Icon name="auto_awesome" size={15} />
              {submitting ? "Starting…" : "Generate"}
            </Button>
          </div>
        </form>
      </GlassCard>

      <GlassCard style={{ padding: 20 }}>
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_FAINT,
            margin: "0 0 14px",
          }}
        >
          Recent generations
        </h3>

        {generations.length === 0 ? (
          <span style={{ fontSize: 12, color: TEXT_FAINT }}>
            Nothing generated yet.
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {generations.map((g) => (
              <div
                key={g.id}
                style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${
                    g.status === "error"
                      ? "rgba(255,80,80,0.3)"
                      : "rgba(var(--v2-accent-rgb), 0.12)"
                  }`,
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Pill tone={STATUS_TONE[g.status] ?? "neutral"}>
                    {g.status}
                  </Pill>
                  <span
                    style={{ fontSize: 12, fontWeight: 600, color: TEXT }}
                  >
                    {g.title ?? "Untitled"}
                  </span>
                  {g.status === "done" && (
                    <Pill tone="ok">
                      {g.track_ids.length} track
                      {g.track_ids.length === 1 ? "" : "s"}
                    </Pill>
                  )}
                  {g.credit_cost !== null && (
                    <Pill>{g.credit_cost.toLocaleString()} credits</Pill>
                  )}
                  <span style={{ fontSize: 10, color: TEXT_FAINT }}>
                    {new Date(g.created_at).toLocaleString()}
                  </span>
                </div>

                <div style={{ fontSize: 11, color: TEXT_DIM }}>{g.prompt}</div>

                {g.provider_task_id && (
                  <div
                    style={{
                      fontSize: 10,
                      color: TEXT_FAINT,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    task {g.provider_task_id}
                  </div>
                )}

                {g.status === "error" && (
                  <div
                    style={{
                      padding: "8px 10px",
                      background: "rgba(255,80,80,0.07)",
                      border: "1px solid rgba(255,80,80,0.22)",
                      borderRadius: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#ff8080",
                      }}
                    >
                      {g.error_code ?? "error"}
                    </span>
                    {g.error_code && ERROR_HELP[g.error_code] && (
                      <span style={{ fontSize: 11, color: "#ffb3b3" }}>
                        {ERROR_HELP[g.error_code]}
                      </span>
                    )}
                    {g.error_message && (
                      <span style={{ fontSize: 10, color: TEXT_FAINT }}>
                        {g.error_message}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
