"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TTSVoice } from "@repo/db";
import { GlassCard } from "../../_components/glass-card";
import { ToastContainer, showToast } from "@/components/layout/toast";
import {
  createVoiceAction,
  updateVoiceAction,
  deleteVoiceAction,
  setDefaultVoiceAction,
  type VoiceInputData,
} from "./actions";

/**
 * TTS voice management.
 *
 * Before: "Add Voice" and the edit pencil set React state that nothing
 * rendered, so both buttons were inert. The star button POSTed to a route
 * whose repository helper looks voices up by the wrong column, so it 404'd.
 * Everything here now goes through server actions and persists.
 */

interface VoicesClientProps {
  initialVoices: TTSVoice[];
  canEdit: boolean;
}

type Draft = VoiceInputData & { id: string | null };

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  provider: "",
  voice_id: "",
  language: "en",
  gender: "",
  style: "",
  description: "",
  is_active: true,
  settings: "",
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  background: "#111",
  border: "1px solid rgba(75,68,85,0.45)",
  borderRadius: 7,
  color: "#e5e2e1",
  fontSize: 12.5,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  colorScheme: "dark",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "rgba(205,195,215,0.5)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}

function Chip({
  children,
  tone = "muted",
  title,
}: {
  children: React.ReactNode;
  tone?: "accent" | "muted" | "warn";
  title?: string;
}) {
  const tones = {
    accent: {
      fg: "var(--v2-accent)",
      bg: "rgba(var(--v2-accent-rgb), 0.12)",
      bd: "rgba(var(--v2-accent-rgb), 0.3)",
    },
    muted: {
      fg: "rgba(205,195,215,0.55)",
      bg: "rgba(255,255,255,0.04)",
      bd: "rgba(75,68,85,0.35)",
    },
    warn: {
      fg: "#f9a825",
      bg: "rgba(249,168,37,0.09)",
      bd: "rgba(249,168,37,0.28)",
    },
  }[tone];
  return (
    <span
      title={title}
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 9.5,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: tones.fg,
        background: tones.bg,
        border: `1px solid ${tones.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function VoicesClient({ initialVoices, canEdit }: VoicesClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(true);

  // Any voice_id used by more than one row — the table has no unique
  // constraint on it and both Edge generations plus two Minimax rows collide.
  const duplicateIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of initialVoices) {
      seen.set(v.voice_id, (seen.get(v.voice_id) ?? 0) + 1);
    }
    return new Set(
      [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    );
  }, [initialVoices]);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = initialVoices.filter((v) => {
      if (!showInactive && !v.is_active) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.provider.toLowerCase().includes(q) ||
        v.voice_id.toLowerCase().includes(q) ||
        v.language.toLowerCase().includes(q) ||
        (v.style ?? "").toLowerCase().includes(q)
      );
    });

    const map = new Map<string, TTSVoice[]>();
    for (const v of filtered) {
      const list = map.get(v.provider) ?? [];
      list.push(v);
      map.set(v.provider, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [initialVoices, filter, showInactive]);

  const totalShown = grouped.reduce((n, [, list]) => n + list.length, 0);

  function run(
    fn: () => Promise<{ success: boolean; error?: string }>,
    okMessage: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (result.success) {
        showToast("success", okMessage);
        setDraft(null);
        router.refresh();
      } else {
        showToast("error", result.error ?? "Something went wrong");
      }
    });
  }

  function save() {
    if (!draft) return;
    const { id, ...data } = draft;
    if (id) {
      run(() => updateVoiceAction(id, data), `${data.name} updated`);
    } else {
      run(() => createVoiceAction(data), `${data.name} added`);
    }
  }

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 1200,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <a
            href="/settings"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              arrow_back
            </span>
            Settings
          </a>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: "6px 0 0",
            }}
          >
            TTS Voices
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: "4px 0 0" }}>
            {initialVoices.length} configured across{" "}
            {new Set(initialVoices.map((v) => v.provider)).size} providers. The
            job-creation forms pick from the active ones.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
              background: "rgba(var(--v2-accent-rgb), 0.1)",
              color: "var(--v2-accent)",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 17 }}
            >
              add
            </span>
            Add voice
          </button>
        )}
      </div>

      {/* Editor */}
      {draft && (
        <GlassCard
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            {draft.id ? "Edit voice" : "New voice"}
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Name</Label>
              <input
                style={inputStyle}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Fish — German (Native)"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Provider</Label>
              <input
                style={inputStyle}
                value={draft.provider}
                onChange={(e) =>
                  setDraft({ ...draft, provider: e.target.value })
                }
                placeholder="Fish"
                list="voice-providers"
              />
              <datalist id="voice-providers">
                {[...new Set(initialVoices.map((v) => v.provider))].map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Provider voice ID</Label>
              <input
                style={{ ...inputStyle, fontFamily: "monospace" }}
                value={draft.voice_id}
                onChange={(e) =>
                  setDraft({ ...draft, voice_id: e.target.value })
                }
                placeholder="90042f762dbf49baa2e7776d011eee6b"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Language</Label>
              <input
                style={inputStyle}
                value={draft.language}
                onChange={(e) =>
                  setDraft({ ...draft, language: e.target.value })
                }
                placeholder="de"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Gender</Label>
              <input
                style={inputStyle}
                value={draft.gender ?? ""}
                onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
                placeholder="male / female / neutral"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Style</Label>
              <input
                style={inputStyle}
                value={draft.style ?? ""}
                onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                placeholder="native / casual / professional"
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label>Description</Label>
            <input
              style={inputStyle}
              value={draft.description ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="What this voice is good for"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label>Provider settings (JSON)</Label>
            <textarea
              style={{
                ...inputStyle,
                fontFamily: "monospace",
                minHeight: 62,
                resize: "vertical",
              }}
              value={draft.settings ?? ""}
              onChange={(e) => setDraft({ ...draft, settings: e.target.value })}
              placeholder='{"speed": 1.19, "stability": 0.36}'
            />
            <span style={{ fontSize: 10.5, color: "rgba(205,195,215,0.35)" }}>
              Stored verbatim in the <code>settings</code> column. Rejected if
              it is not valid JSON.
            </span>
          </div>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: "#cdc3d7",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) =>
                setDraft({ ...draft, is_active: e.target.checked })
              }
              style={{ accentColor: "var(--v2-accent)" }}
            />
            Active — offered in job-creation forms
          </label>

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              paddingTop: 8,
              borderTop: "1px solid rgba(75,68,85,0.25)",
            }}
          >
            <button
              type="button"
              onClick={() => setDraft(null)}
              style={{
                padding: "7px 14px",
                fontSize: 11.5,
                fontWeight: 700,
                borderRadius: 7,
                cursor: "pointer",
                background: "transparent",
                border: "1px solid rgba(75,68,85,0.35)",
                color: "rgba(205,195,215,0.6)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              style={{
                padding: "7px 16px",
                fontSize: 11.5,
                fontWeight: 800,
                borderRadius: 7,
                cursor: pending ? "wait" : "pointer",
                background: "rgba(var(--v2-accent-rgb), 0.14)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.35)",
                color: "var(--v2-accent)",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "Saving…" : draft.id ? "Save changes" : "Create voice"}
            </button>
          </div>
        </GlassCard>
      )}

      {/* Filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, provider, language, voice ID…"
          style={{ ...inputStyle, width: 320 }}
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: "rgba(205,195,215,0.6)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            style={{ accentColor: "var(--v2-accent)" }}
          />
          Show inactive
        </label>
        <span
          style={{
            fontSize: 11.5,
            color: "rgba(205,195,215,0.35)",
            marginLeft: "auto",
          }}
        >
          {totalShown} of {initialVoices.length}
        </span>
      </div>

      {/* List */}
      {grouped.length === 0 ? (
        <GlassCard style={{ padding: 40, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 40, color: "rgba(205,195,215,0.2)" }}
          >
            mic_off
          </span>
          <p
            style={{
              fontSize: 13,
              color: "rgba(205,195,215,0.5)",
              margin: "12px 0 0",
            }}
          >
            {initialVoices.length === 0
              ? "No voices configured yet."
              : `No voice matches “${filter}”.`}
          </p>
        </GlassCard>
      ) : (
        grouped.map(([provider, list]) => (
          <div
            key={provider}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#e5e2e1",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: 0,
                }}
              >
                {provider}
              </h2>
              <span style={{ fontSize: 11, color: "rgba(205,195,215,0.35)" }}>
                {list.length}
              </span>
            </div>

            <GlassCard style={{ padding: 0, overflow: "hidden" }}>
              {list.map((voice, i) => (
                <div
                  key={voice.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 12px",
                    borderTop:
                      i === 0 ? "none" : "1px solid rgba(75,68,85,0.18)",
                    opacity: voice.is_active ? 1 : 0.5,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "#e5e2e1",
                        }}
                      >
                        {voice.name}
                      </span>
                      {voice.is_default && <Chip tone="accent">Default</Chip>}
                      {!voice.is_active && <Chip>Inactive</Chip>}
                      {duplicateIds.has(voice.voice_id) && (
                        <Chip
                          tone="warn"
                          title="Another row uses this same provider voice ID"
                        >
                          Duplicate ID
                        </Chip>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        marginTop: 2,
                        fontSize: 10.5,
                        color: "rgba(205,195,215,0.45)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ textTransform: "uppercase" }}>
                        {voice.language}
                      </span>
                      {voice.gender && <span>{voice.gender}</span>}
                      {voice.style && <span>{voice.style}</span>}
                      <code
                        style={{
                          fontFamily: "monospace",
                          color: "rgba(205,195,215,0.4)",
                        }}
                      >
                        {voice.voice_id}
                      </code>
                      {voice.settings && (
                        <span title={voice.settings}>settings ✓</span>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      {!voice.is_default && voice.is_active && (
                        <IconButton
                          icon="star"
                          title={`Make default for ${voice.provider} / ${voice.language.toUpperCase()}`}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setDefaultVoiceAction(voice.id),
                              `${voice.name} is now the default`,
                            )
                          }
                        />
                      )}
                      <IconButton
                        icon="edit"
                        title="Edit"
                        disabled={pending}
                        onClick={() =>
                          setDraft({
                            id: voice.id,
                            name: voice.name,
                            provider: voice.provider,
                            voice_id: voice.voice_id,
                            language: voice.language,
                            gender: voice.gender ?? "",
                            style: voice.style ?? "",
                            description: voice.description ?? "",
                            is_active: voice.is_active,
                            settings: voice.settings ?? "",
                          })
                        }
                      />
                      <IconButton
                        icon="delete"
                        title="Delete"
                        danger
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Delete “${voice.name}” permanently?`))
                            return;
                          run(
                            () => deleteVoiceAction(voice.id),
                            `${voice.name} deleted`,
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </GlassCard>
          </div>
        ))
      )}

      <ToastContainer />
    </div>
  );
}

function IconButton({
  icon,
  title,
  onClick,
  danger,
  disabled,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        padding: 6,
        borderRadius: 6,
        border: `1px solid ${danger ? "rgba(255,180,171,0.25)" : "rgba(var(--v2-accent-rgb), 0.2)"}`,
        background: "rgba(255,255,255,0.03)",
        color: danger ? "#ffb4ab" : "var(--v2-accent)",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        {icon}
      </span>
    </button>
  );
}
