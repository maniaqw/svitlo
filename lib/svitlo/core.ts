import catalogData from "./catalog.json";
export const catalog = catalogData;
export type Selection = {
  region: string;
  operator: string;
  queue: string;
  language: "uk" | "ru";
  notifications: boolean;
};
export const defaultSelection: Selection = {
  region: "ivano-frankivsk",
  operator: "prykarpattya",
  queue: "1.1",
  language: "uk",
  notifications: false,
};
export const operators = new Map(
  catalog.regions.flatMap((region) =>
    region.operators.map((op) => [op.id, op] as const),
  ),
);
export type Interval = {
  start: number;
  end: number;
  state: string;
  event_start?: number;
  event_end?: number;
};
export type ScheduleDay = {
  operator_id: string;
  queue: string;
  date: string;
  status: string;
  intervals: Interval[];
  source_url: string;
  message?: string;
  published_at?: string;
  last_success: number | null;
  last_attempt: number | null;
  stale: boolean;
  version: number;
  day_start: number;
  day_end: number;
  ticks: { label: string; time: number }[];
};
export function selection(input: unknown): Selection {
  if (!input || typeof input !== "object")
    throw new Error("Некоректні налаштування");
  const v = input as Record<string, unknown>,
    r = catalog.regions.find((r) => r.id === v.region),
    op = r?.operators.find((o) => o.id === v.operator);
  if (
    !op ||
    typeof v.queue !== "string" ||
    !(op.queues.length
      ? v.queue === "" || op.queues.includes(v.queue)
      : v.queue === "")
  )
    throw new Error("Невідома область, оператор або черга");
  if (
    !["uk", "ru"].includes(String(v.language)) ||
    typeof v.notifications !== "boolean"
  )
    throw new Error("Некоректні налаштування");
  return {
    region: r!.id,
    operator: op.id,
    queue: v.queue,
    language: v.language as "uk" | "ru",
    notifications: v.notifications,
  };
}
export function localDate(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addDay(day: string, delta = 1) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}
function partsAt(epoch: number) {
  const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(epoch * 1000),
    get = (s: string) => Number(p.find((v) => v.type === s)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}
export function civil(day: string, time: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) && time !== "24:00")
  )
    throw new Error("Unknown civil date/time");
  if (time === "24:00") return civil(addDay(day), "00:00");
  const [y, m, d] = day.split("-").map(Number),
    [h, minute] = time.split(":").map(Number),
    target = Date.UTC(y, m - 1, d, h, minute) / 1000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = partsAt(guess);
    guess +=
      target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000;
  }
  const matches = (v: number) => {
    const p = partsAt(v);
    return (
      p.year === y &&
      p.month === m &&
      p.day === d &&
      p.hour === h &&
      p.minute === minute
    );
  };
  if (!matches(guess) || matches(guess - 3600) || matches(guess + 3600))
    throw new Error("Ambiguous or nonexistent DST time");
  return guess;
}
export function bounds(day: string) {
  return {
    day_start: civil(day, "00:00"),
    day_end: civil(day, "24:00"),
    ticks: [0, 4, 8, 12, 16, 20, 24].map((h) => ({
      label: String(h).padStart(2, "0"),
      time: civil(day, `${String(h).padStart(2, "0")}:00`),
    })),
  };
}
function outage(day: string, row: { from: string; to: string }): Interval {
  const start = civil(day, row.from);
  let end = civil(day, row.to);
  if (end <= start) end = civil(addDay(day), row.to);
  return { start, end, state: "planned", event_start: start, event_end: end };
}
function fill(day: string, segments: Interval[]): Interval[] {
  const { day_start: lo, day_end: hi } = bounds(day),
    result: Interval[] = [];
  let cursor = lo;
  for (const i of segments.sort((a, b) => a.start - b.start)) {
    const a = Math.max(lo, i.start),
      b = Math.min(hi, i.end);
    if (b <= a) continue;
    if (a < cursor) throw new Error("Overlapping intervals");
    if (a > cursor) result.push({ start: cursor, end: a, state: "on" });
    result.push({ ...i, start: a, end: b });
    cursor = b;
  }
  if (cursor < hi) result.push({ start: cursor, end: hi, state: "on" });
  return result;
}
export function emptyDay(
  day: string,
  p: Selection,
  status: string,
  message?: string,
): ScheduleDay {
  return {
    operator_id: p.operator,
    queue: p.queue,
    date: day,
    status,
    intervals: [],
    source_url: operators.get(p.operator)!.url,
    message,
    last_success: null,
    last_attempt: null,
    stale: false,
    version: 0,
    ...bounds(day),
  };
}
export function parsePrykarpattya(
  payload: unknown,
  p: Selection,
  days: string[],
): ScheduleDay[] {
  if (!Array.isArray(payload)) throw new Error("Provider schema changed");
  const rows = new Map<
    string,
    {
      queues: Record<string, { from: string; to: string }[]>;
      scheduleApprovedSince?: string;
    }
  >();
  for (const row of payload) {
    if (
      typeof row?.eventDate !== "string" ||
      !/^\d{2}\.\d{2}\.\d{4}$/.test(row.eventDate) ||
      !row.queues ||
      typeof row.queues !== "object"
    )
      throw new Error("Invalid source date/queues");
    const [d, m, y] = row.eventDate.split("."),
      date = `${y}-${m}-${d}`;
    if (rows.has(date)) throw new Error("Duplicate source date");
    rows.set(date, row);
  }
  return days.map((day) => {
    const row = rows.get(day);
    if (!row || !Object.hasOwn(row.queues, p.queue))
      return emptyDay(day, p, "unpublished");
    const entries = row.queues[p.queue];
    if (!Array.isArray(entries)) throw new Error("Invalid intervals");
    const segments = entries.map((i) => outage(day, i));
    const previous = rows.get(addDay(day, -1))?.queues[p.queue];
    if (previous) {
      if (!Array.isArray(previous))
        throw new Error("Invalid previous intervals");
      for (const i of previous) {
        const s = outage(addDay(day, -1), i);
        if (s.end > civil(day, "00:00")) segments.push(s);
      }
    }
    return {
      ...emptyDay(day, p, "published"),
      intervals: fill(day, segments),
      published_at: row.scheduleApprovedSince,
    };
  });
}
export function parsePoltava(html: string, p: Selection, days: string[]) {
  const pdf = /href=["'][^"']*HPV[^"']*\.pdf["']/i.test(html);
  return days.map((day) =>
    emptyDay(
      day,
      p,
      "unsupported",
      pdf
        ? "Опубліковано сезонний PDF, але підтверджені добові інтервали недоступні."
        : "Добові інтервали на сторінці не підтверджено.",
    ),
  );
}
export async function authenticate(
  raw: string,
  token: string,
  now = Date.now() / 1000,
) {
  if (!raw || raw.length > 16384 || !token)
    throw new Error("Missing Telegram authorization");
  const values = new URLSearchParams(raw),
    seen = new Set<string>();
  for (const [key] of values) {
    if (seen.has(key)) throw new Error("Duplicate auth fields");
    seen.add(key);
  }
  const supplied = values.get("hash") || "";
  values.delete("hash");
  const check = [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hmac = async (key: BufferSource, value: string) => {
    const k = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return new Uint8Array(
      await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value)),
    );
  };
  const secret = await hmac(new TextEncoder().encode("WebAppData"), token),
    actual = await hmac(secret, check),
    expected = [...actual].map((v) => v.toString(16).padStart(2, "0")).join("");
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    mismatch |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (mismatch) throw new Error("Invalid Telegram signature");
  const age = now - Number(values.get("auth_date"));
  if (!Number.isFinite(age) || age < -30 || age > 3600)
    throw new Error("Telegram authorization expired; reopen the Mini App");
  const user = JSON.parse(values.get("user") || "{}");
  if (!Number.isSafeInteger(user.id) || user.id <= 0)
    throw new Error("Invalid Telegram user");
  return String(user.id);
}
