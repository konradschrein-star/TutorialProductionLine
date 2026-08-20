import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../_lib/v2-auth";
import { PulseStatusBadge } from "../../_components/pulse-status-badge";
import { getJobById, type Job } from "@/lib/repositories/job-repository";
import { buildJobMediaView } from "@/lib/job-media-view";
import { buildJobArtifacts } from "./_lib/job-artifacts";
import { ArtifactExplorer } from "@/components/jobs/artifact-explorer";
import { listActiveUsersByRole } from "@/lib/repositories/team-repository";
import { hasPermission } from "@/lib/auth/rbac";
import { JobActions } from "@/components/jobs/job-actions";
import { JobDetailTabsClient } from "./job-detail-tabs-client";
import { DramaPipelineTracker } from "./drama-pipeline-tracker";
import { DramaClipsPanel } from "./drama-clips-panel";
import { DramaMetaPanel } from "./drama-meta-panel";
import { ScriptInjectionPanel } from "./script-injection-panel";
import { ThumbnailPanel } from "./_components/thumbnail-panel";
import { willUseRemotionRenderer } from "@repo/domain";
import type { RenderEngineInput } from "@repo/domain";

// A thumbnail only makes sense once the video is (nearly) done and an uploader
// needs it. Showing the panel earlier surfaces a confusing "no thumbnail / 500"
// on states that are BEFORE the render even happens (e.g. AWAITING_VA_REVIEW).
const THUMBNAIL_RELEVANT_STATES = new Set([
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  "UPLOADING",
  "SCHEDULED",
  "PUBLISHED",
]);

function countFailureTransitions(
  history: Array<{ to_status: string }> | null | undefined,
): number {
  if (!history) return 0;
  return history.filter((h) => h.to_status?.startsWith("FAILED_")).length;
}

/**
 * Determine if a job will use Remotion renderer based on its template config.
 */
function jobUsesRemotionRenderer(job: Job): boolean {
  // Parse render_config from template
  const templateRenderConfig = (job.template as any)?.render_config;
  let renderConfigData = templateRenderConfig;

  // Handle legacy array format
  if (Array.isArray(renderConfigData) && renderConfigData.length > 0) {
    try {
      renderConfigData = JSON.parse(renderConfigData[0]);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("Failed to parse render_config:", error);
      }
      renderConfigData = null;
    }
  }

  const engineOverride = renderConfigData?.engine;
  const captionsEnabled = renderConfigData?.captions_enabled ?? false;

  // Check assembly manifest for composition features
  const assemblyManifest = job.assembly_manifest as any;
  const scenes = assemblyManifest?.scenes ?? [];
  const hasTickerItems = (assemblyManifest?.ticker_items?.length ?? 0) > 0;
  const hasPIP = scenes.some((s: any) => s.visual_type === "AVATAR_PIP");
  const hasAnimatedTransitions = false; // Not currently used, but part of routing logic

  const input: RenderEngineInput = {
    templateEngineOverride:
      engineOverride === "FFMPEG" || engineOverride === "REMOTION"
        ? engineOverride
        : undefined,
    captionsEnabled,
    hasPictureInPicture: hasPIP,
    hasNewsTicker: hasTickerItems,
    hasAnimatedTransitions,
  };

  return willUseRemotionRenderer(input);
}

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function V2JobDetailPage({ params }: JobDetailPageProps) {
  const session = await getSession();
  const { id } = await params;

  const job = await getJobById(id);
  if (!job) notFound();

  const canPause = hasPermission(session, "pause:job");
  const canDelete = hasPermission(session, "delete:job");
  const canRetry = hasPermission(session, "retry:job");
  const canReviewQC = hasPermission(session, "review:qc");
  const canAssign = hasPermission(session, "assign:job");
  const canEdit = hasPermission(session, "edit:job");

  const productionVAs =
    canAssign && job.status === "AWAITING_PRODUCTION_VA"
      ? await listActiveUsersByRole("PRODUCTION_VA")
      : [];

  const uploaderVAs =
    canAssign && job.status === "AWAITING_UPLOADER"
      ? await listActiveUsersByRole("UPLOADER_VA")
      : [];

  // Determine if this job uses Remotion renderer
  const usesRemotionRenderer = jobUsesRemotionRenderer(job);

  // Normalized, format-agnostic media (final video + scenes + assets).
  const mediaView = buildJobMediaView(job);

  // Artefacts: filesystem-truth view of what this job actually produced and
  // where it lives. Shown for every status — a published job with no playable
  // file must still say where the file was, rather than rendering nothing.
  const artifacts = await buildJobArtifacts(job);

  // The QC review player is served by /api/assets/[jobId]/[...key], which
  // requires the key to be a manifest entry. Derive it from the SAME resolver
  // the ArtifactExplorer uses (J6) so the two views can never disagree about
  // which file is the final render — and so the string-manifest / presence
  // handling is applied consistently. Only a manifest-sourced, present file is
  // a valid /api/assets key.
  const resolvedFinal = artifacts.finalVideo;
  const finalVideoAssetKey =
    job.status === "AWAITING_QC" &&
    resolvedFinal &&
    resolvedFinal.source === "manifest" &&
    resolvedFinal.presence === "present"
      ? resolvedFinal.storagePath
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <Link
            href="/jobs"
            className="v2-btn"
            style={{ marginTop: 2, padding: "6px 12px", fontSize: 14 }}
          >
            ←
          </Link>
          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: "0 0 6px 0",
              }}
            >
              {job.title}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PulseStatusBadge status={job.status} />
              {(() => {
                const failCount = countFailureTransitions(
                  job.state_machine_history,
                );
                return failCount > 1 ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: "rgba(239, 68, 68, 0.1)",
                      color: "#ef4444",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                    }}
                  >
                    Failed {failCount}×
                  </span>
                ) : null;
              })()}
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.4)",
                  fontFamily: "monospace",
                }}
              >
                {job.id}
              </span>
            </div>
          </div>
        </div>
        <JobActions
          jobId={job.id}
          status={job.status}
          canPause={canPause}
          canDelete={canDelete}
          canRetry={canRetry}
          usesRemotionRenderer={usesRemotionRenderer}
        />
      </div>

      {/* Artefacts — the video, the thumbnail, the generated images and, above
          all, WHERE everything is stored. Rendered for every status: when an
          artefact does not exist the section says so explicitly instead of
          silently collapsing, which is what made published jobs look empty. */}
      <ArtifactExplorer view={artifacts} />

      {/* B-Roll Selection Studio gate — a RANKING job parks here BEFORE it
          renders, waiting for the VA to pick/trim footage per block. There is
          deliberately no video or thumbnail yet; both are produced only after
          the VA submits. This card exists so that is never a mystery. */}
      {job.status === "AWAITING_VA_REVIEW" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 20,
            borderRadius: 12,
            background: "rgba(var(--v2-accent-rgb), 0.06)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 22, color: "var(--v2-accent)" }}
            >
              hourglass_top
            </span>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "#e5e2e1",
                margin: 0,
              }}
            >
              Waiting for you to pick the B-roll
            </h2>
          </div>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: "#cdc3d7",
              margin: 0,
              maxWidth: 640,
            }}
          >
            There&rsquo;s no video or thumbnail yet — and that&rsquo;s expected.
            This job is parked <strong>before rendering</strong>. Open the
            studio, choose and trim the footage for each block, approve each
            one, then hit <strong>Submit</strong>. Only then does the video
            render and move on to QC / upload.{" "}
            <strong>Approve lives inside the studio</strong> (per block, then
            Submit) — there is no approve button on this page because there is
            nothing rendered to approve here yet.
          </p>
          <Link
            href={`/jobs/${job.id}/va-review`}
            className="v2-btn-accent"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              alignSelf: "flex-start",
              textDecoration: "none",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              movie_edit
            </span>
            Open B-Roll Selection Studio
          </Link>
        </div>
      )}

      {/* Script injection panel — shown when job is waiting for a script */}
      {job.status === "SCRIPTING" && <ScriptInjectionPanel jobId={job.id} />}

      {/* Drama pipeline tracker */}
      {job.format === "LONG_FORM_DRAMA" && (
        <DramaPipelineTracker
          status={job.status}
          metadata={job.metadata as Record<string, unknown> | null}
        />
      )}

      {/* Drama per-clip panel — characters + prompts + per-clip progress */}
      {job.format === "LONG_FORM_DRAMA" && (
        <>
          <DramaMetaPanel
            jobId={job.id}
            metadata={job.metadata as Record<string, unknown> | null}
          />
          <DramaClipsPanel jobId={job.id} />
        </>
      )}

      {/* Thumbnail regenerate panel — only relevant once the video exists and
          an uploader needs a thumbnail; hidden on pre-render states. */}
      {THUMBNAIL_RELEVANT_STATES.has(job.status) && (
        <ThumbnailPanel jobId={job.id} kind="content_job" />
      )}

      {/* Tabbed Content */}
      <JobDetailTabsClient
        job={job}
        canPause={canPause}
        canDelete={canDelete}
        canReviewQC={canReviewQC}
        canAssign={canAssign}
        canEdit={canEdit}
        currentUserId={session.userId}
        productionVAs={productionVAs}
        uploaderVAs={uploaderVAs}
        finalVideoAssetKey={finalVideoAssetKey}
        mediaView={mediaView}
      />
    </div>
  );
}
