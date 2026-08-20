import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../_lib/v2-auth";
import { db } from "@/lib/db";
import { clipLibraries } from "@repo/db";
import { eq } from "drizzle-orm";
import { ClipGalleryClient } from "./_components/clip-gallery-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ libraryId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ClipGalleryPage({ params, searchParams }: Props) {
  await getSession();
  const { libraryId } = await params;
  const sp = await searchParams;

  const [library] = await db
    .select()
    .from(clipLibraries)
    .where(eq(clipLibraries.id, libraryId))
    .limit(1);

  if (!library) notFound();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/clip-library"
          style={{
            color: "rgba(205,195,215,0.5)",
            fontSize: 12,
            textDecoration: "none",
            fontWeight: 500,
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
            fontWeight: 500,
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
          Clips
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
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
            Clip Gallery
          </h1>
          <p
            style={{ color: "rgba(205,195,215,0.5)", fontSize: 12, margin: 0 }}
          >
            {library.name} &middot; {library.clip_count.toLocaleString()} clips
          </p>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "Overview", href: `/clip-library/${libraryId}` },
            {
              label: "Clips",
              href: `/clip-library/${libraryId}/clips`,
              active: true,
            },
            { label: "Ingest", href: `/clip-library/${libraryId}/ingest` },
            { label: "Search", href: `/clip-library/${libraryId}/search` },
            { label: "Settings", href: `/clip-library/${libraryId}/settings` },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: tab.active
                  ? "rgba(var(--v2-accent-rgb),0.15)"
                  : "rgba(255,255,255,0.04)",
                color: tab.active
                  ? "var(--v2-accent)"
                  : "rgba(205,195,215,0.6)",
                border: tab.active
                  ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
                  : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <ClipGalleryClient
        libraryId={libraryId}
        initialSourceVideoId={sp.source_video_id}
        initialStatus={sp.status}
        initialLabelingStep={sp.labeling_step}
      />
    </div>
  );
}
