import { channelLocalDate, scheduleForLocalDay, type ChannelSchedule } from "@repo/contracts";
export type CalendarChannel = { id: string; name: string; language: string; schedule: ChannelSchedule | null };
export type CalendarEntry = { id: string; title: string; language: string; channelId: string | null; publishAt: string; uploaderStatus: string | null; youtubeVisibility: string | null; isUploaded: boolean; uploadVerifiedAt: string | null; youtubePublishedAt: string | null };
export function calendarDays(start: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(`${start}T00:00:00Z`)) || new Date(`${start}T00:00:00Z`).toISOString().slice(0,10) !== start) throw Error("Choose a valid calendar date.");
  return Array.from({ length: 7 }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 86400000).toISOString().slice(0,10));
}
export function calendarCell(entries: readonly CalendarEntry[], channel: CalendarChannel, day: string) {
  const rows = entries.filter(row => row.channelId === channel.id && Number.isFinite(Date.parse(row.publishAt)) && channelLocalDate(new Date(row.publishAt), channel.schedule?.timezone ?? "UTC") === day).sort((a,b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id));
  const plan = channel.schedule ? scheduleForLocalDay(day, channel.schedule) : null;
  return { rows, count: rows.length, capacity: plan ? (plan.enabled ? plan.dailyCapacity : 0) : null, enabled: plan?.enabled ?? null };
}
