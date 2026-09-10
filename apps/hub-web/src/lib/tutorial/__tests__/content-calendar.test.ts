import { expect, it } from "vitest";
import { calendarDays, calendarCell, type CalendarEntry } from "../content-calendar";
const channel = { id: "ch", name: "Assigned", language: "de", schedule: { timezone: "Europe/Berlin", dailyCapacity: 30, startMinute: 480, endMinute: 1200 } };
const entry: CalendarEntry = { id: "one", title: "Tutorial", channelId: "ch", language: "de", publishAt: "2026-09-09T23:00:00Z", uploaderStatus: null, youtubeVisibility: null, isUploaded: false, uploadVerifiedAt: null, youtubePublishedAt: null };
it("uses seven calendar dates across month boundaries", () => { expect(calendarDays("2026-09-28")).toEqual(["2026-09-28","2026-09-29","2026-09-30","2026-10-01","2026-10-02","2026-10-03","2026-10-04"]); });
it.each(["2026-02-30", "2026-13-01", "", "2026-9-1"])("rejects invalid calendar date %s", date => { expect(() => calendarDays(date)).toThrow(); });
it("counts the known channel's local day without assigning another channel", () => {
  expect(calendarCell([entry, { ...entry, id: "other", channelId: "other" }], channel, "2026-09-10")).toMatchObject({ count: 1, capacity: 30 });
  expect(calendarCell([entry], channel, "2026-09-09").count).toBe(0);
});
it("preserves reservations after upload and does not invent a capacity for bad settings", () => {
  expect(calendarCell([{ ...entry, isUploaded: true }], channel, "2026-09-10").count).toBe(1);
  expect(calendarCell([], { ...channel, schedule: null }, "2026-09-10").capacity).toBeNull();
});
it("buckets DST-day timestamps by the configured timezone", () => {
  const rows = ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"].map((publishAt,index) => ({ ...entry, id: String(index), publishAt }));
  expect(calendarCell(rows, channel, "2026-10-25").count).toBe(2);
});
it("shows the configured weekday capacity and closed days", () => {
  const active = { enabled: true, dailyCapacity: 12, startMinute: 480, endMinute: 1200 };
  const closed = { ...active, enabled: false };
  const weekly = { ...channel, schedule: { ...channel.schedule, weeklyPlan: { monday: active, tuesday: active, wednesday: active, thursday: active, friday: active, saturday: closed, sunday: closed } } };
  expect(calendarCell([], weekly, "2026-09-07")).toMatchObject({ capacity: 12, enabled: true });
  expect(calendarCell([], weekly, "2026-09-12")).toMatchObject({ capacity: 0, enabled: false });
});
