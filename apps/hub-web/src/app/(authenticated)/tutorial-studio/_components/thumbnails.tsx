"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { V2Button, V2Card } from "../../_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";

/**
 * Thumbnails tab — the uploader VA's thumbnail fixer.
 *
 * The uploader pulls a finished video and publishes it. Until now they could
 * not touch its thumbnail at all: POST /api/jobs/[id]/thumbnail wanted
 * edit:job, the Thumbnail Studio wanted view:settings, and "use this one"
 * simply did not exist as an action anywhere in the app. So a bad thumbnail
 * was published or the video was not published.
 *
 * The flow here is deliberately the uploader's flow, not the producer's:
 * search by TITLE (the only handle they have), look at what was generated,
 * regenerate if it is wrong, and pick the one that ships.
 */

type SubjectKind = "content_job" | "tutorial_job";

interface JobHit {
  kind: SubjectKind;
  id: string;
  title: string;
  status: string;
  format: string;
  channelId: string | null;
  channelName: string | null;
  createdAt: string;
  producerName: string | null;
  producerRole: string | null;
  thumbnailCount: number;
  completedCount: number;
  hasSelected: boolean;
  previewThumbnailId: string | null;
}

interface ThumbnailRow {
  id: string;
  status: string;
  output_path: string | null;
  is_selected: boolean;
  archetype_id: string | null;
  generation_kind: string;
  headline_text: string | null;
  headline_source: string | null;
  provider_used: string | null;
  requested_backend: string | null;
  backend_chain: string[];
  fallback_used: boolean;
  error_message: string | null;
  created_at: string;
  variant_index: number;
  reference_paths: {
    archetype?: string;
    persona?: string;
    logo?: string;
    base?: string;
  } | null;
}

interface ArchetypeRow {
  id: string;
  name: string;
  category: string;
  is_active: boolean;
}

const PENDING = new Set(["pending", "generating", "queued"]);

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--v2-text-2)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--v2-surface-2)",
  border: "1px solid var(--v2-border-1)",
  borderRadius: 8,
  color: "var(--v2-text-1)",
  fontSize: 13,
  outline: "none",
};

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const colors: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "rgba(255,255,255,0.07)", fg: "var(--v2-text-2)" },
    good: { bg: "rgba(46,160,67,0.18)", fg: "#7ee787" },
    warn: { bg: "rgba(210,153,34,0.18)", fg: "#e3b341" },
    bad: { bg: "rgba(248,81,73,0.18)", fg: "#ff7b72" },
  };
  const c = colors[tone] ?? colors["neutral"]!;
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        borderRadius: 9999,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function ProductionThumbnails() {
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);
  const [hasMore, setHasMore] = useState(false);

  const [selectedJob, setSelectedJob] = useState<JobHit | null>(null);
  const [rows, setRows] = useState<ThumbnailRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [archetypes, setArchetypes] = useState<ArchetypeRow[]>([]);
  const [archetypeId, setArchetypeId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Search ───────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string, lim: number) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/thumbnails/jobs?q=${encodeURIComponent(q)}&limit=${lim}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Search failed (${res.status})`);
      }
      const data = (await res.json()) as {
        jobs: JobHit[];
        hasMore?: boolean;
      };
      setJobs(data.jobs);
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
      setJobs([]);
      setHasMore(false);
    } finally {
      setSearching(false);
    }
  }, []);

  // Any new search term collapses back to the first page.
  useEffect(() => {
    const t = setTimeout(() => {
      setLimit(24);
      void runSearch(query, 24);
    }, 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  function loadMore() {
    const next = limit + 24;
    setLimit(next);
    void runSearch(query, next);
  }

  // ── Thumbnails for the chosen job ────────────────────────────────────────
  const loadRows = useCallback(async (job: JobHit) => {
    setLoadingRows(true);
    try {
      const res = await fetch(`/api/thumbnails/${job.kind}/${job.id}`);
      if (!res.ok) throw new Error(`Failed to load thumbnails (${res.status})`);
      setRows((await res.json()) as ThumbnailRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const loadArchetypes = useCallback(async (channelId: string | null) => {
    try {
      const scope = channelId ?? "global";
      const res = await fetch(
        `/api/thumbnails/archetypes?scope=${encodeURIComponent(scope)}&activeOnly=true`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { archetypes: ArchetypeRow[] };
      setArchetypes(data.archetypes);
    } catch {
      // Non-fatal: without the list the operator can still regenerate with the
      // current archetype.
    }
  }, []);

  async function openJob(job: JobHit) {
    setSelectedJob(job);
    setRows([]);
    setInstructions("");
    setArchetypeId("");
    setNotice(null);
    setError(null);
    await Promise.all([loadRows(job), loadArchetypes(job.channelId)]);
  }

  // Poll while anything is still generating — the whole point of this tab is
  // that the VA sees the result, not a spinner they have to guess about.
  useEffect(() => {
    const active = rows.some((r) => PENDING.has(r.status));
    if (active && selectedJob && !poll.current) {
      poll.current = setInterval(() => void loadRows(selectedJob), 5000);
    } else if ((!active || !selectedJob) && poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
    return () => {
      if (poll.current) {
        clearInterval(poll.current);
        poll.current = null;
      }
    };
  }, [rows, selectedJob, loadRows]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function regenerate(mode: "same" | "changes" | "iterate") {
    if (!selectedJob) return;
    if (mode !== "same" && !instructions.trim()) {
      setError("Type what you want changed first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const url =
        selectedJob.kind === "tutorial_job"
          ? `/api/production/jobs/${selectedJob.id}/thumbnail`
          : `/api/jobs/${selectedJob.id}/thumbnail`;
      const body =
        selectedJob.kind === "tutorial_job"
          ? {
              mode,
              ...(archetypeId ? { archetypeId } : {}),
              ...(mode === "same" ? {} : { instructions: instructions.trim() }),
            }
          : {
              mode,
              kind: "content_job",
              ...(mode === "iterate" || !archetypeId ? {} : { archetypeId }),
              ...(mode === "same" ? {} : { instructions: instructions.trim() }),
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setNotice(
        mode === "same"
          ? "Regeneration queued — the new thumbnail appears below when it renders."
          : "Queued with your instruction. It is sent to the model as part of the prompt.",
      );
      setInstructions("");
      await loadRows(selectedJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function selectThisOne(thumbnailId: string) {
    if (!selectedJob) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/thumbnails/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnailId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setNotice("Selected. This is the thumbnail the uploader will publish.");
      await loadRows(selectedJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <V2Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="thumb-job-search" style={labelStyle}>
            Find a finished video by title
          </label>
          <input
            id="thumb-job-search"
            style={inputStyle}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing the video title…"
            autoComplete="off"
          />
          {/* The owner asked, in as many words, whether this list was only his
              own thumbnails. It never was — the search has always been
              unscoped. Say so, rather than leaving it to be inferred. */}
          <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
            Shows rendered videos from <strong>everyone</strong> — yours and
            every assistant&rsquo;s — not just your own. Rendered videos only:
            content jobs awaiting upload, uploading or published, and completed
            tutorial videos.
          </span>
          {searchError && (
            <span style={{ fontSize: 12, color: "var(--v2-error)" }}>
              {searchError}
            </span>
          )}
        </div>
      </V2Card>

      {/* The list IS the pictures. It was a column of titles and badges, which
          made the one question this tab exists to answer — "does this thumbnail
          look right?" — impossible to answer without clicking every row. Each
          card now shows the thumbnail that would actually ship, lazily loaded
          so a 25-hit search does not pull 25 full-size JPEGs at once. */}
      <V2Card noPadding>
        <div style={{ padding: 12 }}>
          {searching && jobs.length === 0 && (
            <div
              style={{ padding: 8, fontSize: 12, color: "var(--v2-text-2)" }}
            >
              Searching…
            </div>
          )}
          {!searching && jobs.length === 0 && (
            <div
              style={{ padding: 8, fontSize: 12, color: "var(--v2-text-2)" }}
            >
              No finished videos match that title.
            </div>
          )}
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            }}
          >
            {jobs.map((job) => {
              const isOpen = selectedJob?.id === job.id;
              return (
                <button
                  key={`${job.kind}:${job.id}`}
                  type="button"
                  onClick={() => void openJob(job)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: 0,
                    background: isOpen
                      ? "var(--v2-surface-2)"
                      : "var(--v2-surface-1)",
                    border: isOpen
                      ? "2px solid var(--v2-accent)"
                      : "1px solid var(--v2-border-1)",
                    borderRadius: 10,
                    overflow: "hidden",
                    color: "var(--v2-text-1)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      aspectRatio: "16 / 9",
                      width: "100%",
                      background: "rgba(0,0,0,0.35)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                  >
                    {job.previewThumbnailId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/thumbnails/image/${job.previewThumbnailId}`}
                        alt=""
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#ff7b72",
                          padding: 10,
                          textAlign: "center",
                        }}
                      >
                        no thumbnail
                      </span>
                    )}
                    {job.previewThumbnailId && !job.hasSelected && (
                      <span style={{ position: "absolute", left: 6, top: 6 }}>
                        <Badge tone="warn">none selected</Badge>
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {job.title}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--v2-text-3)" }}>
                      {job.channelName ?? "no channel"} · {job.status}
                    </span>
                    {/* Who made it. Without this the list is anonymous, which
                        is what made "am I seeing the VAs' too?" unanswerable. */}
                    <span style={{ fontSize: 10, color: "var(--v2-text-3)" }}>
                      {job.producerName ?? "unattributed"}
                      {job.producerRole ? ` · ${job.producerRole}` : ""}
                    </span>
                    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {job.completedCount === 0 ? (
                        <Badge tone="bad">no thumbnail</Badge>
                      ) : (
                        <Badge tone="neutral">{job.completedCount} ready</Badge>
                      )}
                      {job.hasSelected && <Badge tone="good">selected</Badge>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {hasMore && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 14,
              }}
            >
              <V2Button
                variant="outline"
                disabled={searching}
                onClick={loadMore}
              >
                {searching ? "Loading…" : "Load more"}
              </V2Button>
            </div>
          )}
        </div>
      </V2Card>

      {selectedJob && (
        <V2Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {selectedJob.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                {selectedJob.kind === "tutorial_job"
                  ? "Tutorial video"
                  : "Content job"}{" "}
                · {selectedJob.channelName ?? "no channel"} ·{" "}
                {selectedJob.producerName ?? "unattributed"}
              </div>
            </div>

            {/* Regenerate controls */}
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "minmax(200px, 1fr) minmax(240px, 2fr)",
                alignItems: "start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={labelStyle}>Reference style (archetype)</span>
                <V2Listbox
                  value={archetypeId}
                  onChange={setArchetypeId}
                  searchable
                  options={[
                    {
                      value: "",
                      label: "Keep current style",
                      hint: "reuse the archetype this thumbnail was made from",
                    },
                    ...archetypes.map((a) => ({
                      value: a.id,
                      label: a.name,
                      hint: a.category,
                      thumbnailUrl: `/api/thumbnails/archetypes/${a.id}/image`,
                    })),
                  ]}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="thumb-instructions" style={labelStyle}>
                  What should change?
                </label>
                <textarea
                  id="thumb-instructions"
                  style={{ ...inputStyle, minHeight: 66, resize: "vertical" }}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. bigger text, put the host on the right, drop the red arrow"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <V2Button
                variant="outline"
                disabled={busy}
                onClick={() => void regenerate("same")}
              >
                Regenerate
              </V2Button>
              <V2Button
                variant="accent"
                disabled={busy}
                onClick={() => void regenerate("changes")}
              >
                Regenerate with changes
              </V2Button>
              <V2Button
                variant="outline"
                disabled={busy}
                onClick={() => void regenerate("iterate")}
              >
                Tweak this image
              </V2Button>
            </div>
            <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
              &ldquo;Regenerate with changes&rdquo; rebuilds from the reference
              style and folds your instruction into the prompt. &ldquo;Tweak
              this image&rdquo; edits the existing picture and changes nothing
              else.
            </span>

            {notice && (
              <div style={{ fontSize: 12, color: "#7ee787" }}>{notice}</div>
            )}
            {error && (
              <div style={{ fontSize: 12, color: "var(--v2-error)" }}>
                {error}
              </div>
            )}

            {/* Gallery */}
            {loadingRows && rows.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
                Loading thumbnails…
              </div>
            )}
            {!loadingRows && rows.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
                No thumbnails have ever been generated for this video. Hit
                Regenerate to make one.
              </div>
            )}
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              }}
            >
              {rows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    border: row.is_selected
                      ? "2px solid var(--v2-accent)"
                      : "1px solid var(--v2-border-1)",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--v2-surface-2)",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "16 / 9",
                      background: "rgba(0,0,0,0.35)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {row.status === "completed" && row.output_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/thumbnails/image/${row.id}`}
                        alt="Generated thumbnail"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--v2-text-3)",
                          padding: 10,
                          textAlign: "center",
                        }}
                      >
                        {PENDING.has(row.status)
                          ? "Generating…"
                          : (row.error_message ?? row.status)}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {row.is_selected && <Badge tone="good">selected</Badge>}
                      <Badge
                        tone={
                          row.status === "completed"
                            ? "neutral"
                            : row.status === "failed"
                              ? "bad"
                              : "warn"
                        }
                      >
                        {row.status}
                      </Badge>
                      <Badge tone="neutral">{row.generation_kind}</Badge>
                      {row.provider_used && (
                        <Badge tone="neutral">{row.provider_used}</Badge>
                      )}
                      {row.fallback_used && <Badge tone="warn">fallback</Badge>}
                      {row.reference_paths?.persona && (
                        <Badge tone="good">persona ref</Badge>
                      )}
                    </div>
                    {row.headline_text && (
                      <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                        &ldquo;{row.headline_text}&rdquo;
                        {row.headline_source === "title_fallback" && (
                          <span style={{ color: "#e3b341" }}>
                            {" "}
                            (title fallback)
                          </span>
                        )}
                      </span>
                    )}
                    <V2Button
                      size="sm"
                      variant={row.is_selected ? "ghost" : "accent"}
                      disabled={
                        busy || row.is_selected || row.status !== "completed"
                      }
                      onClick={() => void selectThisOne(row.id)}
                    >
                      {row.is_selected ? "In use" : "Use this one"}
                    </V2Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </V2Card>
      )}
    </div>
  );
}
