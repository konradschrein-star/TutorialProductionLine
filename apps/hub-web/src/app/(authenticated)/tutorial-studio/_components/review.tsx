"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Card } from "../../_components";

/**
 * Review tab — the VA's end-of-day pass over what they produced.
 *
 * The owner's instruction, verbatim: "At end of day the VA sees all their jobs
 * (this is deliberately motivating — they see how much they produced), and
 * approves or disapproves each. Disapprove deletes the video, including from
 * Drive. Approve or no action = it stays. They review the thumbnail the same
 * way, with a regenerate button when it looks bad."
 *
 * THREE THINGS THAT SENTENCE DICTATES, and that this component is built around:
 *
 *  1. THE COUNT IS THE POINT. "Deliberately motivating" is a design
 *     requirement, not decoration. The first thing on screen is how many videos
 *     this VA finished today, big. The list is the evidence for that number,
 *     not a work queue.
 *
 *  2. NOTHING HERE BLOCKS ANYTHING. Every video in this list has already been
 *     delivered. A VA can close the tab having pressed nothing and no job
 *     stalls, no delivery waits, nothing changes. Unreviewed is a permanent,
 *     valid state — which is why there is no "0 remaining" progress bar and no
 *     nagging.
 *
 *  3. DISAPPROVE IS THE ONLY DESTRUCTIVE ACTION IN THE PRODUCT, so it asks
 *     first and says exactly what it will do. Nothing else in this system
 *     deletes a finished video — not a timer, not a heuristic. (`job-auto-delete`
 *     used to, which is why that is now stated in several places.)
 *
 * WHAT THEY ARE ACTUALLY REVIEWING. The first build of this tab showed neither
 * the thumbnail nor the video — four chips and three buttons, asking a human to
 * approve something they could not see. Both are here now, and the way they are
 * loaded is deliberate:
 *
 *   - The thumbnail is the row. It is what a VA scrolls; the owner's own read is
 *     that they will scan thumbnails and rarely open a video. `loading="lazy"`
 *     means the browser only fetches the ones on screen.
 *   - EXACTLY ONE <video> is mounted at a time, YouTube-style: click a card and
 *     it becomes a player, click another and the first reverts to its poster.
 *     Mounting 50 players would have every one of them opening a range request
 *     against a 200 MB MP4 on the same box that renders video.
 */

interface ReviewJob {
  id: string;
  title: string;
  channelName: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  reviewStatus: "approved" | "disapproved" | null;
  reviewedAt: string | null;
  qaStatus: string | null;
  qaSummary: string | null;
  thumbnailId: string | null;
  hasThumbnail: boolean;
  inDrive: boolean;
  hasDescription: boolean;
  hasTags: boolean;
  playable: boolean;
  mine: boolean;
}

interface ReviewResponse {
  hours: number;
  scope: "mine" | "all";
  canSeeEveryone: boolean;
  producedCount: number;
  approvedCount: number;
  disapprovedCount: number;
  jobs: ReviewJob[];
}

function humanDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0
    ? `${m}:${String(s % 60).padStart(2, "0")}`
    : `0:${String(s).padStart(2, "0")}`;
}

function timeOfDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Review() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hours, setHours] = useState(18);
  const [scopeAll, setScopeAll] = useState(false);
  // The one open player. Null = every card is a still. See the header note.
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/production/tutorial-review?hours=${hours}${scopeAll ? "&scope=all" : ""}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ReviewResponse);
    } catch (err) {
      toast.error(
        `Could not load your review list: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  }, [hours, scopeAll]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changing the window or the scope replaces the list, so an open player would
  // be pointing at a card that is no longer there.
  useEffect(() => {
    setPlayingId(null);
  }, [hours, scopeAll]);

  const act = useCallback(
    async (job: ReviewJob, action: "approve" | "disapprove") => {
      if (action === "disapprove") {
        const ok = window.confirm(
          `Delete "${job.title}"?\n\n` +
            `This removes the video from Google Drive${job.inDrive ? "" : " (it is not in Drive)"} ` +
            `and from the server. It cannot be undone.\n\n` +
            `If you only want to leave it alone, press Cancel — doing nothing keeps it.`,
        );
        if (!ok) return;
      }
      setBusyId(job.id);
      try {
        const res = await fetch(`/api/production/tutorial-review/${job.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        toast.success(
          action === "approve" ? "Approved" : `Deleted "${job.title}"`,
        );
        if (action === "disapprove" && playingId === job.id) setPlayingId(null);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [load, playingId],
  );

  const regenerateThumbnail = useCallback(async (job: ReviewJob) => {
    setBusyId(job.id);
    try {
      const res = await fetch(`/api/production/jobs/${job.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "same" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        "Thumbnail queued — it replaces the picture here once it renders.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  if (loading) {
    return <V2Card style={{ padding: 24 }}>Loading your day…</V2Card>;
  }
  if (!data) return null;

  const unreviewed = data.jobs.filter((j) => j.reviewStatus === null).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* The count first, and big. This is the motivating part. */}
      <V2Card style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 48, fontWeight: 700, lineHeight: 1 }}>
            {data.producedCount}
          </span>
          <span style={{ fontSize: 18, opacity: 0.85 }}>
            {data.producedCount === 1 ? "video finished" : "videos finished"} in
            the last {data.hours} hours
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {[18, 48, 168].map((h) => (
              <V2Button
                key={h}
                variant={h === hours ? "accent" : "outline"}
                onClick={() => {
                  setHours(h);
                  setLoading(true);
                }}
              >
                {h === 18 ? "Today" : h === 48 ? "2 days" : "This week"}
              </V2Button>
            ))}
            {/* Oversight only. A VA never sees this button and cannot reach
                anyone else's work by editing the URL — the API decides. */}
            {data.canSeeEveryone && (
              <V2Button
                variant={scopeAll ? "accent" : "outline"}
                onClick={() => {
                  setScopeAll((v) => !v);
                  setLoading(true);
                }}
              >
                {scopeAll ? "All VAs" : "Just mine"}
              </V2Button>
            )}
          </span>
        </div>
        <div style={{ marginTop: 12, fontSize: 14, opacity: 0.7 }}>
          {data.approvedCount} approved · {data.disapprovedCount} deleted ·{" "}
          {unreviewed} not looked at yet — and that is fine, nothing is waiting
          on you.
        </div>
      </V2Card>

      {data.jobs.length === 0 && (
        <V2Card style={{ padding: 24, opacity: 0.8 }}>
          Nothing finished in this window yet.
        </V2Card>
      )}

      {data.jobs.map((job) => {
        const busy = busyId === job.id;
        const gone = job.reviewStatus === "disapproved";
        const playing = playingId === job.id;
        return (
          <V2Card
            key={job.id}
            style={{ padding: 16, opacity: gone ? 0.45 : 1 }}
          >
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              {/* Poster / player. Fixed 16:9 so the list does not jump as
                  pictures arrive. */}
              <div
                style={{
                  flex: "0 0 320px",
                  maxWidth: "100%",
                  aspectRatio: "16 / 9",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "rgba(0,0,0,0.45)",
                  position: "relative",
                }}
              >
                {playing ? (
                  <video
                    src={`/api/production/jobs/${job.id}/download?inline=1`}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      background: "#000",
                    }}
                    onError={() =>
                      toast.error(
                        "That video could not be opened — the file may no longer be on the server.",
                      )
                    }
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      job.playable
                        ? setPlayingId(job.id)
                        : toast.error(
                            "There is no video file on the server for this one, so it cannot be played.",
                          )
                    }
                    title={job.playable ? "Play" : "No video file on disk"}
                    style={{
                      all: "unset",
                      display: "block",
                      width: "100%",
                      height: "100%",
                      cursor: job.playable ? "pointer" : "not-allowed",
                      position: "relative",
                    }}
                  >
                    {job.thumbnailId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/production/jobs/${job.id}/thumbnail/${job.thumbnailId}`}
                        alt=""
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          opacity: 0.6,
                          textAlign: "center",
                          padding: 12,
                        }}
                      >
                        No thumbnail yet
                      </span>
                    )}

                    {/* Play affordance — only when there is something to play. */}
                    {job.playable && (
                      <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: "50%",
                            background: "rgba(0,0,0,0.55)",
                            border: "1px solid rgba(255,255,255,0.5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 18,
                            paddingLeft: 4,
                          }}
                        >
                          ▶
                        </span>
                      </span>
                    )}

                    {!job.playable && (
                      <span
                        style={{
                          position: "absolute",
                          left: 8,
                          top: 8,
                          padding: "2px 7px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          background: "rgba(127,29,29,0.9)",
                          color: "#fee2e2",
                        }}
                      >
                        FILE MISSING
                      </span>
                    )}

                    {job.durationSeconds !== null && (
                      <span
                        style={{
                          position: "absolute",
                          right: 8,
                          bottom: 8,
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: "rgba(0,0,0,0.8)",
                          color: "#fff",
                        }}
                      >
                        {humanDuration(job.durationSeconds)}
                      </span>
                    )}
                  </button>
                )}
              </div>

              <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {job.title}
                  {gone && (
                    <span style={{ marginLeft: 8, color: "#ef4444" }}>
                      — deleted
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
                  {job.channelName ?? "no channel"} · finished{" "}
                  {timeOfDay(job.completedAt)}
                  {data.scope === "all" && !job.mine && " · another VA"}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    fontSize: 12,
                  }}
                >
                  <Chip ok={job.inDrive} label="in Drive" />
                  <Chip ok={job.hasThumbnail} label="thumbnail" />
                  <Chip ok={job.hasDescription} label="description" />
                  <Chip ok={job.hasTags} label="tags" />
                </div>

                {job.qaStatus === "failed" && job.qaSummary && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 8,
                      borderRadius: 6,
                      background: "#7f1d1d",
                      color: "#fee2e2",
                      fontSize: 12,
                    }}
                  >
                    Quality check held this one back: {job.qaSummary}
                  </div>
                )}

                {!gone && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 14,
                    }}
                  >
                    {playing && (
                      <V2Button
                        variant="outline"
                        onClick={() => setPlayingId(null)}
                      >
                        Close player
                      </V2Button>
                    )}
                    <V2Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void regenerateThumbnail(job)}
                    >
                      Regenerate thumbnail
                    </V2Button>
                    <V2Button
                      variant={
                        job.reviewStatus === "approved" ? "accent" : "outline"
                      }
                      disabled={busy || job.reviewStatus === "approved"}
                      onClick={() => void act(job, "approve")}
                    >
                      {job.reviewStatus === "approved" ? "Approved" : "Approve"}
                    </V2Button>
                    <V2Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void act(job, "disapprove")}
                    >
                      Delete
                    </V2Button>
                  </div>
                )}
              </div>
            </div>
          </V2Card>
        );
      })}
    </div>
  );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${ok ? "#22c55e" : "#6b7280"}`,
        color: ok ? "#22c55e" : "#9ca3af",
      }}
    >
      {ok ? "✓" : "—"} {label}
    </span>
  );
}
