"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { V2Button, V2Card } from "../../_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import { StatusChip } from "../ranking/_lib/ranking-status";

/**
 * Ranking tab — the VA's lane for tier-list videos.
 *
 * WHY IT LIVES IN TUTORIAL STUDIO. RANKING stays a first-class content format
 * with its own /jobs surface. This tab exists because the VAs live in this
 * tool: making them learn a second app to run a second format is how a format
 * quietly stops being produced. Everything here is the same shape they already
 * know from the Studio tab — a create box, a list, a status chip, an action.
 *
 * WHAT IS DIFFERENT FROM A TUTORIAL. A tutorial needs the VA to record their
 * screen; a ranking does not. RANKING is fully narrated over fetched product
 * footage and a tier board, so there is no recording step, no microphone, no
 * splice. The VA's only creative job is picking and trimming the B-roll per
 * item, and that already has a purpose-built tool (the B-Roll Studio at
 * /jobs/[id]/va-review). So this tab does exactly three things: start a
 * ranking, watch it, and hand it to that studio when it is ready.
 *
 * THE GATE IS NON-BLOCKING BY DESIGN. Nothing here waits on Konrad. The VA
 * confirms their own B-roll picks, the job proceeds in the background, and they
 * start the next one. The only hard stop in the whole lane is the submit in the
 * B-Roll Studio, which refuses a job with unfilled blocks — that is a
 * completeness check on the VA's own work, not an approval from anyone else.
 *
 * HOW THE LIST STAYS FAST. Two separate requests, because the list and the
 * live-status poll have opposite shapes:
 *
 *   - The list is PAGED and fetched on demand ("Load more"). It never grows
 *     the payload just because the VA has been productive.
 *   - The 5s poll asks only for jobs that are still MOVING (`?view=active`),
 *     which is a handful no matter how many rankings exist, and merges them in.
 *
 * The previous version polled all 50 rows including each one's `metadata` and
 * `script` — on prod that is up to 33 kB per row of data the list never shows,
 * every five seconds. The same mistake in the tutorial list produced a 1.37 MB
 * body per poll and is documented in `/api/production/jobs/route.ts`.
 */

interface RankingJobRow {
  id: string;
  topic: string;
  status: string;
  itemCount: number;
  scriptWords: number;
  blocksTotal: number;
  blocksPending: number;
  jobMode: string;
  errorMessage: string | null;
  isTerminal: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  channels: Array<{ id: string; name: string }>;
}

const PAGE = 20;

/** Newest first, de-duplicated by id. Incoming rows win. */
function mergeRows(
  existing: RankingJobRow[],
  incoming: RankingJobRow[],
): RankingJobRow[] {
  const map = new Map(existing.map((j) => [j.id, j]));
  for (const j of incoming) map.set(j.id, j);
  return [...map.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function ProductionRanking({ channels }: Props) {
  const router = useRouter();
  const [jobs, setJobs] = useState<RankingJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [awaitingCount, setAwaitingCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Pages fetched from the LIST lane. Offsets are derived from this rather
   *  than from `jobs.length`, which the active-poll merge can inflate. */
  const [pages, setPages] = useState(1);
  const [brief, setBrief] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [fullAuto, setFullAuto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Ids that were still moving at the last poll — see the poll effect. */
  const activeIds = useRef<Set<string>>(new Set());

  /** Fetch one page of the list and merge it in. */
  const loadPage = useCallback(async (offset: number) => {
    try {
      const res = await fetch(
        `/api/production/ranking/jobs?limit=${PAGE}&offset=${offset}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        jobs: RankingJobRow[];
        total: number;
        awaitingSelectionCount?: number;
      };
      setJobs((prev) => mergeRows(prev, data.jobs));
      setTotal(data.total);
      setAwaitingCount(data.awaitingSelectionCount ?? 0);
    } catch {
      // Network blips are not worth a toast.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  /**
   * Live status. Asks only for jobs that are still moving, so the cost of this
   * poll is set by how many rankings are in flight, never by how many exist.
   *
   * Runs only while something is actually moving, matching the Studio tab — a
   * list of finished rankings must not keep hitting the database forever.
   *
   * When a job DROPS OUT of the active set it has just reached a terminal
   * state, and its merged row would otherwise sit here saying "Rendering"
   * forever — so that transition, and only that transition, triggers a refetch
   * of page 0, where a just-finished job necessarily is.
   */
  const anythingMoving = jobs.some((j) => !j.isTerminal);

  useEffect(() => {
    if (!anythingMoving) {
      // Nothing in flight. Forget the last active set too, so a later restart
      // does not read its own cold start as "a job just settled".
      activeIds.current = new Set();
      return;
    }

    async function pollActive() {
      try {
        const res = await fetch("/api/production/ranking/jobs?view=active");
        if (!res.ok) return;
        const data = (await res.json()) as {
          jobs: RankingJobRow[];
          awaitingSelectionCount?: number;
        };
        setJobs((prev) => mergeRows(prev, data.jobs));
        setAwaitingCount(data.awaitingSelectionCount ?? 0);

        const now = new Set(data.jobs.map((j) => j.id));
        let settled = false;
        for (const id of activeIds.current) {
          if (!now.has(id)) settled = true;
        }
        activeIds.current = now;
        if (settled) await loadPage(0);
      } catch {
        // Ignore — the next tick tries again.
      }
    }

    timer.current = setInterval(() => void pollActive(), 5000);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [anythingMoving, loadPage]);

  async function create() {
    if (!channelId) {
      toast.error("Pick a channel first.");
      return;
    }
    if (brief.trim().length < 10) {
      toast.error("Say a bit more about what to rank.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/production/ranking/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          brief: brief.trim(),
          jobMode: fullAuto ? "full_auto" : "asset_quality_loop",
        }),
      });
      const data = (await res.json()) as { error?: string; topic?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not start the ranking.");
        return;
      }
      toast.success(`Started "${data.topic}". It appears below in a moment.`);
      setBrief("");
      setTimeout(() => void loadPage(0), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/production/ranking/jobs/${id}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; newStatus?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Retry failed.");
        return;
      }
      toast.success(`Retrying from ${data.newStatus}.`);
      await loadPage(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The axe. Deleting a video is destructive and irreversible, so the confirm
   * names what actually goes — and the Drive file count is READ from the job
   * before asking, rather than guessed, because "and anything in Drive" is not
   * something a person can weigh.
   */
  async function destroy(job: RankingJobRow) {
    setBusyId(job.id);
    try {
      let driveCount = 0;
      try {
        const probe = await fetch(`/api/production/ranking/jobs/${job.id}`);
        if (probe.ok) {
          const detail = (await probe.json()) as {
            drive?: { artifacts?: Array<{ driveFileId: string | null }> };
          };
          driveCount = (detail.drive?.artifacts ?? []).filter(
            (a) => a.driveFileId,
          ).length;
        }
      } catch {
        // Fall through — the confirm below says the count is unknown rather
        // than claiming a number it does not have.
      }

      const lines = [
        `Delete "${job.topic || job.id}"?`,
        "",
        "This permanently removes:",
        "  • the rendered video and every image on the server",
        driveCount > 0
          ? `  • ${driveCount} file${driveCount === 1 ? "" : "s"} already in Google Drive`
          : "  • nothing in Google Drive (this job has no Drive copies)",
        "",
        "The job's error message is kept so the failure can still be read.",
        "This cannot be undone.",
      ];
      if (!window.confirm(lines.join("\n"))) return;

      const res = await fetch(`/api/production/ranking/jobs/${job.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Delete failed.");
        return;
      }
      toast.success("Ranking deleted.");
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  // The list is paged, so the number of jobs waiting on a human is taken from
  // the API's count over ALL rows — never from `jobs.length`. Counting the
  // page is not counting the queue.
  const waiting = jobs.filter((j) => j.status === "AWAITING_VA_REVIEW");
  const hiddenWaiting = Math.max(0, awaitingCount - waiting.length);
  // Derived, not stored: a refetch of page 0 while later pages are loaded must
  // not re-arm a button the VA has already consumed.
  const hasMore = jobs.length < total;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Create ─────────────────────────────────────────────────────── */}
      <V2Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 2,
              }}
            >
              Start a ranking video
            </div>
            <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
              Say what to rank. The script writer picks the items, decides the
              order and the tiers, and writes the narration. You do not record
              anything for a ranking.
            </div>
          </div>

          <div style={{ maxWidth: 360 }}>
            <V2Listbox
              label="Channel"
              value={channelId}
              onChange={setChannelId}
              options={channels.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Pick a channel"
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--v2-text-2)",
                marginBottom: 6,
              }}
            >
              What do you want to rank?
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder={
                'e.g. "Best noise cancelling headphones under three hundred dollars"\n\nOr paste a rough list, or a whole script if you already have one.'
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--v2-border)",
                background: "var(--v2-surface-2)",
                color: "var(--v2-text-1)",
                fontSize: 12,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <V2Button
              variant={fullAuto ? "outline" : "accent"}
              onClick={() => setFullAuto(false)}
            >
              I&apos;ll pick the B-roll
            </V2Button>
            <V2Button
              variant={fullAuto ? "accent" : "outline"}
              onClick={() => setFullAuto(true)}
            >
              Full auto
            </V2Button>
            <span style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
              {fullAuto
                ? "Renders the first clips it finds. Nobody looks at them."
                : "The job waits for you to choose and trim footage per item."}
            </span>
          </div>

          <div>
            <V2Button
              variant="accent"
              onClick={() => void create()}
              disabled={submitting || !channelId || brief.trim().length < 10}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                trophy
              </span>
              {submitting ? "Starting…" : "Start ranking"}
            </V2Button>
          </div>
        </div>
      </V2Card>

      {/* ── Your turn ──────────────────────────────────────────────────── */}
      {awaitingCount > 0 && (
        <V2Card style={{ borderColor: "#22c55e55" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#22c55e",
              marginBottom: 8,
            }}
          >
            {awaitingCount} ranking{awaitingCount === 1 ? "" : "s"} waiting for
            you
          </div>
          {hiddenWaiting > 0 && (
            <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 8 }}>
              {hiddenWaiting} of them {hiddenWaiting === 1 ? "is" : "are"} older
              than the {jobs.length} loaded below — press “Load more” to reach{" "}
              {hiddenWaiting === 1 ? "it" : "them"} so none get stranded.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {waiting.map((j) => (
              <div
                key={j.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--v2-text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {j.topic}
                </span>
                <V2Button
                  variant="accent"
                  onClick={() => router.push(`/jobs/${j.id}/va-review`)}
                >
                  Pick B-roll ({j.blocksPending} left)
                </V2Button>
              </div>
            ))}
          </div>
        </V2Card>
      )}

      {/* ── All rankings ───────────────────────────────────────────────── */}
      <V2Card noPadding>
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--v2-border)",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--v2-text-1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Rankings</span>
          {total > 0 && (
            <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>
              showing {jobs.length} of {total}
            </span>
          )}
        </div>

        {!loaded && (
          <div style={{ padding: 16, fontSize: 11, color: "var(--v2-text-2)" }}>
            Loading…
          </div>
        )}

        {loaded && jobs.length === 0 && (
          <div style={{ padding: 16, fontSize: 11, color: "var(--v2-text-2)" }}>
            No ranking videos yet. Start one above.
          </div>
        )}

        {jobs.map((j) => (
          <div
            key={j.id}
            role="link"
            tabIndex={0}
            onClick={() => router.push(`/tutorial-studio/ranking/${j.id}`)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/tutorial-studio/ranking/${j.id}`);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderBottom: "1px solid var(--v2-border)",
              cursor: "pointer",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--v2-text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {j.topic || "(untitled)"}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-2)",
                  marginTop: 2,
                }}
              >
                {j.itemCount > 0
                  ? `${j.itemCount} items`
                  : "items not chosen yet"}
                {j.scriptWords > 0 ? ` · ${j.scriptWords} words` : ""}
                {j.blocksTotal > 0
                  ? ` · ${j.blocksTotal - j.blocksPending}/${j.blocksTotal} blocks filled`
                  : ""}
                {j.jobMode === "full_auto" ? " · full auto" : ""}
              </div>
              {j.status.startsWith("FAILED_") && j.errorMessage && (
                <div
                  style={{
                    fontSize: 10,
                    color: "#ef4444",
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={j.errorMessage}
                >
                  {j.errorMessage}
                </div>
              )}
            </div>

            <StatusChip status={j.status} />

            {j.status === "AWAITING_VA_REVIEW" && (
              <V2Button
                variant="accent"
                onClick={(e) => {
                  e?.stopPropagation();
                  router.push(`/jobs/${j.id}/va-review`);
                }}
              >
                Pick B-roll
              </V2Button>
            )}
            {j.status.startsWith("FAILED_") &&
              j.status !== "FAILED_IRRECOVERABLE" && (
                <V2Button
                  variant="outline"
                  onClick={(e) => {
                    e?.stopPropagation();
                    void retry(j.id);
                  }}
                  disabled={busyId === j.id}
                >
                  {busyId === j.id ? "Working…" : "Retry"}
                </V2Button>
              )}
            {/* The axe. Failed jobs only — see the DELETE handler for why an
                axe that can also take a published video is a different tool. */}
            {j.status.startsWith("FAILED_") && (
              <V2Button
                variant="ghost"
                title="Delete this ranking and its files"
                disabled={busyId === j.id}
                onClick={(e) => {
                  e?.stopPropagation();
                  void destroy(j);
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 15, color: "#ef4444", opacity: 0.75 }}
                >
                  delete
                </span>
              </V2Button>
            )}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, opacity: 0.4 }}
            >
              chevron_right
            </span>
          </div>
        ))}

        {hasMore && (
          <div style={{ padding: 12, textAlign: "center" }}>
            <V2Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void loadPage(pages * PAGE).finally(() => {
                  setPages((p) => p + 1);
                  setLoadingMore(false);
                });
              }}
            >
              {loadingMore ? "Loading…" : `Load more (${total - jobs.length})`}
            </V2Button>
          </div>
        )}
      </V2Card>
    </div>
  );
}
