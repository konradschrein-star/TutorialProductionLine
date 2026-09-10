import { describe, expect, it } from "vitest";
import { ChannelScheduleSchema, channelLocalDate, nextPublicationSlot, scheduleForLocalDay, slotsForLocalDay } from "../publication-slots";
const config = ChannelScheduleSchema.parse({ timezone: "Europe/Berlin" });
describe("channel publication slots", () => {
  it("defaults to thirty slots per individual channel", () => {
    const slots = slotsForLocalDay("2026-09-08", config);
    expect(slots).toHaveLength(30);
    expect(new Set(slots.map(Number)).size).toBe(30);
    expect(slots[0]!.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });
  it.each(["2026-03-29", "2026-10-25"])("preserves capacity across DST on %s", (day) => {
    const slots = slotsForLocalDay(day, { ...config, startMinute: 0, endMinute: 1440 });
    expect(slots).toHaveLength(30);
    expect(new Set(slots.map(Number)).size).toBe(30);
    expect(slots.every((slot) => channelLocalDate(slot, config.timezone) === day)).toBe(true);
  });
  it("skips occupied timestamps and never reserves in the past", () => {
    const slots = slotsForLocalDay("2026-09-08", config);
    expect(nextPublicationSlot(new Date("2026-09-08T06:00:00Z"), [slots[1]!], config)).toEqual(slots[2]);
  });
  it("counts admin overrides towards daily capacity", () => {
    const occupied = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 8, 8, i)));
    expect(channelLocalDate(nextPublicationSlot(new Date("2026-09-08T00:00:00Z"), occupied, config), config.timezone)).toBe("2026-09-09");
  });
  it("uses the channel day near the international date boundary", () => {
    const local = { ...config, timezone: "Pacific/Kiritimati" };
    expect(channelLocalDate(nextPublicationSlot(new Date("2026-09-08T20:00:00Z"), [], local), local.timezone)).toBe("2026-09-09");
  });
  it("rejects invalid configuration", () => {
    expect(ChannelScheduleSchema.safeParse({ timezone: "not-a-zone" }).success).toBe(false);
    expect(ChannelScheduleSchema.safeParse({ startMinute: 1200, endMinute: 500 }).success).toBe(false);
    expect(ChannelScheduleSchema.safeParse({ startMinute: 480, endMinute: 490, dailyCapacity: 30 }).success).toBe(false);
  });
  it("continues planning after a date whose entire window falls in a DST gap", () => {
    const gap = { ...config, startMinute: 120, endMinute: 180, dailyCapacity: 3 };
    const slot = nextPublicationSlot(new Date("2026-03-29T00:00:00Z"), [], gap);
    expect(channelLocalDate(slot, gap.timezone)).toBe("2026-03-30");
  });
  it("supports different capacity and closed days in a weekly upload plan", () => {
    const active = (dailyCapacity: number) => ({ enabled: true, dailyCapacity, startMinute: 480, endMinute: 1200 });
    const closed = { enabled: false, dailyCapacity: 30, startMinute: 480, endMinute: 1200 };
    const weekly = ChannelScheduleSchema.parse({ timezone: "Europe/Berlin", weeklyPlan: {
      monday: active(12), tuesday: active(20), wednesday: active(30), thursday: active(30), friday: active(8), saturday: closed, sunday: closed,
    } });
    expect(slotsForLocalDay("2026-09-07", weekly)).toHaveLength(12);
    expect(slotsForLocalDay("2026-09-12", weekly)).toEqual([]);
    expect(scheduleForLocalDay("2026-09-13", weekly)).toMatchObject({ enabled: false, dailyCapacity: 30 });
    expect(channelLocalDate(nextPublicationSlot(new Date("2026-09-11T19:00:00Z"), [], weekly), weekly.timezone)).toBe("2026-09-14");
  });
  it("keeps legacy single-window schedules backward compatible", () => {
    const legacy = ChannelScheduleSchema.parse({ dailyCapacity: 42, startMinute: 60, endMinute: 600 });
    expect(scheduleForLocalDay("2026-09-12", legacy)).toMatchObject({ enabled: true, dailyCapacity: 42, startMinute: 60, endMinute: 600 });
  });
});
