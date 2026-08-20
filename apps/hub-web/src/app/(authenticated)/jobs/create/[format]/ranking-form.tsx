"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createJob } from "@/app/actions/create-job";
import { DEFAULT_TIER_CONFIG, type RankingItem } from "@repo/contracts";
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

interface RankingFormProps {
  channels: Channel[];
  templates: Template[];
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

/** One optional explicit item row (Advanced). Raw strings — parsed on submit. */
interface ItemRow {
  name: string;
  pronunciation: string;
  footageUrls: string;
}
function emptyRow(): ItemRow {
  return { name: "", pronunciation: "", footageUrls: "" };
}

/** A staged upload returned by /api/jobs/ranking-upload. */
interface UploadedMedia {
  url: string; // file:// path stored in metadata
  previewUrl: string; // /api/media key for the thumbnail
  kind: "photo" | "video";
  name: string;
}

/** Short title derived from the brief so we always have a non-empty topic. */
function deriveTopic(brief: string, items: ItemRow[]): string {
  const firstLine = brief
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  // Cap at 100 — the content_jobs.title column is varchar(100).
  if (firstLine) return firstLine.slice(0, 100);
  const named = items.map((r) => r.name.trim()).filter(Boolean);
  if (named.length > 0)
    return `Ranking: ${named.slice(0, 4).join(", ")}`.slice(0, 100);
  return "";
}

export function RankingForm({ channels, templates }: RankingFormProps) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [context, setContext] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [language, setLanguage] = useState("en");
  const [skipImageQc, setSkipImageQc] = useState(false);
  const [skipFinalQc, setSkipFinalQc] = useState(false);
  /**
   * Review gating (metadata.ranking.jobMode). DEFAULT is the human gate:
   * `asset_quality_loop` parks the job at AWAITING_VA_REVIEW so a VA picks and
   * trims B-roll per item in the selection studio (15–45 min of work).
   * `full_auto` is opt-in and renders the first-fetched candidates unattended.
   *
   * The field was read by the worker (asset-collection.ts) and declared in the
   * contract, but nothing ever wrote it — so the human gate was mandatory even
   * when the operator explicitly did not want it.
   */
  const [fullAuto, setFullAuto] = useState(false);
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable draft id for this form instance — namespaces staged uploads.
  const draftIdRef = useRef<string>("");
  if (!draftIdRef.current) {
    draftIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "RANKING",
      channel_id: channelId,
      template_id: templateId,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
    });
  }, [channelId, templateId, language, skipImageQc, skipFinalQc]);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  function addItem() {
    setShowAdvanced(true);
    setItems((prev) => [...prev, emptyRow()]);
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("draft_id", draftIdRef.current);
      for (const f of Array.from(fileList)) fd.append("media", f);
      const res = await fetch("/api/jobs/ranking-upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Upload failed");
      setMedia((prev) => [...prev, ...(json.media as UploadedMedia[])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  function removeMedia(index: number) {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedBrief = brief.trim();
    const named = items.filter((row) => row.name.trim());

    if (!trimmedBrief && named.length < 2) {
      setError(
        "Give a brief (paste a script, a list, or a description) — or add at least 2 explicit items.",
      );
      return;
    }
    if (!templateId) {
      setError("Please select a template");
      return;
    }
    const topic = deriveTopic(trimmedBrief, items);
    if (!topic) {
      setError("Couldn't derive a title — add a brief or an item name.");
      return;
    }

    // Explicit items are optional. When present, validate footage URLs.
    const rankingItems: RankingItem[] = [];
    for (let i = 0; i < named.length; i++) {
      const row = named[i]!;
      const footageUrls = row.footageUrls
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const url of footageUrls) {
        try {
          new URL(url);
        } catch {
          setError(`Invalid footage URL for "${row.name.trim()}": ${url}`);
          return;
        }
      }
      rankingItems.push({
        id: `item-${i + 1}`,
        name: row.name.trim(),
        ...(row.pronunciation.trim()
          ? { pronunciation: row.pronunciation.trim() }
          : {}),
        ...(footageUrls.length > 0 ? { userFootageUrls: footageUrls } : {}),
      });
    }

    setLoading(true);
    setError(null);

    const result = await createJob({
      channel_id: channelId,
      format: "RANKING",
      template_id: templateId,
      initial_topic: topic,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
      metadata: {
        ranking: {
          topic,
          ...(trimmedBrief ? { brief: trimmedBrief } : {}),
          items: rankingItems, // may be [] — DeepSeek derives them from the brief
          context: context.trim(),
          tierConfig: DEFAULT_TIER_CONFIG,
          jobMode: fullAuto ? "full_auto" : "asset_quality_loop",
          ...(media.length > 0
            ? {
                userMedia: media.map((m) => ({
                  url: m.url,
                  kind: m.kind,
                  name: m.name,
                })),
              }
            : {}),
        },
      },
    });

    if (result.success) {
      router.push("/jobs");
    } else {
      setError(result.error ?? "Failed to create job");
      setLoading(false);
    }
  }

  const namedCount = items.filter((row) => row.name.trim()).length;
  const canSubmit =
    (brief.trim().length > 0 || namedCount >= 2) && !!templateId && !uploading;

  return (
    <form onSubmit={handleSubmit} style={sectionStyle}>
      {/* Primary input — the one thing that's required. */}
      <div>
        <label style={labelStyle}>What do you want to rank? *</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={
            'Paste a full script, a list of things to rank, or just describe it.\n\ne.g. "Best budget mechanical keyboards"\nor a list:\n  Keychron V1\n  NuPhy Air75\n  Royal Kludge RK84\n\nDeepSeek writes the script and figures out the items and tiers for you.'
          }
          rows={8}
          style={textareaStyle}
          required={namedCount < 2}
        />
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "6px 2px 0",
          }}
        >
          That&apos;s all you need. Items and tiers are decided automatically —
          open Advanced only if you want to pin exact items.
        </p>
      </div>

      {/* Optional media — reference images / clips the VA can place. */}
      <div>
        <label style={labelStyle}>Reference images or clips (optional)</label>
        <div
          style={{
            border: "1px dashed rgba(var(--v2-accent-rgb), 0.35)",
            borderRadius: 10,
            padding: 14,
            background: "rgba(var(--v2-accent-rgb), 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "rgba(var(--v2-accent-rgb), 0.1)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                borderRadius: 8,
                color: "var(--v2-accent)",
                fontSize: 12,
                fontWeight: 600,
                cursor: uploading ? "wait" : "pointer",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                {uploading ? "hourglass_top" : "upload"}
              </span>
              {uploading ? "Uploading…" : "Add images / clips"}
            </button>
            <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
              Videos become B-roll options; images become hero shots. Picked per
              block later in the studio.
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              style={{ display: "none" }}
            />
          </div>

          {media.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                gap: 8,
              }}
            >
              {media.map((m, i) => (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    background: "rgba(0,0,0,0.3)",
                    aspectRatio: "1 / 1",
                  }}
                  title={m.name}
                >
                  {m.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.previewUrl}
                      alt={m.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <video
                      src={m.previewUrl}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                      muted
                    />
                  )}
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: "absolute",
                      left: 4,
                      bottom: 4,
                      fontSize: 14,
                      color: "#fff",
                      textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                    }}
                  >
                    {m.kind === "photo" ? "image" : "movie"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMedia(i)}
                    title="Remove"
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      padding: 0,
                      background: "rgba(0,0,0,0.6)",
                      border: "none",
                      borderRadius: 6,
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      close
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Channel — always needed. */}
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

      {/* Review mode — decides whether a human touches this job at all. */}
      <div>
        <label style={labelStyle}>B-roll review</label>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
            borderRadius: 10,
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            background: "rgba(var(--v2-accent-rgb), 0.04)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="ranking-job-mode"
              checked={!fullAuto}
              onChange={() => setFullAuto(false)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
                Review each block in the studio (recommended)
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "rgba(205,195,215,0.6)",
                  marginTop: 3,
                }}
              >
                The job stops at AWAITING_VA_REVIEW so you pick and trim the
                footage per item. Roughly 15–45 minutes of work per video.
              </span>
            </span>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="ranking-job-mode"
              checked={fullAuto}
              onChange={() => setFullAuto(true)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
                Full auto — no review, render the first footage found
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "rgba(205,195,215,0.6)",
                  marginTop: 3,
                }}
              >
                Goes straight from asset collection to render. No human sees the
                clips before they ship — expect occasional wrong-product
                footage.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Advanced disclosure — everything optional lives here. */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 2px",
            background: "none",
            border: "none",
            color: "rgba(205,195,215,0.7)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {showAdvanced ? "expand_less" : "expand_more"}
          </span>
          Advanced (optional): pin exact items, context, template
        </button>
      </div>

      {showAdvanced && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            paddingLeft: 12,
            borderLeft: "2px solid rgba(var(--v2-accent-rgb), 0.15)",
          }}
        >
          {/* Explicit items (optional) */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>
                Exact items (optional — leave empty to let DeepSeek choose)
              </label>
              <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
                {namedCount} set
              </span>
            </div>

            {items.length > 0 && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {items.map((row, index) => (
                  <div
                    key={index}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                      borderRadius: 8,
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--v2-accent)",
                        }}
                      >
                        Item {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          background: "none",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 6,
                          fontSize: 11,
                          color: "rgba(205,195,215,0.6)",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14 }}
                        >
                          delete
                        </span>
                        Remove
                      </button>
                    </div>

                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) =>
                        updateItem(index, { name: e.target.value })
                      }
                      placeholder="Item name — e.g. Keychron V1"
                      style={inputStyle}
                    />
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={row.pronunciation}
                        onChange={(e) =>
                          updateItem(index, { pronunciation: e.target.value })
                        }
                        placeholder="Pronunciation (optional)"
                        style={inputStyle}
                      />
                      <input
                        type="text"
                        value={row.footageUrls}
                        onChange={(e) =>
                          updateItem(index, { footageUrls: e.target.value })
                        }
                        placeholder="Footage URLs (optional, comma-separated)"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={addItem}
              style={{
                marginTop: 10,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "rgba(var(--v2-accent-rgb), 0.08)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                borderRadius: 8,
                color: "var(--v2-accent)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                add
              </span>
              Add Item
            </button>
          </div>

          <div>
            <label style={labelStyle}>Context / Opinion Notes (optional)</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Free-text guidance for the host — biases, angle, criteria, hot takes…"
              rows={3}
              style={textareaStyle}
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

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
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
        </div>
      )}

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

      <SubmitButton loading={loading} disabled={!canSubmit} />
    </form>
  );
}
