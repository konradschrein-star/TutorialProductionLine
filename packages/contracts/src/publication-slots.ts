import { z } from "zod";
// Shared planning rules for Hub review and background locale completion.

export const CHANNEL_SCHEDULE_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export const ChannelDayScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  dailyCapacity: z.number().int().min(1).max(500).default(30),
  startMinute: z.number().int().min(0).max(1439).default(480),
  endMinute: z.number().int().min(1).max(1440).default(1200),
}).refine((value) => !value.enabled || value.endMinute > value.startMinute, "The distribution window must end after it starts")
  .refine((value) => !value.enabled || value.endMinute - value.startMinute >= value.dailyCapacity, "The distribution window needs at least one minute per publication");

const WeeklyChannelScheduleSchema = z.object(Object.fromEntries(
  CHANNEL_SCHEDULE_WEEKDAYS.map((day) => [day, ChannelDayScheduleSchema]),
) as Record<(typeof CHANNEL_SCHEDULE_WEEKDAYS)[number], typeof ChannelDayScheduleSchema>);

export const ChannelScheduleSchema = z.object({
  timezone: z.string().default("UTC").refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Use an IANA timezone such as Europe/Berlin"),
  dailyCapacity: z.number().int().min(1).max(500).default(30),
  startMinute: z.number().int().min(0).max(1439).default(480),
  endMinute: z.number().int().min(1).max(1440).default(1200),
  weeklyPlan: WeeklyChannelScheduleSchema.optional(),
}).refine((value) => value.endMinute > value.startMinute, "The distribution window must end after it starts")
  .refine((value) => value.endMinute - value.startMinute >= value.dailyCapacity, "The distribution window needs at least one minute per publication");
export type ChannelSchedule = z.infer<typeof ChannelScheduleSchema>;
export type ChannelDaySchedule = z.infer<typeof ChannelDayScheduleSchema>;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let result = formatters.get(timezone);
  if (!result) {
    result = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, result);
  }
  return result;
}
export function channelLocalDate(instant: Date, timezone: string): string {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekdayForLocalDate(day: string): (typeof CHANNEL_SCHEDULE_WEEKDAYS)[number] {
  const instant = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== day) throw new Error("Invalid calendar date");
  return CHANNEL_SCHEDULE_WEEKDAYS[(instant.getUTCDay() + 6) % 7]!;
}

/** Resolve a local calendar date to its explicit weekday plan. Legacy schedules
 * without a weekly plan continue to use their single daily configuration. */
export function scheduleForLocalDay(day: string, schedule: ChannelSchedule): ChannelDaySchedule {
  const config = ChannelScheduleSchema.parse(schedule);
  return config.weeklyPlan?.[weekdayForLocalDate(day)] ?? {
    enabled: true,
    dailyCapacity: config.dailyCapacity,
    startMinute: config.startMinute,
    endMinute: config.endMinute,
  };
}

/** Enumerate real instants: nonexistent DST minutes are skipped, repeated ones
 * remain distinct. Capacity is per local calendar date, not per 24 UTC hours. */
export function slotsForLocalDay(day: string, schedule: ChannelSchedule): Date[] {
  const config = ChannelScheduleSchema.parse(schedule);
  const dayPlan = scheduleForLocalDay(day, config);
  if (!dayPlan.enabled) return [];
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) throw new Error("Invalid calendar date");
  const minutes: number[] = [];
  const fmt = formatter(config.timezone);
  // All IANA offsets fit inside this range, including historical +14 / -12.
  for (let time = midnight - 14 * 3_600_000; time < midnight + 36 * 3_600_000; time += 60_000) {
    const parts = Object.fromEntries(fmt.formatToParts(time).map((part) => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== day) continue;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (minute >= dayPlan.startMinute && minute < dayPlan.endMinute) minutes.push(time);
  }
  if (minutes.length < dayPlan.dailyCapacity) throw new Error("The distribution window is too short for the channel capacity on this date");
  return Array.from({ length: dayPlan.dailyCapacity }, (_, index) => new Date(minutes[Math.floor(index * minutes.length / dayPlan.dailyCapacity)]!));
}

/** Caller must hold the destination-channel database lock through persistence. */
export function nextPublicationSlot(now: Date, occupied: readonly Date[], schedule: ChannelSchedule): Date {
  const config = ChannelScheduleSchema.parse(schedule);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid current time");
  const taken = new Set(occupied.map((instant) => instant.getTime()));
  const dailyCounts = new Map<string, number>();
  for (const instant of occupied) {
    const day = channelLocalDate(instant, config.timezone);
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }
  const start = Date.parse(`${channelLocalDate(now, config.timezone)}T00:00:00Z`);
  for (let offset = 0; offset < 366; offset++) {
    const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    const dayPlan = scheduleForLocalDay(day, config);
    if (!dayPlan.enabled || (dailyCounts.get(day) ?? 0) >= dayPlan.dailyCapacity) continue;
    // A spring-forward gap can remove the configured window for one date.
    // Leave that date empty rather than blocking all future planning.
    let slots: Date[];
    try { slots = slotsForLocalDay(day, config); }
    catch (error) {
      if (error instanceof Error && error.message.includes("too short")) continue;
      throw error;
    }
    const candidate = slots.find((slot) => slot > now && !taken.has(slot.getTime()));
    if (candidate) return candidate;
  }
  throw new Error("No publication slot is available in the next year. Ask an Admin to review this channel's plan.");
}
