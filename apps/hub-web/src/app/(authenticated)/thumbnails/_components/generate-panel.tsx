"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import {
  ReferencePicker,
  type PickedReference,
} from "@/components/thumbnails/reference-picker";
import {
  ASPECT_OPTIONS,
  BACKEND_OPTIONS,
  PROMPT_MODE_OPTIONS,
  RESOLUTION_OPTIONS,
  archetypeImageUrl,
  aspectPadding,
  thumbnailImageUrl,
  type ChannelOption,
  type Thumbnail,
  type ThumbnailArchetype,
} from "@/components/thumbnails/types";
import { ActionButton, Field, TextArea, TextInput } from "./archetype-editor";
import type { ActiveFormat } from "@/lib/formats";

/**
 * Generate view — pick archetype + channel + inputs + references, render,
 * iterate.
 *
 * Results are polled and rendered inline. FAILURES ARE SHOWN, prominently,
 * with the provider error verbatim: the previous system left 57 failed rows
 * with no surface anywhere in the UI, so nobody noticed for eleven days.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

interface Props {
  archetypes: ThumbnailArchetype[];
  channels: ChannelOption[];
  formats: ActiveFormat[];
  initialArchetypeId?: string | null;
}

export function GeneratePanel({
  archetypes,
  channels,
  formats,
  initialArchetypeId,
}: Props) {
  const [archetypeId, setArchetypeId] = useState(initialArchetypeId ?? "");
  const [channelId, setChannelId] = useState("");
  const [format, setFormat] = useState(formats[0]?.id ?? "OTHER");
  const [title, setTitle] = useState("");
  const [headline, setHeadline] = useState("");
  const [topic, setTopic] = useState("");
  const [logoSubject, setLogoSubject] = useState("");
  const [promptMode, setPromptMode] = useState("programmatic");
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState("1k");
  const [backend, setBackend] = useState("");
  const [count, setCount] = useState("3");
  const [onFallback, setOnFallback] = useState("warn");
  const [extras, setExtras] = useState<PickedReference[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [realSize, setRealSize] = useState(false);

  // Effective reference count = archetype (1 when picked or auto) + extras.
  // This drives the capability line: >1 reference can only be served by
  // FastGen (licence expired) or AI33, so warn BEFORE submit (plan A2.11).
  const effectiveRefs = 1 + extras.length;

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [results, setResults] = useState<Thumbnail[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = useMemo(
    () => archetypes.find((a) => a.id === archetypeId),
    [archetypes, archetypeId],
  );

  // Adopt the archetype's own geometry when one is picked.
  useEffect(() => {
    if (selected) {
      setAspect(selected.aspect_ratio);
      setResolution(selected.resolution);
    }
  }, [selected]);

  // Poll for results while anything is still generating.
  useEffect(() => {
    if (!subjectId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/thumbnails/studio/${subjectId}`);
        if (!res.ok) return;
        const rows: Thumbnail[] = await res.json();
        if (cancelled) return;
        setResults(rows);
        const settled = rows.every(
          (r) => r.status === "completed" || r.status === "failed",
        );
        if (rows.length > 0 && settled) {
          setBusy(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* transient — the next tick retries */
      }
    }

    void tick();
    pollRef.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [subjectId]);

  // A run that never settles must not spin forever pretending to work.
  useEffect(() => {
    if (!busy) return;
    const timeout = setTimeout(() => {
      setBusy(false);
      setError(
        (e) => e ?? "Generation timed out after 4 minutes. Check the worker.",
      );
    }, 240_000);
    return () => clearTimeout(timeout);
  }, [busy, subjectId]);

  // Iterate vs Regenerate are kept STRICTLY apart (DECISIONS §3.2.5).
  //   iterate    → the ALREADY-GENERATED thumbnail is the reference; deltas only
  //   regenerate → the ORIGINAL archetype reference, brief recompiled + new note
  // A plain generate (no `from`) is an `original`.
  async function generate(opts?: {
    kind?: "iterate" | "regenerate";
    from?: Thumbnail;
    instructions?: string;
  }) {
    setError(null);
    if (!title.trim()) return setError("A title is required");
    const kind = opts?.kind;
    if (kind && !opts?.instructions?.trim()) {
      return setError(
        `${kind === "iterate" ? "Iterate" : "Regenerate"} needs an instruction`,
      );
    }

    setBusy(true);
    if (!kind) setResults([]);
    try {
      const res = await fetch("/api/thumbnails/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channelId || null,
          format,
          archetypeId: archetypeId || undefined,
          promptMode,
          title: title.trim(),
          headlineText: headline.trim() || undefined,
          topic: topic.trim() || undefined,
          logoSubject: logoSubject.trim() || undefined,
          // On a FIRST generation `instructions` no longer hijacks the prompt
          // (backend A2.2); it is only sent for iterate/regenerate.
          instructions: kind ? opts?.instructions?.trim() : undefined,
          extraReferences: extras.map((e) => e.path),
          // The engine resolves the reference from the KIND + parent, so we do
          // NOT send referenceOverride for iterate/regenerate — that was the
          // conflation bug.
          parentThumbnailId: opts?.from?.id,
          generationKind: kind,
          // Keep iterate/regenerate under the parent's subject so the whole
          // lineage stays visible in one grid (§3.2.7).
          subjectId: kind ? opts?.from?.subject_id : undefined,
          aspectRatio: aspect,
          resolution,
          backend: backend || undefined,
          onFallback,
          count: kind ? 1 : Number(count),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json.error ?? `Request failed (${res.status})`);
      setSubjectId(json.subjectId);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Generation failed");
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 400px) 1fr",
        gap: 14,
        alignItems: "start",
      }}
    >
      {/* ── Controls ── */}
      <GlassCard
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          position: "sticky",
          top: 12,
        }}
      >
        <V2Listbox
          label="Archetype"
          value={archetypeId}
          onChange={setArchetypeId}
          placeholder="Auto — least recently used"
          options={[
            {
              value: "",
              label: "Auto (least recently used)",
              hint: "Picks from the global library",
            },
            ...archetypes
              .filter((a) => a.is_active)
              .map((a) => ({
                value: a.id,
                label: a.name,
                hint: a.channel_id ? a.category : `Global · ${a.category}`,
                thumbnailUrl: archetypeImageUrl(a.id),
              })),
          ]}
        />

        {selected && (
          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.22)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={archetypeImageUrl(selected.id)}
              alt={selected.name}
              style={{ width: "100%", display: "block" }}
            />
          </div>
        )}

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          <V2Listbox
            label="Channel"
            value={channelId}
            onChange={setChannelId}
            options={[
              {
                value: "",
                label: "None (ad-hoc)",
                hint: "No channel branding",
              },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <V2Listbox
            label="Format"
            value={format}
            onChange={setFormat}
            options={formats.map((f) => ({ value: f.id, label: f.label }))}
          />
        </div>

        <Field label="Title" hint="required">
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder="Video title / subject"
          />
        </Field>

        <Field
          label="Thumbnail text"
          hint="leave blank to auto-derive a complementary headline"
        >
          <TextInput
            value={headline}
            onChange={setHeadline}
            placeholder="Blank = LLM writes a headline that complements the title"
          />
        </Field>

        <Field label="Topic / context">
          <TextArea value={topic} onChange={setTopic} rows={2} />
        </Field>

        <ReferencePicker
          label="Extra references"
          value={extras}
          onChange={setExtras}
          archetypes={archetypes}
          max={4}
        />

        {/* Capability line (plan A2.11): warn before spend when the effective
            reference count can only be served by a disabled/expired backend. */}
        {effectiveRefs > 1 && (
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 6,
              background: "rgba(255,190,80,0.1)",
              border: "1px solid rgba(255,190,80,0.28)",
              color: "#ffc978",
              fontSize: 10.5,
              lineHeight: 1.4,
            }}
          >
            {effectiveRefs} references → only FastGen (licence expired) or AI33
            can serve multi-reference requests. Remove extras to use VUP/forge.
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            color: TEXT_2,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            padding: 0,
            alignSelf: "flex-start",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 15,
              transform: showAdvanced ? "rotate(90deg)" : "none",
              transition: "transform 140ms",
            }}
          >
            chevron_right
          </span>
          Advanced
        </button>

        {showAdvanced && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <V2Listbox
                label="Aspect"
                value={aspect}
                onChange={setAspect}
                options={ASPECT_OPTIONS.map((o) => ({ ...o }))}
              />
              <V2Listbox
                label="Resolution"
                value={resolution}
                onChange={setResolution}
                options={RESOLUTION_OPTIONS.map((o) => ({ ...o }))}
              />
            </div>
            <V2Listbox
              label="Prompt mode"
              value={promptMode}
              onChange={setPromptMode}
              options={PROMPT_MODE_OPTIONS.map((o) => ({ ...o }))}
            />
            <V2Listbox
              label="Image backend"
              value={backend}
              onChange={setBackend}
              options={BACKEND_OPTIONS.map((o) => ({ ...o }))}
              footer={
                <span style={{ fontSize: 10.5, color: TEXT_2 }}>
                  If another provider serves the request it is reported on the
                  result, never applied silently.
                </span>
              }
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <V2Listbox
                label="Variants"
                value={count}
                onChange={setCount}
                options={Array.from({ length: 10 }, (_, i) =>
                  String(i + 1),
                ).map((n) => ({
                  value: n,
                  label: `${n} variant${n === "1" ? "" : "s"}`,
                  hint: n === "3" ? "YouTube A/B cap" : undefined,
                }))}
              />
              <V2Listbox
                label="On fallback"
                value={onFallback}
                onChange={setOnFallback}
                options={[
                  { value: "warn", label: "Warn", hint: "Generate + badge it" },
                  {
                    value: "allow",
                    label: "Allow",
                    hint: "Silent (not advised)",
                  },
                  { value: "fail", label: "Fail", hint: "Refuse a downgrade" },
                ]}
              />
            </div>
            {selected?.features_logo && (
              <Field
                label="Logo subject"
                hint="brand whose logo replaces the reference's"
              >
                <TextInput value={logoSubject} onChange={setLogoSubject} />
              </Field>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(255,90,90,0.12)",
              border: "1px solid rgba(255,90,90,0.32)",
              color: "#ff9c9c",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <ActionButton
          text={busy ? "Generating…" : "Generate"}
          icon={busy ? "hourglass_top" : "auto_awesome"}
          onClick={() => generate()}
          disabled={busy}
          primary
        />
      </GlassCard>

      {/* ── Results ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!subjectId && (
          <GlassCard style={{ padding: 36, textAlign: "center" }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 34, color: "var(--v2-accent)" }}
            >
              image
            </span>
            <p style={{ color: TEXT_2, fontSize: 13, margin: "10px 0 0" }}>
              Pick an archetype, give it a title, and generate. Results appear
              here and become reusable as references.
            </p>
          </GlassCard>
        )}

        {busy && results.length === 0 && (
          <GlassCard style={{ padding: 28, textAlign: "center" }}>
            <span style={{ color: TEXT_2, fontSize: 13 }}>
              Queued — waiting for the worker…
            </span>
          </GlassCard>
        )}

        {results.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: TEXT_2,
                  cursor: "pointer",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <input
                  type="checkbox"
                  checked={realSize}
                  onChange={(e) => setRealSize(e.target.checked)}
                />
                Real-size preview
              </label>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {results.map((r) => (
                <ResultCard
                  key={r.id}
                  thumbnail={r}
                  realSize={realSize}
                  onIterate={(text) =>
                    generate({ kind: "iterate", from: r, instructions: text })
                  }
                  onRegenerate={(text) =>
                    generate({
                      kind: "regenerate",
                      from: r,
                      instructions: text,
                    })
                  }
                  onRetry={() => generate()}
                  disabled={busy}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const REAL_SIZES = [
  { w: 336, h: 189, label: "Sidebar 336×189" },
  { w: 168, h: 94, label: "Mobile 168×94" },
  { w: 120, h: 68, label: "End-screen 120×68" },
] as const;

function ResultCard({
  thumbnail,
  realSize,
  onIterate,
  onRegenerate,
  onRetry,
  disabled,
}: {
  thumbnail: Thumbnail;
  realSize: boolean;
  onIterate: (instructions: string) => void;
  onRegenerate: (instructions: string) => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<"iterate" | "regenerate" | null>(null);
  const [text, setText] = useState("");
  const failed = thumbnail.status === "failed";
  const pending =
    thumbnail.status === "pending" || thumbnail.status === "generating";
  // Always-on: any fallback fired (not only when a pin mismatched). This is the
  // §2.6 fix — an unpinned auto-run used to downgrade invisibly.
  const fallback =
    thumbnail.fallback_used ||
    (!!thumbnail.requested_backend &&
      !!thumbnail.provider_used &&
      thumbnail.provider_used !== thumbnail.requested_backend);
  const wanted =
    thumbnail.backend_chain?.[0] ?? thumbnail.requested_backend ?? "wanted";

  function submit() {
    if (!text.trim()) return;
    if (mode === "iterate") onIterate(text.trim());
    else if (mode === "regenerate") onRegenerate(text.trim());
    setMode(null);
    setText("");
  }

  return (
    <GlassCard
      style={{
        overflow: "hidden",
        border: failed
          ? "1px solid rgba(255,90,90,0.42)"
          : "1px solid rgba(255,255,255,0.09)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingTop: aspectPadding(thumbnail.aspect_ratio),
          background: "rgba(255,255,255,0.04)",
        }}
      >
        {thumbnail.status === "completed" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailImageUrl(thumbnail.id)}
            alt={thumbnail.title ?? "Generated thumbnail"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: failed ? "#ff9c9c" : TEXT_2,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28 }}
            >
              {failed ? "error" : "hourglass_top"}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>
              {failed ? "FAILED" : "Generating…"}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {failed && thumbnail.error_message && (
          <div
            style={{
              padding: "6px 8px",
              borderRadius: 5,
              background: "rgba(255,90,90,0.1)",
              color: "#ff9c9c",
              fontSize: 10.5,
              lineHeight: 1.45,
              wordBreak: "break-word",
            }}
          >
            {thumbnail.error_message}
          </div>
        )}

        {fallback && (
          <div
            style={{
              padding: "6px 8px",
              borderRadius: 5,
              background: "rgba(255,190,80,0.12)",
              border: "1px solid rgba(255,190,80,0.3)",
              color: "#ffc978",
              fontSize: 10.5,
              lineHeight: 1.4,
              fontWeight: 700,
            }}
          >
            ⚠ FALLBACK · wanted <strong>{wanted}</strong> → served by{" "}
            <strong>{thumbnail.provider_used}</strong>. Check before shipping.
          </div>
        )}

        {realSize && thumbnail.status === "completed" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {REAL_SIZES.map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailImageUrl(thumbnail.id)}
                  alt={s.label}
                  style={{
                    width: s.w / 2,
                    height: s.h / 2,
                    objectFit: "cover",
                    borderRadius: 3,
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                />
                <div style={{ fontSize: 8.5, color: TEXT_2, marginTop: 2 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 6,
            fontSize: 9.5,
            color: TEXT_2,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            flexWrap: "wrap",
          }}
        >
          <span>{thumbnail.aspect_ratio}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{thumbnail.resolution.toUpperCase()}</span>
          {thumbnail.provider_used && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{thumbnail.provider_used}</span>
            </>
          )}
          {thumbnail.generation_kind &&
            thumbnail.generation_kind !== "original" && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>{thumbnail.generation_kind}</span>
              </>
            )}
        </div>

        {/* Inline instruction bound to THIS image — the §3.2.5 clarification. */}
        {mode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <TextInput
              value={text}
              onChange={setText}
              placeholder={
                mode === "iterate"
                  ? "What should change? (references THIS image)"
                  : "New instruction (re-runs from the ORIGINAL reference)"
              }
            />
            <div style={{ display: "flex", gap: 6 }}>
              <SmallButton
                icon="check"
                text={mode === "iterate" ? "Iterate" : "Regenerate"}
                onClick={submit}
                disabled={disabled || !text.trim()}
              />
              <SmallButton
                icon="close"
                text="Cancel"
                onClick={() => {
                  setMode(null);
                  setText("");
                }}
              />
            </div>
          </div>
        )}

        {!pending && !mode && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {failed ? (
              <SmallButton
                icon="refresh"
                text="Retry"
                onClick={onRetry}
                disabled={disabled}
              />
            ) : (
              <>
                <SmallButton
                  icon="tune"
                  text="Iterate"
                  title="Uses THIS generated image as the reference"
                  onClick={() => setMode("iterate")}
                  disabled={disabled}
                />
                <SmallButton
                  icon="restart_alt"
                  text="Regenerate"
                  title="Re-runs from the ORIGINAL reference with a new instruction"
                  onClick={() => setMode("regenerate")}
                  disabled={disabled}
                />
              </>
            )}
            {thumbnail.status === "completed" && (
              <a
                href={thumbnailImageUrl(thumbnail.id)}
                download
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 9px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: TEXT_2,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textDecoration: "none",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 13 }}
                >
                  download
                </span>
                Save
              </a>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function SmallButton({
  icon,
  text,
  onClick,
  disabled,
  title,
}: {
  icon: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 9px",
        borderRadius: 6,
        background: "rgba(var(--v2-accent-rgb), 0.14)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.34)",
        color: "var(--v2-accent)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
        {icon}
      </span>
      {text}
    </button>
  );
}

export { TEXT_1, TEXT_2 };
