import { bounds, emptyDay, type ScheduleDay, type Selection } from "./core";

export type Snapshot = { payload: string; fetched_at: number; attempted_at: number; error: string | null; version: number };
export function presentSnapshot(row: Snapshot | undefined, day: string, p: Selection, now: number): ScheduleDay {
  if (!row) return emptyDay(day,p,"unavailable","Графік перевіряється. Повторіть за кілька секунд.");
  const payload = JSON.parse(row.payload) as ScheduleDay;
  const stale = !!row.error || now-row.fetched_at>900;
  // Keep the last successfully parsed table for this day, visibly unverified.
  // Never reinterpret it as a current schedule or use it for reminders.
  const saved = stale && row.fetched_at>0 && payload.date===day && payload.status==="published";
  return {
    ...payload,...bounds(day),
    ...(stale ? {
      status:saved?"cached":"unavailable",
      intervals:saved?payload.intervals:[],
      message:saved
        ? "Не вдалося оновити джерело. Показано останній збережений графік; він міг змінитися. Перевірте офіційний сайт."
        : "Джерело недоступне або дані застаріли. Перевірте офіційний сайт.",
    }:{}),
    stale,last_success:row.fetched_at||null,last_attempt:row.attempted_at,version:row.version,
  };
}
