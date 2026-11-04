import type { Interval } from "./types";
export const time = (epoch: number) =>
  new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(epoch * 1000);
export const dateLabel = (value: string, language = "uk") =>
  new Intl.DateTimeFormat(language === "uk" ? "uk-UA" : "ru-RU", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00Z`));
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
export function currentAndNext(intervals: Interval[], now: number) {
  return {
    current: intervals.find((i) => i.start <= now && i.end > now),
    next: intervals
      .filter((i) => i.state === "planned" && (i.event_start ?? i.start) > now)
      .sort((a, b) => a.start - b.start)[0],
  };
}
