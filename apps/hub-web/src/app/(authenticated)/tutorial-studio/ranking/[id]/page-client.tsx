"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { V2Button, V2Card } from "../../../_components";
import { StatusChip } from "../_lib/ranking-status";

/**
 * One ranking video, and everything the VA can do with it.
 *
 * ## Why this page exists
 *
 * A finished ranking used to be a dead end. The list linked to `/jobs/[id]`,
 * the generic job page, which offers a RANKING job nothing it can act on: the
 * render never registers itself in `r2_asset_manifest`, so the asset routes
 * 404, and the Drive scanner never picks the video up, so there is no link
 * either. The owner's words were "right now I am not able to do shit with the
 * thing that is apparently ready to be uploaded" — and that was literally
 * true.
 *
 * So this page answers, per state, the one question that state raises:
 *
 *   delivered  → where is it in Drive (the stored link, never a guessed one)
 *   rendered   → play it, download it, and what is holding the upload up
 *   failed     → the real error, the item-name repair, and the retry
 *   working    → which stage it is at
 */

interface DriveArtifact {
  kind: string;
  state: string;
  driveFileId: string | null;
  driveWebLink: string | null;
  bytes: number | null;
  uploadedAt: string | null;
  errorMessage: string | null;
}

interface RankingItem {
  id: string;
  name: string;
  pronunciation: string | null;
  anchored: boolean;
  approved: boolean;
  skipped: boolean;
}

interface RankingDetail {
  id: string;
  topic: string;
  title: string | null;
  status: string;
  channelId: string;
  jobMode: string;
  createdAt: string;
  updatedAt: string;
  renderCompletedAt: string | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  errorDetail: unknown;
  retryCount: number;
  items: RankingItem[];
  video: {
    available: boolean;
    source: string | null;
    sizeBytes: number | null;
    checked: Array<{ source: string; path: string; exists: boolean }>;
    streamUrl: string | null;
    downloadUrl: string | null;
  };
  drive: {
    deliveredToDrive: boolean;
    folderPath: string | null;
    artifacts: DriveArtifact[];
  };
  blockers: string[];
  ownedBy: string | null;
  canRetry: boolean;
  canDelete: boolean;
  canPickBRoll: boolean;
}

function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <V2Card>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--v2-text-1)",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </V2Card>
  );
}

/**
 * Repair item names on a FAILED ranking job.
 *
 * Anchoring locates each item by listening for its name in the narration. When
 * the TTS/Whisper pair cannot carry a name the job fails — correctly. The
 * failure message used to say "edit metadata.ranking.items[].name", which is a
 * database instruction printed for a VA.
 *
 * Renaming and retrying are separate on purpose, so a VA can fix several names,
 * read them back, and retry once. This lived in the list; it belongs here,
 * immediately above the Retry button it is meant to precede — and keeping it
 * out of the list is what lets the list ship summary rows only.
 */
function ItemNameRepair({
  jobId,
  items,
  onSaved,
}: {
  jobId: string;
  items: RankingItem[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (items.length === 0) return null;

  const dirty = items.some(
    (it) => draft[it.id] !== undefined && draft[it.id]!.trim() !== it.name,
  );

  async function save() {
    setSaving(true);
    try {
      const payload = items
        .filter(
          (it) =>
            draft[it.id] !== undefined &&
            draft[it.id]!.trim() !== "" &&
            draft[it.id]!.trim() !== it.name,
        )
        .map((it) => ({ id: it.id, name: draft[it.id]!.trim() }));
      if (payload.length === 0) return;
      const res = await fetch(`/api/production/ranking/jobs/${jobId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Names saved — now press Retry");
      setDraft({});
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 8 }}>
        Spell each item the way the narrator actually says it. A name marked
        &ldquo;not found&rdquo; was never heard in the audio, so its footage
        cannot be placed.
      </div>
      {items.map((it) => (
        <div
          key={it.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              width: 74,
              color: it.anchored ? "#22c55e" : "#ef4444",
            }}
          >
            {it.anchored ? "found" : "not found"}
          </span>
          <input
            value={draft[it.id] ?? it.name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [it.id]: e.target.value }))
            }
            style={{
              flex: 1,
              fontSize: 12,
              padding: "5px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.25)",
              color: "inherit",
            }}
          />
        </div>
      ))}
      <V2Button variant="accent" disabled={!dirty || saving} onClick={save}>
        {saving ? "Saving…" : "Save names"}
      </V2Button>
    </div>
  );
}

export function RankingDetailClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<RankingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/ranking/jobs/${jobId}`);
      const body = (await res.json()) as RankingDetail & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setJob(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while the job is still moving, so a VA who opens a rendering job
  // sees it become playable without reloading. Stops dead once it settles.
  useEffect(() => {
    if (!job) return;
    const settled =
      job.status.startsWith("FAILED_") ||
      job.status === "PUBLISHED" ||
      job.status === "AWAITING_VA_REVIEW" ||
      job.status === "AWAITING_UPLOADER";
    if (settled) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [job, load]);

  async function retry() {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/production/ranking/jobs/${job.id}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; newStatus?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Retry failed.");
        return;
      }
      toast.success(`Retrying from ${data.newStatus}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!job) return;
    // Say exactly what goes, before it goes. The Drive count is read from the
    // job's real artifacts, not assumed.
    const driveCount = job.drive.artifacts.filter((a) => a.driveFileId).length;
    const parts = [
      `Delete "${job.topic || job.title || job.id}"?`,
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
    if (!window.confirm(parts.join("\n"))) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/production/ranking/jobs/${job.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Delete failed.");
        return;
      }
      toast.success("Ranking deleted.");
      router.push("/tutorial-studio?tab=ranking");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <V2Card>
          <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div>
          <div style={{ marginTop: 10 }}>
            <V2Button
              variant="outline"
              onClick={() => router.push("/tutorial-studio?tab=ranking")}
            >
              Back to rankings
            </V2Button>
          </div>
        </V2Card>
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ padding: 24, fontSize: 12, color: "var(--v2-text-2)" }}>
        Loading…
      </div>
    );
  }

  // Anything that reached Drive at all. A row with a file id but no recorded
  // link is still shown — saying "it is in Drive but no link was saved" is
  // useful; inventing a URL from the id would not be.
  const deliveredArtifacts = job.drive.artifacts.filter((a) => a.driveFileId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        maxWidth: 900,
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <V2Button
          variant="ghost"
          onClick={() => router.push("/tutorial-studio?tab=ranking")}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            arrow_back
          </span>
        </V2Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--v2-text-1)",
            }}
          >
            {job.topic || job.title || "(untitled)"}
          </div>
          <div
            style={{ fontSize: 10, color: "var(--v2-text-2)", marginTop: 2 }}
          >
            Started {new Date(job.createdAt).toLocaleString()}
            {job.jobMode === "full_auto" ? " · full auto" : ""}
            {job.retryCount > 0 ? ` · retried ${job.retryCount}×` : ""}
          </div>
        </div>
        <StatusChip status={job.status} />
      </div>

      {/* ── Your turn ────────────────────────────────────────────────────── */}
      {job.canPickBRoll && (
        <V2Card style={{ borderColor: "#22c55e55" }}>
          <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>
            This ranking is waiting for you to choose and trim its footage.
          </div>
          <V2Button
            variant="accent"
            onClick={() => router.push(`/jobs/${job.id}/va-review`)}
          >
            Open B-Roll Studio
          </V2Button>
        </V2Card>
      )}

      {/* ── The video ────────────────────────────────────────────────────── */}
      {job.video.available && job.video.streamUrl && (
        <Section title="The video">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={job.video.streamUrl}
            controls
            style={{
              width: "100%",
              borderRadius: 8,
              background: "#000",
              maxHeight: 460,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
            }}
          >
            <V2Button
              variant="outline"
              onClick={() => {
                if (job.video.downloadUrl) {
                  window.location.href = job.video.downloadUrl;
                }
              }}
            >
              Download
            </V2Button>
            <span style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
              {formatBytes(job.video.sizeBytes)}
              {job.durationSeconds
                ? ` · ${Math.floor(job.durationSeconds / 60)}m ${job.durationSeconds % 60}s`
                : ""}
            </span>
          </div>
        </Section>
      )}

      {/* ── Google Drive ─────────────────────────────────────────────────── */}
      {(deliveredArtifacts.length > 0 ||
        job.status === "AWAITING_UPLOADER") && (
        <Section title="Google Drive">
          {job.drive.folderPath && (
            <div
              style={{
                fontSize: 10,
                color: "var(--v2-text-2)",
                marginBottom: 8,
              }}
            >
              {job.drive.folderPath}
            </div>
          )}
          {deliveredArtifacts.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
              Nothing from this ranking is in Drive yet.
            </div>
          )}
          {deliveredArtifacts.map((a) => (
            <div
              key={a.kind}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                borderBottom: "1px solid var(--v2-border)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--v2-text-1)",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {a.kind.replace(/_/g, " ")}
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--v2-text-2)",
                    marginLeft: 8,
                  }}
                >
                  {formatBytes(a.bytes)}
                  {a.uploadedAt
                    ? ` · ${new Date(a.uploadedAt).toLocaleDateString()}`
                    : ""}
                </span>
              </span>
              {/* The stored link, verbatim. Nothing here is assembled from a
                  file id — an invented Drive URL that happens to 404 is worse
                  than no button. */}
              {a.driveWebLink ? (
                <a
                  href={a.driveWebLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    color: "#3b82f6",
                    textDecoration: "none",
                  }}
                >
                  Open in Drive →
                </a>
              ) : (
                <span style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
                  in Drive, no link recorded
                </span>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* ── What is blocking it ──────────────────────────────────────────── */}
      {job.blockers.length > 0 && (
        <Section title="Why this has not been uploaded">
          {job.blockers.map((b) => (
            <div
              key={b}
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                lineHeight: 1.55,
                marginBottom: 6,
              }}
            >
              {b}
            </div>
          ))}
        </Section>
      )}

      {/* ── Failure ──────────────────────────────────────────────────────── */}
      {job.status.startsWith("FAILED_") && (
        <Section title="What went wrong">
          <pre
            style={{
              fontSize: 11,
              color: "#ef4444",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {job.errorMessage ?? "No error message was recorded."}
          </pre>
          {job.errorDetail != null && (
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-2)",
                  cursor: "pointer",
                }}
              >
                Technical detail
              </summary>
              <pre
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-2)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  marginTop: 6,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {JSON.stringify(job.errorDetail, null, 2)}
              </pre>
            </details>
          )}

          {job.errorMessage?.includes("narration anchoring incomplete") && (
            <ItemNameRepair
              jobId={job.id}
              items={job.items}
              onSaved={() => void load()}
            />
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              alignItems: "center",
            }}
          >
            {job.canRetry && (
              <V2Button
                variant="accent"
                disabled={busy}
                onClick={() => void retry()}
              >
                {busy ? "Working…" : "Retry"}
              </V2Button>
            )}
            {job.canDelete && (
              <V2Button
                variant="danger"
                disabled={busy}
                onClick={() => void destroy()}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  delete
                </span>
                Delete this ranking
              </V2Button>
            )}
            {!job.canDelete && job.status.startsWith("FAILED_") && (
              <span style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
                {job.ownedBy
                  ? "Started by someone else — only they or a manager can delete it."
                  : "No recorded owner — only a manager can delete it."}
              </span>
            )}
          </div>
        </Section>
      )}

      {/* ── Items ────────────────────────────────────────────────────────── */}
      {job.items.length > 0 && !job.status.startsWith("FAILED_") && (
        <Section title={`${job.items.length} items`}>
          {job.items.map((it) => (
            <div
              key={it.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 11,
                color: "var(--v2-text-1)",
                padding: "4px 0",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{it.name}</span>
              <span
                style={{
                  fontSize: 10,
                  color: it.approved
                    ? "#22c55e"
                    : it.skipped
                      ? "#6b7280"
                      : "#f59e0b",
                }}
              >
                {it.approved ? "picked" : it.skipped ? "skipped" : "pending"}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* ── Still working ────────────────────────────────────────────────── */}
      {!job.status.startsWith("FAILED_") &&
        !job.video.available &&
        !job.canPickBRoll && (
          <Section title="Stage">
            <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
              This ranking is at <strong>{job.status}</strong>. Nothing is
              needed from you — the page refreshes itself while it moves.
            </div>
          </Section>
        )}
    </div>
  );
}
