export const LIBRARY_STAGES = [
  "QUEUED",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "AWAITING_THUMBNAILS",
  "SPLICING",
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
  "AWAITING_RECORDINGS",
  "RECORDED",
  "READY_TO_STITCH",
  "SENT_TO_STITCHER",
] as const;
export interface LibraryRecord {
  id: string;
  sourceId: string | null;
  title: string;
  language: string | null;
  status: string;
  producer: string | null;
  producerId?: string | null;
  channel: string | null;
  channelId?: string | null;
  voice: string | null;
  provider: string | null;
  duration: string | null;
  durationKind: "recording" | "audio" | null;
  review: string | null;
  createdAt: string;
  thumbnailId: string | null;
  canCompose?: boolean;
  localeCount: number;
  hasVideo: boolean;
  youtubeUrl: string | null;
  youtubeStudioUrl: string | null;
  youtubeVerified: boolean;
}
export interface LibraryData {
  rows: LibraryRecord[];
  total: number;
  scope: string;
  canFilterProducer: boolean;
  channels: Array<{ id: string; name: string }>;
  producers: Array<{ id: string; name: string }>;
  nextCursor: { beforeAt: string; beforeId: string } | null;
}
export function youtubeLibraryLinks(value: string | null) {
  try {
    if (!value) return { youtubeUrl: null, youtubeStudioUrl: null };
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      return { youtubeUrl: null, youtubeStudioUrl: null };
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : ["www.youtube.com", "youtube.com"].includes(url.hostname) &&
            url.pathname === "/watch"
          ? url.searchParams.get("v")
          : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
      return { youtubeUrl: null, youtubeStudioUrl: null };
    return {
      youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
      youtubeStudioUrl: `https://studio.youtube.com/video/${id}/edit`,
    };
  } catch {
    return { youtubeUrl: null, youtubeStudioUrl: null };
  }
}
export function libraryDuration(value: string | null) {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && n > 0
    ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`
    : "—";
}
export function libraryStageTone(status: string): "success" | "danger" | "warning" | "active" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status.startsWith("FAILED") || status === "CANCELLED") return "danger";
  if (status.startsWith("AWAITING") || status === "READY_TO_RECORD") return "warning";
  if (status.startsWith("GENERATING") || status === "SPLICING") return "active";
  return "neutral";
}
