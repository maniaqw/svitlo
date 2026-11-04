import {
  bounds,
  civil,
  emptyDay,
  localDate,
  type Interval,
  type ScheduleDay,
  type Selection,
} from "./core";

/** Read public JSON assignments only; never evaluate provider JavaScript. */
export function assignedJson(
  html: string,
  property: "fact" | "preset",
): Record<string, unknown> {
  const match = new RegExp(`\\bDisconSchedule\\.${property}\\s*=\\s*`).exec(
    html,
  );
  if (!match) throw new Error(`DTEK ${property} JSON is absent`);
  const start = match.index + match[0].length;
  if (html[start] !== "{")
    throw new Error("DTEK assignment is not a JSON object");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("Incomplete DTEK JSON assignment");
}

const states: Record<string, [string, string]> = {
  yes: ["on", "on"],
  no: ["planned", "planned"],
  first: ["planned", "on"],
  second: ["on", "planned"],
  maybe: ["possible", "possible"],
  mfirst: ["possible", "on"],
  msecond: ["on", "possible"],
};
function merge(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.end === interval.start &&
      previous.state === interval.state
    )
      previous.end = interval.end;
    else result.push({ ...interval });
  }
  return result.map((i) =>
    i.state === "planned"
      ? { ...i, event_start: i.start, event_end: i.end }
      : i,
  );
}

export function parseDtek(
  html: string,
  p: Selection,
  days: string[],
): ScheduleDay[] {
  if (
    html.includes("_Incapsula_Resource") &&
    !/DisconSchedule\.fact\s*=/.test(html)
  )
    throw new Error("DTEK source access restricted");
  const fact = assignedJson(html, "fact"),
    preset = assignedJson(html, "preset");
  if (
    !fact.data ||
    typeof fact.data !== "object" ||
    !preset.time_zone ||
    typeof preset.time_zone !== "object"
  )
    throw new Error("DTEK schema changed");
  if (
    /DisconSchedule\.(?:showTableFact|showCurSchedule)\s*=\s*false\b/.test(html)
  ) {
    return days.map((day) =>
      emptyDay(
        day,
        p,
        "unavailable",
        "Оператор тимчасово не показує добові графіки. Перевірте повідомлення на офіційному сайті.",
      ),
    );
  }
  const sourceDays = new Map<string, Record<string, unknown>>();
  for (const [epoch, value] of Object.entries(fact.data)) {
    if (
      !/^\d{10}$/.test(epoch) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error("Invalid DTEK day");
    const date = localDate(Number(epoch) * 1000);
    if (sourceDays.has(date) || civil(date, "00:00") !== Number(epoch))
      throw new Error("Invalid or duplicate DTEK day");
    sourceDays.set(date, value as Record<string, unknown>);
  }
  const result = days.map((day) => {
    const row = sourceDays.get(day)?.[`GPV${p.queue}`];
    if (row === undefined) return emptyDay(day, p, "unpublished");
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Invalid DTEK group");
    const intervals: Interval[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const slot = String(hour + 1),
        from = `${String(hour).padStart(2, "0")}:00`,
        to = `${String(hour + 1).padStart(2, "0")}:00`;
      const zone = (preset.time_zone as Record<string, unknown>)[slot];
      if (!Array.isArray(zone) || zone[1] !== from || zone[2] !== to)
        throw new Error("DTEK time-zone schema changed");
      const state = (row as Record<string, unknown>)[slot];
      if (typeof state !== "string" || !Object.hasOwn(states, state))
        throw new Error("Unknown DTEK state");
      const start = civil(day, from),
        end = civil(day, to),
        middle = start + (end - start) / 2;
      intervals.push(
        { start, end: middle, state: states[state][0] },
        { start: middle, end, state: states[state][1] },
      );
    }
    return {
      ...emptyDay(day, p, "published"),
      intervals: merge(intervals),
      published_at: typeof fact.update === "string" ? fact.update : undefined,
    };
  });
  // Two daily tables can describe one outage spanning midnight.
  for (let i = 1; i < result.length; i++) {
    const last = result[i - 1].intervals.at(-1),
      first = result[i].intervals[0];
    if (
      last?.state === "planned" &&
      first?.state === "planned" &&
      last.end === first.start
    ) {
      last.event_end = first.event_end;
      first.event_start = last.event_start;
    }
  }
  return result;
}
