import { format } from "date-fns";
import Link from "next/link";

function computeScriptDuration(
  job: Job,
): { seconds: number; source: "actual" | "tts" | "estimate" } | null {
  if (job.final_video_duration_seconds) {
    return { seconds: job.final_video_duration_seconds, source: "actual" };
  }
  const manifest = job.assembly_manifest as any;
  if (
    Array.isArray(manifest?.word_timestamps) &&
    manifest.word_timestamps.length > 0
  ) {
    const maxEnd = Math.max(
      ...manifest.word_timestamps.map((w: any) => Number(w.end) || 0),
    );
    if (maxEnd > 0) return { seconds: Math.ceil(maxEnd), source: "tts" };
  }
  if (job.script) {
    const words = job.script.trim().split(/\s+/).length;
    return { seconds: Math.round((words / 140) * 60), source: "estimate" };
  }
  return null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
import { V2Card, V2MetaGrid, V2MetaField } from "../../../_components";
import { PulseStatusBadge } from "../../../_components/pulse-status-badge";
import { HeyGenUploadDropzone } from "@/components/jobs/heygen-upload-dropzone";
import { QCReviewPanel } from "@/components/jobs/qc-review-panel";
import { VAAssignment } from "@/components/jobs/va-assignment";
import { ComparisonResearchUpload } from "@/components/jobs/comparison-research-upload";
import type { Job } from "@/lib/repositories/job-repository";

const PIPELINE_ACTIVE = new Set([
  "SCRIPTING",
  "TRANSLATING",
  "ASSET_COLLECTION",
  "CLIP_SELECTION",
  "QMS_VALIDATING",
  "ROUTING_RENDER",
  "RENDERING_REMOTION",
  "RENDERING_FFMPEG",
  "UPLOADING",
  "IDEA_GENERATION",
]);

interface OverviewTabProps {
  job: Job;
  canPause: boolean;
  canDelete: boolean;
  canReviewQC: boolean;
  canAssign: boolean;
  canEdit: boolean;
  currentUserId: string | null;
  productionVAs: Array<{ id: string; name: string; email: string }>;
  uploaderVAs: Array<{ id: string; name: string; email: string }>;
  finalVideoAssetKey: string | null;
  finalVideoUrl: string | null;
}

export function OverviewTab({
  job,
  canPause,
  canReviewQC,
  canAssign,
  currentUserId,
  productionVAs,
  uploaderVAs,
  finalVideoAssetKey,
  finalVideoUrl,
}: OverviewTabProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        gap: 24,
        alignItems: "start",
      }}
    >
      {/* LEFT COLUMN */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Final video player — shown for any format once a render exists. */}
        {finalVideoUrl && (
          <V2Card>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  margin: 0,
                }}
              >
                Final Video
              </h2>
              <a
                href={finalVideoUrl}
                download
                className="v2-btn-outline"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  fontSize: 11,
                  textDecoration: "none",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  download
                </span>
                Download
              </a>
            </div>
            <video
              src={finalVideoUrl}
              controls
              preload="metadata"
              style={{
                width: "100%",
                borderRadius: 8,
                background: "#000",
                display: "block",
                maxHeight: "70vh",
              }}
            />
          </V2Card>
        )}

        {/* Status-adaptive panels */}

        {/* AWAITING_RESEARCH — TECH_COMPARISON research upload */}
        {job.status === "AWAITING_RESEARCH" &&
          job.format === "TECH_COMPARISON" &&
          (() => {
            const meta = (job.metadata as any)?.comparison ?? {};
            const prompts: string[] = meta.research_prompts ?? [];
            return (
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(170,255,0,0.15)",
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 18,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, color: "var(--v2-accent)" }}
                  >
                    upload_file
                  </span>
                  <h2
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      margin: 0,
                    }}
                  >
                    Research Upload Required
                  </h2>
                </div>
                <ComparisonResearchUpload
                  jobId={job.id}
                  productAName={meta.product_a_name ?? ""}
                  productBName={meta.product_b_name ?? ""}
                  researchPrompts={prompts}
                />
              </div>
            );
          })()}

        {/* AWAITING_PRODUCTION_VA */}
        {job.status === "AWAITING_PRODUCTION_VA" && (
          <V2Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  margin: 0,
                }}
              >
                HeyGen Footage Upload
              </h2>
              {job.assigned_production_va ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 16 }}
                >
                  <div
                    style={{
                      padding: 16,
                      background: "var(--v2-surface-2)",
                      borderRadius: 8,
                      border: "1px solid var(--v2-border-1)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-3)",
                        margin: "0 0 4px 0",
                      }}
                    >
                      Assigned to
                    </p>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--v2-text-1)",
                        margin: "0 0 2px 0",
                      }}
                    >
                      {job.assigned_production_va.name}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                        margin: 0,
                      }}
                    >
                      {job.assigned_production_va.email}
                    </p>
                  </div>
                  {(canPause ||
                    job.assigned_production_va_id === currentUserId) && (
                    <HeyGenUploadDropzone
                      jobId={job.id}
                      channelId={job.channel_id}
                    />
                  )}
                </div>
              ) : canAssign ? (
                <VAAssignment
                  jobId={job.id}
                  currentVAId={job.assigned_production_va_id}
                  availableVAs={productionVAs}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: 16,
                    background: "rgba(249,115,22,0.05)",
                    border: "1px solid rgba(249,115,22,0.2)",
                    borderRadius: 8,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, color: "#f97316", flexShrink: 0 }}
                  >
                    info
                  </span>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#f97316",
                      margin: 0,
                    }}
                  >
                    No Production VA assigned yet. An admin must assign a VA
                    before footage can be uploaded.
                  </p>
                </div>
              )}
            </div>
          </V2Card>
        )}

        {/* AWAITING_IMAGE_QC */}
        {job.status === "AWAITING_IMAGE_QC" && (
          <V2Card style={{ border: "1px solid rgba(249,115,22,0.3)" }}>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#f97316",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              Image QC Required
            </h2>
            <p style={{ fontSize: 13, color: "#cdc3d7", marginBottom: 20 }}>
              Scene images have been generated. A VA must review them before
              rendering begins.
            </p>
            <Link
              href={`/jobs/${job.id}/image-qc`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: "var(--v2-accent)",
                color: "#000",
                fontWeight: 700,
                fontSize: 13,
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                image
              </span>
              Review Images
            </Link>
          </V2Card>
        )}

        {/* AWAITING_CLIP_REVIEW — clip selection done, human review required */}
        {job.status === "AWAITING_CLIP_REVIEW" && (
          <V2Card style={{ border: "1px solid rgba(249,115,22,0.3)" }}>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#f97316",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              Clip Review Required
            </h2>
            <p style={{ fontSize: 13, color: "#cdc3d7", marginBottom: 20 }}>
              AI clip selection is complete. Review the edit list before
              rendering begins.
            </p>
            <Link
              href={`/jobs/${job.id}/edit-list`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: "var(--v2-accent)",
                color: "#000",
                fontWeight: 700,
                fontSize: 13,
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                movie_edit
              </span>
              Review Edit List
            </Link>
          </V2Card>
        )}

        {/* CLIP_SELECTION — view previous edit list or wait for new one */}
        {job.status === "CLIP_SELECTION" && (
          <V2Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                className="animate-pulse"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--v2-accent)",
                  boxShadow: "0 0 8px rgba(var(--v2-accent-rgb), 0.6)",
                  flexShrink: 0,
                }}
              />
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    margin: "0 0 2px 0",
                  }}
                >
                  Clip Selection Running
                </p>
                <p
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.5)",
                    margin: 0,
                  }}
                >
                  AI is selecting clips for each sentence. Review will be
                  available when complete.
                </p>
              </div>
              <Link
                href={`/jobs/${job.id}/edit-list`}
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--v2-accent)",
                  textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  movie_edit
                </span>
                View Edit List
              </Link>
            </div>
          </V2Card>
        )}

        {/* AWAITING_QC */}
        {job.status === "AWAITING_QC" && canReviewQC && (
          <V2Card noPadding style={{ overflow: "hidden" }}>
            <QCReviewPanel
              jobId={job.id}
              finalVideoAssetKey={finalVideoAssetKey}
              qcFeedback={job.qc_feedback ?? null}
              errorMessage={job.error_message ?? null}
              status={job.status}
            />
          </V2Card>
        )}

        {/* AWAITING_UPLOADER */}
        {job.status === "AWAITING_UPLOADER" && (
          <V2Card>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 16,
              }}
            >
              Upload to YouTube
            </h2>
            {job.assigned_uploader_va ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <div
                  style={{
                    padding: 16,
                    background: "#0e0e0e",
                    borderRadius: 8,
                  }}
                >
                  <p
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.5)",
                      margin: "0 0 4px 0",
                    }}
                  >
                    Assigned to
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#e5e2e1",
                      margin: "0 0 2px 0",
                    }}
                  >
                    {job.assigned_uploader_va.name}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.4)",
                      margin: 0,
                    }}
                  >
                    {job.assigned_uploader_va.email}
                  </p>
                </div>
                {job.youtube_video_id && (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(35,222,203,0.05)",
                      border: "1px solid rgba(35,222,203,0.2)",
                      borderRadius: 8,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        color: "#23decb",
                        fontWeight: 600,
                        margin: 0,
                      }}
                    >
                      Video ID recorded: {job.youtube_video_id}
                    </p>
                  </div>
                )}
              </div>
            ) : canAssign ? (
              <VAAssignment
                jobId={job.id}
                currentVAId={job.assigned_uploader_va_id}
                availableVAs={uploaderVAs}
                vaType="uploader"
              />
            ) : (
              <p
                style={{
                  fontSize: 13,
                  color: "#f97316",
                  padding: 16,
                  background: "rgba(249,115,22,0.05)",
                  borderRadius: 8,
                }}
              >
                No Uploader VA assigned yet. An admin must assign a VA before
                uploading can begin.
              </p>
            )}
          </V2Card>
        )}

        {/* Active pipeline indicator */}
        {PIPELINE_ACTIVE.has(job.status) && (
          <V2Card>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: (job as any).progress > 0 ? 16 : 0,
              }}
            >
              <div
                className="animate-pulse"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "var(--v2-accent)",
                  boxShadow: "0 0 10px rgba(var(--v2-accent-rgb), 0.6)",
                  flexShrink: 0,
                }}
              />
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    margin: "0 0 2px 0",
                  }}
                >
                  Pipeline Running
                </p>
                <p
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.5)",
                    margin: 0,
                  }}
                >
                  {job.status.replace(/_/g, " ")}
                </p>
              </div>
              {(job as any).progress > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--v2-accent)",
                  }}
                >
                  {(job as any).progress}%
                </span>
              )}
            </div>
            {(job as any).progress > 0 && (
              <div
                style={{
                  height: 4,
                  background: "rgba(var(--v2-accent-rgb), 0.1)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(job as any).progress}%`,
                    background: "var(--v2-accent)",
                    borderRadius: 2,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            )}
          </V2Card>
        )}

        {/* Metadata Card */}
        <V2Card>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 24,
            }}
          >
            Metadata
          </h2>
          <V2MetaGrid columns={2}>
            <V2MetaField
              label="Status"
              value={<PulseStatusBadge status={job.status} />}
            />
            {job.production_version && (
              <V2MetaField
                label="Production Version"
                value={
                  <span
                    style={{
                      padding: "2px 8px",
                      background: "rgba(var(--v2-accent-rgb), 0.1)",
                      border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "var(--v2-accent)",
                      fontWeight: 700,
                    }}
                  >
                    {job.production_version}
                  </span>
                }
              />
            )}
            <V2MetaField label="Channel" value={job.channel?.name ?? "—"} />
            <V2MetaField label="Template" value={job.template?.name ?? "—"} />
            <V2MetaField label="Format" value={job.format.replace(/_/g, " ")} />
            {job.aspect_ratio && job.aspect_ratio !== "16:9" && (
              <V2MetaField label="Aspect Ratio" value={job.aspect_ratio} />
            )}
            {job.target_duration_seconds && (
              <V2MetaField
                label="Target Duration"
                value={`${Math.floor(job.target_duration_seconds / 60)}m ${job.target_duration_seconds % 60}s`}
              />
            )}
            {job.skip_image_qc && (
              <V2MetaField
                label="Image QC"
                value={
                  <span
                    style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}
                  >
                    skipped
                  </span>
                }
              />
            )}
            {job.skip_final_qc && (
              <V2MetaField
                label="Final QC"
                value={
                  <span
                    style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}
                  >
                    skipped
                  </span>
                }
              />
            )}
            {job.render_engine && (
              <V2MetaField
                label="Render Engine"
                value={
                  <span
                    style={{
                      padding: "2px 8px",
                      background: "#0e0e0e",
                      border: "1px solid rgba(75,68,85,0.4)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "#cdc3d7",
                    }}
                  >
                    {job.render_engine}
                  </span>
                }
              />
            )}
            <V2MetaField
              label="Created"
              value={format(new Date(job.created_at), "dd MMM yyyy, HH:mm")}
            />
            <V2MetaField
              label="Updated"
              value={format(new Date(job.updated_at), "dd MMM yyyy, HH:mm")}
            />
          </V2MetaGrid>

          {/* Error display */}
          {job.error_message && (
            <div
              style={{
                marginTop: 24,
                padding: 16,
                background: "rgba(255,180,171,0.05)",
                border: "1px solid rgba(255,180,171,0.2)",
                borderRadius: 8,
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ffb4ab",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: "0 0 8px 0",
                }}
              >
                Error
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "#ffb4ab",
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {job.error_message}
              </p>
            </div>
          )}
        </V2Card>
      </div>

      {/* RIGHT COLUMN */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Script */}
        {job.script &&
          (() => {
            const dur = computeScriptDuration(job);
            return (
              <V2Card>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <h2
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      margin: 0,
                    }}
                  >
                    Script
                  </h2>
                  {dur && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14, color: "var(--v2-accent)" }}
                      >
                        timer
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#e5e2e1",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formatDuration(dur.seconds)}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "rgba(205,195,215,0.45)",
                        }}
                      >
                        {dur.source === "actual"
                          ? "final"
                          : dur.source === "tts"
                            ? "tts"
                            : "est."}
                      </span>
                    </div>
                  )}
                </div>
                <pre
                  style={{
                    fontSize: 11,
                    color: "#cdc3d7",
                    background: "#0e0e0e",
                    padding: 12,
                    borderRadius: 8,
                    maxHeight: 300,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                    fontFamily: "monospace",
                    lineHeight: 1.6,
                  }}
                >
                  {job.script}
                </pre>
              </V2Card>
            );
          })()}

        {/* YouTube */}
        {job.youtube_video_id && (
          <V2Card>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 16,
              }}
            >
              YouTube
            </h2>
            <V2MetaGrid columns={1}>
              <V2MetaField
                label="Video ID"
                value={
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {job.youtube_video_id}
                    </span>
                    <a
                      href={`https://www.youtube.com/watch?v=${job.youtube_video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--v2-accent)" }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 13 }}
                      >
                        open_in_new
                      </span>
                    </a>
                  </div>
                }
              />
              {job.published_at && (
                <V2MetaField
                  label="Published"
                  value={format(
                    new Date(job.published_at),
                    "dd MMM yyyy, HH:mm",
                  )}
                />
              )}
              {job.views !== null && job.views !== undefined && (
                <V2MetaField label="Views" value={job.views.toLocaleString()} />
              )}
            </V2MetaGrid>
          </V2Card>
        )}
      </div>
    </div>
  );
}
