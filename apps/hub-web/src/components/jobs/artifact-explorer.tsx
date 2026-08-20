"use client";

/**
 * Artefact explorer — the answer to "I clicked view and saw nothing".
 *
 * Shows, for one job: the rendered video in a real player, the thumbnail, every
 * generated image, the audio, and — always, even when nothing is playable — the
 * real storage location, copyable.
 *
 * Honesty rules baked in:
 *   - A file recorded in the database but no longer on disk is shown as MISSING
 *     with its recorded path. We never hide it and never pretend it plays.
 *   - Nothing is ever fabricated. Absent artefacts produce an explicit empty
 *     state that says what was looked for and where.
 */

import { useCallback, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import type {
  ArtifactPresence,
  JobArtifact,
  JobArtifactsView,
} from "./_lib/job-artifacts";

// ── Small shared bits ──────────────────────────────────────────────────────

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";
const TEXT_3 = "rgba(205,195,215,0.45)";

function Icon({
  name,
  size = 16,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, lineHeight: 1, flexShrink: 0 }}
    >
      {name}
    </span>
  );
}

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <h3
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--v2-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          margin: 0,
        }}
      >
        {children}
      </h3>
      {count != null && (
        <span style={{ fontSize: 11, color: TEXT_3, fontWeight: 600 }}>
          {count}
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const PRESENCE_STYLE: Record<
  ArtifactPresence,
  { label: string; color: string; bg: string; icon: string }
> = {
  present: {
    label: "on disk",
    color: "#23decb",
    bg: "rgba(35,222,203,0.1)",
    icon: "check_circle",
  },
  missing: {
    label: "file gone",
    color: "#ffb4ab",
    bg: "rgba(255,180,171,0.1)",
    icon: "link_off",
  },
  remote: {
    label: "remote URL",
    color: "#80ccff",
    bg: "rgba(128,204,255,0.1)",
    icon: "cloud",
  },
};

function PresenceChip({ presence }: { presence: ArtifactPresence }) {
  const s = PRESENCE_STYLE[presence];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.bg.replace("0.1", "0.25")}`,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={s.icon} size={11} />
      {s.label}
    </span>
  );
}

/** The storage location, always visible and always copyable. */
function StoragePath({
  path,
  label = "Stored at",
}: {
  path: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* clipboard blocked — the path is selectable on screen anyway */
      });
  }, [path]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: TEXT_3,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <code
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          fontFamily: "monospace",
          color: TEXT_2,
          overflowX: "auto",
          whiteSpace: "nowrap",
          userSelect: "all",
        }}
      >
        {path}
      </code>
      <button
        type="button"
        onClick={copy}
        title="Copy path"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          borderRadius: 5,
          fontSize: 10,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
          color: copied ? "#23decb" : TEXT_2,
          background: copied
            ? "rgba(35,222,203,0.1)"
            : "rgba(var(--v2-accent-rgb), 0.08)",
          border: `1px solid ${
            copied
              ? "rgba(35,222,203,0.25)"
              : "rgba(var(--v2-accent-rgb), 0.15)"
          }`,
        }}
      >
        <Icon name={copied ? "check" : "content_copy"} size={12} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Shown wherever an artefact is recorded but the bytes are gone. */
function MissingFileNotice({ artifact }: { artifact: JobArtifact }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 8,
        background: "rgba(255,180,171,0.05)",
        border: "1px solid rgba(255,180,171,0.2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="link_off" size={18} color="#ffb4ab" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#ffb4ab" }}>
          Recorded, but the file is no longer on disk
        </span>
      </div>
      <p style={{ fontSize: 12, color: TEXT_2, margin: 0, lineHeight: 1.5 }}>
        The database says this job produced <strong>{artifact.name}</strong>,
        but nothing is at that location now. Media is not backed up, so it was
        most likely removed during a disk cleanup. The recorded location is
        below.
      </p>
      <StoragePath path={artifact.storagePath} label="Was at" />
    </div>
  );
}

// ── Video ──────────────────────────────────────────────────────────────────

function VideoSection({ artifact }: { artifact: JobArtifact | null }) {
  if (!artifact) {
    return (
      <GlassCard style={{ padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>Video</SectionTitle>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "20px 16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <Icon name="videocam_off" size={20} color={TEXT_3} />
            <span style={{ fontSize: 13, color: TEXT_2 }}>
              No video has been rendered for this job yet.
            </span>
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard style={{ padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SectionTitle>Video</SectionTitle>
            <PresenceChip presence={artifact.presence} />
            {artifact.sizeBytes != null && (
              <span style={{ fontSize: 11, color: TEXT_3 }}>
                {formatBytes(artifact.sizeBytes)}
              </span>
            )}
          </div>
          {artifact.url && (
            <a
              href={artifact.url}
              download={artifact.name}
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
              <Icon name="download" size={14} />
              Download
            </a>
          )}
        </div>

        {artifact.url ? (
          <video
            src={artifact.url}
            controls
            preload="metadata"
            poster={undefined}
            style={{
              width: "100%",
              maxHeight: "70vh",
              borderRadius: 8,
              background: "#000",
              display: "block",
            }}
          />
        ) : (
          <MissingFileNotice artifact={artifact} />
        )}

        {artifact.url && <StoragePath path={artifact.storagePath} />}
      </div>
    </GlassCard>
  );
}

// ── Thumbnail ──────────────────────────────────────────────────────────────

function ThumbnailSection({ artifact }: { artifact: JobArtifact | null }) {
  return (
    <GlassCard style={{ padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle>Thumbnail</SectionTitle>
        {artifact?.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artifact.url}
              alt="Job thumbnail"
              style={{
                width: "100%",
                borderRadius: 8,
                display: "block",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
              }}
            />
            <StoragePath path={artifact.storagePath} />
          </>
        ) : artifact ? (
          <MissingFileNotice artifact={artifact} />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "20px 16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <Icon name="image_not_supported" size={20} color={TEXT_3} />
            <span style={{ fontSize: 13, color: TEXT_2 }}>
              No thumbnail has been generated for this job.
            </span>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Image gallery ──────────────────────────────────────────────────────────

function ImageGallery({ images }: { images: JobArtifact[] }) {
  const [lightbox, setLightbox] = useState<JobArtifact | null>(null);

  if (images.length === 0) {
    return (
      <GlassCard style={{ padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>Generated images</SectionTitle>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "20px 16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <Icon name="hide_image" size={20} color={TEXT_3} />
            <span style={{ fontSize: 13, color: TEXT_2 }}>
              No images have been generated for this job.
            </span>
          </div>
        </div>
      </GlassCard>
    );
  }

  const presentCount = images.filter((i) => i.presence === "present").length;
  const goneCount = images.length - presentCount;

  return (
    <>
      <GlassCard style={{ padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <SectionTitle count={images.length}>Generated images</SectionTitle>
            {goneCount > 0 && (
              <span style={{ fontSize: 11, color: "#ffb4ab" }}>
                {presentCount} viewable · {goneCount} no longer on disk
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            {images.map((img) => (
              <div
                key={img.id}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                {img.url ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(img)}
                    title={img.storagePath}
                    style={{
                      padding: 0,
                      border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
                      borderRadius: 8,
                      overflow: "hidden",
                      cursor: "zoom-in",
                      background: "rgba(255,255,255,0.03)",
                      display: "block",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.name}
                      loading="lazy"
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  </button>
                ) : (
                  <div
                    title={img.storagePath}
                    style={{
                      width: "100%",
                      aspectRatio: "16 / 9",
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      background: "rgba(255,180,171,0.04)",
                      border: "1px dashed rgba(255,180,171,0.25)",
                    }}
                  >
                    <Icon name="link_off" size={18} color="#ffb4ab" />
                    <span style={{ fontSize: 9, color: "#ffb4ab" }}>
                      file gone
                    </span>
                  </div>
                )}
                <span
                  style={{
                    fontSize: 10,
                    color: TEXT_3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={img.name}
                >
                  {img.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      {lightbox?.url && (
        <div
          role="presentation"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(6px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 32,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={lightbox.name}
            style={{
              maxWidth: "100%",
              maxHeight: "78vh",
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
          <div
            role="presentation"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(900px, 100%)", cursor: "default" }}
          >
            <StoragePath path={lightbox.storagePath} />
          </div>
        </div>
      )}
    </>
  );
}

// ── File table (audio + everything else) ───────────────────────────────────

function FileRow({ artifact }: { artifact: JobArtifact }) {
  const [open, setOpen] = useState(false);
  const size = formatBytes(artifact.sizeBytes);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.08)",
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
        <Icon
          name={
            artifact.kind === "audio"
              ? "graphic_eq"
              : artifact.kind === "video"
                ? "movie"
                : artifact.kind === "subtitle"
                  ? "subtitles"
                  : artifact.kind === "data"
                    ? "data_object"
                    : "draft"
          }
          size={16}
          color={TEXT_2}
        />
        <span
          style={{
            flex: 1,
            minWidth: 140,
            fontSize: 12,
            fontWeight: 600,
            color: TEXT_1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={artifact.name}
        >
          {artifact.name}
        </span>
        <span style={{ fontSize: 10, color: TEXT_3 }}>{artifact.role}</span>
        {size && <span style={{ fontSize: 10, color: TEXT_3 }}>{size}</span>}
        <PresenceChip presence={artifact.presence} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "4px 8px",
            borderRadius: 5,
            fontSize: 10,
            fontWeight: 700,
            color: TEXT_2,
            background: "transparent",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            cursor: "pointer",
          }}
        >
          {open ? "Hide path" : "Path"}
        </button>
        {artifact.url && (
          <a
            href={artifact.url}
            target="_blank"
            rel="noopener noreferrer"
            className="v2-btn-outline"
            style={{
              padding: "4px 10px",
              fontSize: 10,
              textDecoration: "none",
            }}
          >
            Open
          </a>
        )}
      </div>

      {artifact.kind === "audio" && artifact.url && (
        <audio
          src={artifact.url}
          controls
          style={{ width: "100%", height: 32 }}
        />
      )}

      {open && <StoragePath path={artifact.storagePath} />}
    </div>
  );
}

function FileListSection({
  title,
  files,
  emptyText,
}: {
  title: string;
  files: JobArtifact[];
  emptyText: string;
}) {
  if (files.length === 0) {
    return (
      <GlassCard style={{ padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionTitle>{title}</SectionTitle>
          <span style={{ fontSize: 12, color: TEXT_3 }}>{emptyText}</span>
        </div>
      </GlassCard>
    );
  }
  return (
    <GlassCard style={{ padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle count={files.length}>{title}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map((f) => (
            <FileRow key={f.id} artifact={f} />
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

// ── Storage summary ────────────────────────────────────────────────────────

function StorageSummary({ view }: { view: JobArtifactsView }) {
  return (
    <GlassCard style={{ padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <SectionTitle>Storage location</SectionTitle>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {view.counts.present > 0 && (
              <span style={{ fontSize: 11, color: "#23decb" }}>
                {view.counts.present} on disk
              </span>
            )}
            {view.counts.missing > 0 && (
              <span style={{ fontSize: 11, color: "#ffb4ab" }}>
                {view.counts.missing} missing
              </span>
            )}
            {view.counts.remote > 0 && (
              <span style={{ fontSize: 11, color: "#80ccff" }}>
                {view.counts.remote} remote
              </span>
            )}
          </div>
        </div>

        <StoragePath
          path={view.jobDir.path || "(media root not configured)"}
          label={view.jobDir.exists ? "Job folder" : "Expected at"}
        />

        {!view.jobDir.exists && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              borderRadius: 8,
              background: "rgba(249,115,22,0.05)",
              border: "1px solid rgba(249,115,22,0.2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="folder_off" size={16} color="#f97316" />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#f97316" }}>
                This job has no media folder on disk
              </span>
            </div>
            {view.jobDir.probed.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: TEXT_3 }}>
                  Locations checked:
                </span>
                {view.jobDir.probed.map((p) => (
                  <code
                    key={p}
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: TEXT_3,
                      wordBreak: "break-all",
                    }}
                  >
                    {p}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}

        {view.warnings.map((w) => (
          <div
            key={w}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: 12,
              borderRadius: 8,
              background: "rgba(249,115,22,0.05)",
              border: "1px solid rgba(249,115,22,0.2)",
            }}
          >
            <Icon name="warning" size={15} color="#f97316" />
            <span style={{ fontSize: 12, color: TEXT_2, lineHeight: 1.5 }}>
              {w}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Distribution slot (YouTube link — engine comes later) ──────────────────

function DistributionSection({ view }: { view: JobArtifactsView }) {
  return (
    <GlassCard style={{ padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionTitle>Distribution</SectionTitle>
        {view.youtube ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a
              href={view.youtube.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                color: "#23decb",
                background: "rgba(35,222,203,0.08)",
                border: "1px solid rgba(35,222,203,0.25)",
                textDecoration: "none",
                alignSelf: "flex-start",
              }}
            >
              <Icon name="open_in_new" size={16} />
              Watch on YouTube
            </a>
            <StoragePath path={view.youtube.url} label="Video URL" />
            {view.youtube.publishedAt && (
              <span style={{ fontSize: 11, color: TEXT_3 }}>
                Published {new Date(view.youtube.publishedAt).toLocaleString()}
              </span>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <Icon name="rocket_launch" size={18} color={TEXT_3} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_2 }}>
                Not published yet — no YouTube link
              </span>
              <span style={{ fontSize: 11, color: TEXT_3, lineHeight: 1.5 }}>
                Once the distribution engine is built, the published URL and its
                stats will appear here automatically.
              </span>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export function ArtifactExplorer({ view }: { view: JobArtifactsView }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <VideoSection artifact={view.finalVideo} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ThumbnailSection artifact={view.thumbnail} />
          <DistributionSection view={view} />
        </div>
      </div>

      <StorageSummary view={view} />

      <ImageGallery images={view.images} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <FileListSection
          title="Audio"
          files={view.audio}
          emptyText="No audio files for this job."
        />
        <FileListSection
          title="Other files"
          files={view.otherFiles}
          emptyText="No other files in this job's folder."
        />
      </div>
    </div>
  );
}
