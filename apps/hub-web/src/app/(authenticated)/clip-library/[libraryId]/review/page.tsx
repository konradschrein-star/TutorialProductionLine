import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../_lib/v2-auth";
import { GlassCard } from "../../../_components/glass-card";
import { db } from "@/lib/db";
import { clipLibraries, sourceVideos, clips } from "@repo/db";
import { eq, and, count } from "drizzle-orm";
import { ClipReviewClient } from "./_components/clip-review-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ libraryId: string }>;
  searchParams: Promise<{
    status?: string;
    labeling_step?: string;
    source_video_id?: string;
    page?: string;
  }>;
}

export default async function ClipReviewPage({ params, searchParams }: Props) {
  await getSession();
  const { libraryId } = await params;
  const sp = await searchParams;

  const [library] = await db
    .select()
    .from(clipLibraries)
    .where(eq(clipLibraries.id, libraryId))
    .limit(1);

  if (!library) notFound();

  // Fetch source videos for filter dropdown
  const videos = await db
    .select({
      id: sourceVideos.id,
      title: sourceVideos.title,
      source_url: sourceVideos.source_url,
    })
    .from(sourceVideos)
    .where(eq(sourceVideos.library_id, libraryId));

  // Build filters
  const statusFilter = sp.status ?? "pending";
  const labelingStep = sp.labeling_step ?? "done";
  const sourceVideoIdFilter = sp.source_video_id ?? undefined;

  const conditions = [eq(clips.library_id, libraryId)];

  const validStatuses = [
    "all",
    "pending",
    "approved",
    "edited",
    "flagged",
    "skipped",
  ] as const;
  const validSteps = [
    "all",
    "vlm",
    "whisper",
    "face",
    "audio",
    "done",
  ] as const;

  if (
    statusFilter !== "all" &&
    validStatuses.includes(statusFilter as (typeof validStatuses)[number])
  ) {
    conditions.push(
      eq(
        clips.review_status,
        statusFilter as Exclude<(typeof validStatuses)[number], "all">,
      ),
    );
  }

  if (
    labelingStep !== "all" &&
    validSteps.includes(labelingStep as (typeof validSteps)[number])
  ) {
    conditions.push(
      eq(
        clips.labeling_step,
        labelingStep as Exclude<(typeof validSteps)[number], "all">,
      ),
    );
  }

  if (sourceVideoIdFilter && /^[0-9a-f-]{36}$/i.test(sourceVideoIdFilter)) {
    conditions.push(eq(clips.source_video_id, sourceVideoIdFilter));
  }

  const where = and(...conditions);

  // Fetch clips + total count
  const PAGE_SIZE = 20;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, clipsResult, sourceVideosMap] = await Promise.all([
    db.select({ total: count() }).from(clips).where(where),
    db.select().from(clips).where(where).limit(PAGE_SIZE).offset(offset),
    // Join source video CDN URLs for inline video playback
    db
      .select({ id: sourceVideos.id, cdn_url: sourceVideos.cdn_url })
      .from(sourceVideos)
      .where(eq(sourceVideos.library_id, libraryId)),
  ]);

  const total = countResult[0]?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Build a lookup map: source_video_id → cdn_url
  const sourceVideoCdnMap: Record<string, string | null> = {};
  for (const sv of sourceVideosMap) {
    sourceVideoCdnMap[sv.id] = sv.cdn_url;
  }

  const tagVocabulary = library.tag_vocabulary as Record<string, string[]>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/clip-library"
          style={{
            color: "rgba(205,195,215,0.5)",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          Clip Libraries
        </Link>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 14, color: "rgba(205,195,215,0.3)" }}
        >
          chevron_right
        </span>
        <Link
          href={`/clip-library/${libraryId}`}
          style={{
            color: "rgba(205,195,215,0.5)",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          {library.name}
        </Link>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 14, color: "rgba(205,195,215,0.3)" }}
        >
          chevron_right
        </span>
        <span style={{ color: "#e5e2e1", fontSize: 12, fontWeight: 600 }}>
          Review
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              color: "#e5e2e1",
              fontSize: 20,
              fontWeight: 800,
              margin: "0 0 4px 0",
            }}
          >
            Clip Review — {library.name}
          </h1>
          <p
            style={{ color: "rgba(205,195,215,0.5)", fontSize: 12, margin: 0 }}
          >
            {total.toLocaleString()} clips matching filters &middot; Page {page}{" "}
            of {totalPages || 1}
          </p>
        </div>

        {/* Keyboard shortcuts legend */}
        <GlassCard style={{ padding: "8px 16px" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {[
              { key: "A", label: "Approve" },
              { key: "E", label: "Edit" },
              { key: "F", label: "Flag" },
              { key: "S", label: "Skip" },
              { key: "← →", label: "Navigate" },
            ].map(({ key, label }) => (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <kbd
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(var(--v2-accent-rgb),0.1)",
                    border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                    color: "var(--v2-accent)",
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "monospace",
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: 10, color: "rgba(205,195,215,0.5)" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Filter bar */}
      <FilterBar
        libraryId={libraryId}
        videos={videos}
        currentStatus={statusFilter}
        currentStep={labelingStep}
        currentSourceVideoId={sourceVideoIdFilter}
      />

      {/* Review UI (client component) */}
      {clipsResult.length === 0 ? (
        <GlassCard style={{ padding: 48, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 48,
              color: "rgba(var(--v2-accent-rgb),0.3)",
              display: "block",
              marginBottom: 16,
            }}
          >
            done_all
          </span>
          <p style={{ color: "#cdc3d7", fontSize: 14, margin: "0 0 4px 0" }}>
            No clips match these filters
          </p>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}
          >
            Try changing the status or labeling step filters
          </p>
        </GlassCard>
      ) : (
        <ClipReviewClient
          libraryId={libraryId}
          initialClips={clipsResult}
          sourceVideoCdnMap={sourceVideoCdnMap}
          tagVocabulary={tagVocabulary}
          total={total}
          page={page}
          totalPages={totalPages}
          currentFilters={{
            status: statusFilter,
            labelingStep,
            sourceVideoId: sourceVideoIdFilter,
          }}
        />
      )}
    </div>
  );
}

// ── Server-side filter bar ──────────────────────────────────────────────────

interface FilterBarProps {
  libraryId: string;
  videos: Array<{
    id: string;
    title: string | null;
    source_url: string | null;
  }>;
  currentStatus: string;
  currentStep: string;
  currentSourceVideoId?: string;
}

function FilterBar({
  libraryId,
  videos,
  currentStatus,
  currentStep,
  currentSourceVideoId,
}: FilterBarProps) {
  function buildHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      status: currentStatus,
      labeling_step: currentStep,
      source_video_id: currentSourceVideoId,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    return `/clip-library/${libraryId}/review?${params.toString()}`;
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    textDecoration: "none",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    background: active
      ? "rgba(var(--v2-accent-rgb),0.12)"
      : "rgba(255,255,255,0.04)",
    border: active
      ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
      : "1px solid rgba(255,255,255,0.08)",
    color: active ? "var(--v2-accent)" : "rgba(205,195,215,0.5)",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}
    >
      {/* Status filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            alignSelf: "center",
          }}
        >
          Status:
        </span>
        {(
          [
            "all",
            "pending",
            "approved",
            "edited",
            "flagged",
            "skipped",
          ] as const
        ).map((s) => (
          <Link
            key={s}
            href={buildHref({ status: s, page: undefined })}
            style={tabStyle(currentStatus === s)}
          >
            {s}
          </Link>
        ))}
      </div>

      {/* Labeling step filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            alignSelf: "center",
          }}
        >
          Step:
        </span>
        {(["all", "done", "vlm", "whisper", "face", "audio"] as const).map(
          (s) => (
            <Link
              key={s}
              href={buildHref({ labeling_step: s, page: undefined })}
              style={tabStyle(currentStep === s)}
            >
              {s}
            </Link>
          ),
        )}
      </div>

      {/* Source video dropdown (implemented as link list) */}
      {videos.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Video:
          </span>
          <Link
            href={buildHref({ source_video_id: undefined, page: undefined })}
            style={tabStyle(!currentSourceVideoId)}
          >
            All
          </Link>
          {videos.map((v) => (
            <Link
              key={v.id}
              href={buildHref({ source_video_id: v.id, page: undefined })}
              style={{
                ...tabStyle(currentSourceVideoId === v.id),
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "block",
              }}
              title={v.title ?? v.source_url ?? v.id}
            >
              {v.title ?? v.source_url?.slice(0, 30) ?? v.id.slice(0, 8)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
