import { catalog, defaultSelection, operators, selection, type ScheduleDay, type Selection } from "./core";

export type Reminder = { key: string; start: number; end: number; text: string };
export async function authorizedJob(header: string | null, secret: string | undefined): Promise<boolean> {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([digest(header.slice(7)),digest(secret)]);
  let difference=0;
  for (let i=0;i<a.length;i++) difference |= a[i]^b[i];
  return difference === 0;
}
export function dueReminders(p: Selection, days: ScheduleDay[], now: number): Reminder[] {
  const found = new Map<string, Reminder>();
  for (const day of days) {
    if (day.status !== "published" || day.stale || !day.last_success || now - day.last_success > 900) continue;
    for (const interval of day.intervals) {
      if (interval.state !== "planned") continue;
      const start = interval.event_start ?? interval.start, end = interval.event_end ?? interval.end;
      // Never send a late warning once the outage has started. Allow scheduler jitter.
      if (start <= now || start - now > 1800 || start - now < 1200) continue;
      const key = `${p.operator}:${p.queue}:${start}:${end}`;
      const clock = (value: number) => new Intl.DateTimeFormat(p.language === "uk" ? "uk-UA" : "ru-RU", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value * 1000);
      const title = p.language === "uk" ? "⚡ Незабаром планове відключення" : "⚡ Скоро плановое отключение";
      found.set(key, { key, start, end, text: `${title}\n${operators.get(p.operator)!.name} · ${p.queue}\n${clock(start)} — ${clock(end)}\n${p.language === "uk" ? "Приблизно через" : "Примерно через"} ${Math.round((start-now)/60)} ${p.language === "uk" ? "хв" : "мин"}\n${day.source_url}` });
    }
  }
  return [...found.values()];
}

export async function dispatchReminders(deps: {
  db: D1Database;
  schedule: (p: Selection) => Promise<{days: ScheduleDay[]}>;
  send: (chat: string, text: string) => Promise<unknown>;
  now?: number;
}) {
  const now = deps.now ?? Date.now()/1000;
  await deps.db.prepare("CREATE TABLE IF NOT EXISTS reminder_deliveries (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, created_at REAL NOT NULL)").run();
  const lock = await deps.db.prepare("INSERT INTO source_leases(key,checked_at) VALUES ('reminder-run',?) ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at WHERE source_leases.checked_at<=? RETURNING key").bind(now,now-240).first();
  if (!lock) return { skipped: "already_running_or_recent", sent: 0 };
  const profiles = await deps.db.prepare("SELECT * FROM telegram_profiles WHERE notifications=1 AND bot_started=1 AND chat_id IS NOT NULL ORDER BY id LIMIT 500").all<Selection & {id:string;chat_id:string}>();
  const cache = new Map<string, Awaited<ReturnType<typeof deps.schedule>>>();
  let sent=0, failed=0, checked=0, refreshed=0;
  // Refresh previously requested locations even with no opted-in recipients.
  // The cloud job keeps serving saved queues while all user devices are offline.
  const active = await deps.db.prepare("SELECT key FROM source_leases WHERE key LIKE '%:%' AND key NOT LIKE 'provider:%' ORDER BY checked_at DESC LIMIT 8").all<{key:string}>();
  const refreshDeadline = Date.now()+15000;
  for (const {key} of active.results) {
    if (Date.now()>refreshDeadline) break;
    const [operator,queue,...extra] = key.split(":");
    const region = catalog.regions.find(r=>r.operators.some(o=>o.id===operator));
    if (!region || extra.length) continue;
    try {
      const p = selection({...defaultSelection,region:region.id,operator,queue});
      if (operators.get(operator)?.adapter === "unsupported") continue;
      cache.set(key,await deps.schedule(p));
      refreshed++;
    } catch { failed++; }
  }
  for (const raw of profiles.results) {
    try {
      const p = {...raw, notifications:true};
      const location = `${p.operator}:${p.queue}`;
      if (!cache.has(location)) cache.set(location,await deps.schedule(p));
      checked++;
      for (const notice of dueReminders(p,cache.get(location)!.days,now)) {
        // Recheck opt-out and selection just before claiming delivery.
        const eligible = await deps.db.prepare("SELECT id FROM telegram_profiles WHERE id=? AND notifications=1 AND bot_started=1 AND chat_id=? AND operator=? AND queue=?").bind(p.id,p.chat_id,p.operator,p.queue).first();
        if (!eligible) continue;
        const key = `${p.id}:${notice.key}`;
        const claim = await deps.db.prepare("INSERT OR IGNORE INTO reminder_deliveries(key,user_id,status,created_at) VALUES (?,?,'claimed',?) RETURNING key").bind(key,p.id,now).first();
        if (!claim) continue;
        try {
          await deps.send(p.chat_id,notice.text);
          await deps.db.prepare("UPDATE reminder_deliveries SET status='sent' WHERE key=?").bind(key).run();
          sent++;
        } catch {
          // Telegram has no idempotency key: don't retry ambiguous sends and duplicate warnings.
          await deps.db.prepare("UPDATE reminder_deliveries SET status='unknown' WHERE key=?").bind(key).run();
          failed++;
        }
      }
    } catch { failed++; }
  }
  await deps.db.prepare("INSERT INTO source_leases(key,checked_at) VALUES ('reminder-heartbeat',?) ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at").bind(now).run();
  await deps.db.prepare("DELETE FROM reminder_deliveries WHERE created_at<?").bind(now-7*86400).run();
  return { checked, sent, failed, refreshed, checked_at: now };
}
