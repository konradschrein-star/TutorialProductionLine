export function stageTimeLabel(status: string, since: string | null, now = Date.now()): string {
  if (!since || !Number.isFinite(Date.parse(since))) return "Stage start not recorded";
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const elapsed = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (["COMPLETED", "CANCELLED"].includes(status)) return `Stage entered ${elapsed} ago`;
  if (["GENERATING_SCRIPT", "GENERATING_AUDIO", "SPLICING", "QUEUED"].includes(status)) return `Automation stage elapsed: ${elapsed}`;
  return `Current stage elapsed: ${elapsed}`;
}
export function escapeRecordSearch(query: string) { return `%${query.replace(/[\\%_]/g, "\\$&")}%`; }

export interface ActivityRecord {
  id: string; sourceId: string | null; title: string; language: string | null; status: string;
  producer: string | null; channel: string | null; duration: string | null;
  voice: string; provider: string; review: string | null; keyword: string | null;
  createdAt: string; stageSince: string | null; thumbnailId: string | null;
  hasVideo: boolean; error: string | null; locales?: ActivityRecord[];
}
