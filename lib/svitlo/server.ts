import { env as workerEnv } from "cloudflare:workers";
import { parseDtek, assignedJson } from "./dtek";
import { fetchSource } from "./source";
import { authorizedJob, dispatchReminders } from "./reminders";
import { presentSnapshot } from "./snapshots";
import {
  authenticate,
  addDay,
  bounds,
  catalog,
  defaultSelection,
  emptyDay,
  localDate,
  operators,
  parsePoltava,
  parsePrykarpattya,
  selection,
  type ScheduleDay,
  type Selection,
} from "./core";
type Runtime = {
  DB: D1Database;
  BOT_TOKEN?: string;
  BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  MINI_APP_URL?: string;
  REMINDER_OWNER_EMAIL?: string;
  NOTIFICATIONS_ENABLED?: string;
  REMINDER_JOB_SECRET?: string;
};
const runtime = () => workerEnv as unknown as Runtime;
const remindersReady = () => !!runtime().BOT_TOKEN && runtime().NOTIFICATIONS_ENABLED === "1";
type Profile = Selection & {
  id?: string;
  bot_started: boolean;
  bot_username: string;
  dev: false;
  demo: false;
  guest: boolean;
  bot_configured: boolean;
  notifications_ready: boolean;
};
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
async function preferences(request: Request): Promise<Profile> {
  const env = runtime(),
    authorization = request.headers.get("authorization") || "";
  let selected = defaultSelection;
  if (authorization.startsWith("tma ") && env.BOT_TOKEN) {
    let id: string;
    try {
      id = await authenticate(authorization.slice(4), env.BOT_TOKEN);
    } catch {
      throw new ApiError(
        401,
        "Пере відкрийте застосунок у Telegram для авторизації",
      );
    }
    let row = await env.DB.prepare("SELECT * FROM telegram_profiles WHERE id=?").bind(id).first<Record<string,unknown>>();
    if (!row) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO telegram_profiles(id,region,operator,queue,language,notifications,bot_started,updated_at) VALUES (?,?,?,?,?,0,0,?)",
    )
      .bind(
        id,
        selected.region,
        selected.operator,
        selected.queue,
        selected.language,
        Date.now() / 1000,
      )
      .run();
    row = await env.DB.prepare(
      "SELECT * FROM telegram_profiles WHERE id=?",
    )
      .bind(id)
      .first<Record<string, unknown>>();
    }
    return {
      ...selection({ ...row, notifications: !!row!.notifications }),
      id,
      bot_started: !!row!.bot_started,
      bot_username: env.BOT_USERNAME || "",
      dev: false,
      demo: false,
      guest: false,
      bot_configured: true,
      notifications_ready: remindersReady(),
    };
  }
  const guest = request.headers.get("x-guest-preferences");
  if (guest && guest.length < 1200) {
    try {
      selected = selection(JSON.parse(decodeURIComponent(guest)));
    } catch {}
  }
  return {
    ...selected,
    notifications: false,
    bot_started: false,
    bot_username: env.BOT_USERNAME || "",
    dev: false,
    demo: false,
    guest: true,
    bot_configured: !!env.BOT_TOKEN,
    notifications_ready: remindersReady(),
  };
}
function publicProfile(p: Profile) {
  const { id, ...rest } = p;
  return rest;
}
async function dtekSource(
  env: Runtime,
  operator: string,
  url: string,
  now: number,
) {
  const key = `provider:${operator}`;
  const claim = await env.DB.prepare(
    "INSERT INTO source_leases(key,checked_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at WHERE source_leases.checked_at<=? RETURNING key",
  )
    .bind(key, now, now - 300)
    .first();
  if (claim) {
    try {
      const html = await fetchSource(url);
      if (
        html.includes("_Incapsula_Resource") &&
        !/DisconSchedule\.fact\s*=/.test(html)
      )
        throw new Error("DTEK source access restricted");
      const fact = assignedJson(html, "fact"),
        preset = assignedJson(html, "preset");
      const content =
        `DisconSchedule.fact = ${JSON.stringify(fact)}; DisconSchedule.preset = ${JSON.stringify({ time_zone: preset.time_zone })};` +
        (/DisconSchedule\.(?:showTableFact|showCurSchedule)\s*=\s*false\b/.test(
          html,
        )
          ? "DisconSchedule.showTableFact = false;"
          : "");
      // Cache only the public queue table, never the address/street directory.
      await env.DB.prepare(
        "INSERT INTO source_snapshots(key,payload,fetched_at,attempted_at,error,version) VALUES (?,?,?,?,NULL,1) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error=NULL,version=version+1",
      )
        .bind(key, content, now, now)
        .run();
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "Source unavailable";
      await env.DB.prepare(
        "INSERT INTO source_snapshots(key,payload,fetched_at,attempted_at,error,version) VALUES (?,'',0,?,?,0) ON CONFLICT(key) DO UPDATE SET attempted_at=excluded.attempted_at,error=excluded.error",
      )
        .bind(key, now, failure)
        .run();
      throw error;
    }
  }
  const cached = await env.DB.prepare(
    "SELECT payload,fetched_at,error FROM source_snapshots WHERE key=?",
  )
    .bind(key)
    .first<{ payload: string; fetched_at: number; error: string | null }>();
  if (!cached || cached.error || now - cached.fetched_at > 900)
    throw new Error(cached?.error || "Source cache is not ready");
  return { content: cached.payload, fetchedAt: cached.fetched_at };
}
async function getSchedule(p: Selection) {
  const env = runtime(),
    now = Date.now() / 1000,
    today = localDate(),
    days = [today, addDay(today)],
    op = operators.get(p.operator)!;
  if (op.queues.length && !p.queue)
    return {
      days: days.map((day) =>
        emptyDay(
          day,
          p,
          "selection_required",
          "Оберіть вашу чергу, щоб отримати відповідний графік.",
        ),
      ),
      server_time: now,
      timezone: "Europe/Kyiv",
      demo: false,
    };
  if (op.adapter === "unsupported")
    return {
      days: days.map((day) => emptyDay(day, p, "unsupported", op.limitation)),
      server_time: now,
      timezone: "Europe/Kyiv",
      demo: false,
    };
  const key = `${p.operator}:${p.queue}`;
  const rows = await env.DB.prepare(
    "SELECT * FROM source_snapshots WHERE key IN (?,?)",
  )
    .bind(`${key}:${days[0]}`, `${key}:${days[1]}`)
    .all<{
      key: string;
      payload: string;
      fetched_at: number;
      attempted_at: number;
      error: string | null;
      version: number;
    }>();
  const lease = await env.DB.prepare(
    "SELECT checked_at FROM source_leases WHERE key=?",
  )
    .bind(key)
    .first<{ checked_at: number }>();
  const provider =
    op.adapter === "dtek" && rows.results.some((row) => row.error)
      ? await env.DB.prepare(
          "SELECT fetched_at,error FROM source_snapshots WHERE key=?",
        )
          .bind(`provider:${op.id}`)
          .first<{ fetched_at: number; error: string | null }>()
      : null;
  const recovered =
    !!provider &&
    !provider.error &&
    rows.results.some(
      (row) => row.error && provider.fetched_at > row.attempted_at,
    );
  if (!lease || now - lease.checked_at >= 300 || recovered) {
    const claimed = await env.DB.prepare(
      "INSERT INTO source_leases(key,checked_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at WHERE source_leases.checked_at<=? RETURNING key",
    )
      .bind(key, now, now - (recovered ? 0 : 300))
      .first();
    if (claimed) {
      try {
        const url =
          op.adapter === "prykarpattya"
            ? `https://be-svitlo.oe.if.ua/schedule-by-queue?queue=${encodeURIComponent(p.queue)}`
            : op.url;
        const source =
          op.adapter === "dtek"
            ? await dtekSource(env, op.id, url, now)
            : { content: await fetchSource(url), fetchedAt: now };
        const { content, fetchedAt } = source;
        const parsed =
          op.adapter === "dtek"
            ? parseDtek(content, p, days)
            : op.adapter === "prykarpattya"
              ? parsePrykarpattya(JSON.parse(content), p, days)
              : parsePoltava(content, p, days);
        await env.DB.batch(
          parsed.map((d) => {
            const previous = rows.results.find(
                (r) => r.key === `${key}:${d.date}`,
              ),
              payload = JSON.stringify(d),
              version =
                previous && previous.payload === payload
                  ? previous.version
                  : (previous?.version || 0) + 1;
            return env.DB.prepare(
              "INSERT INTO source_snapshots(key,payload,fetched_at,attempted_at,error,version) VALUES (?,?,?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error=NULL,version=excluded.version",
            ).bind(`${key}:${d.date}`, payload, fetchedAt, now, version);
          }),
        );
      } catch (error) {
        console.warn(
          "Provider read failed",
          p.operator,
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "unknown",
        );
        const failure =
          error instanceof Error &&
          error.message === "DTEK source access restricted"
            ? "Source access restricted"
            : "Source unavailable";
        await env.DB.batch(
          days.map((day) =>
            env.DB.prepare(
              "INSERT INTO source_snapshots(key,payload,fetched_at,attempted_at,error,version) VALUES (?,?,0,?,?,0) ON CONFLICT(key) DO UPDATE SET attempted_at=excluded.attempted_at,error=excluded.error",
            ).bind(
              `${key}:${day}`,
              JSON.stringify(emptyDay(day, p, "unavailable")),
              now,
              failure,
            ),
          ),
        );
      }
    }
  }
  const fresh = await env.DB.prepare(
    "SELECT * FROM source_snapshots WHERE key IN (?,?)",
  )
    .bind(`${key}:${days[0]}`, `${key}:${days[1]}`)
    .all<{
      key: string;
      payload: string;
      fetched_at: number;
      attempted_at: number;
      error: string | null;
      version: number;
    }>();
  return {
    days: days.map(day=>presentSnapshot(fresh.results.find(r=>r.key===`${key}:${day}`),day,p,now)),
    server_time: now,
    timezone: "Europe/Kyiv",
    demo: false,
  };
}
async function telegram(method: string, body: unknown) {
  const token = runtime().BOT_TOKEN;
  if (!token) throw new ApiError(503, "Бота ще не підключено");
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    },
  );
  const result = (await response.json()) as { ok: boolean; result?: unknown };
  if (!response.ok || !result.ok)
    throw new ApiError(502, "Telegram тимчасово недоступний");
  return result.result;
}
async function webhook(request: Request) {
  const env = runtime();
  if (!env.BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET)
    throw new ApiError(503, "Бота ще не підключено");
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !==
    env.TELEGRAM_WEBHOOK_SECRET
  )
    throw new ApiError(401, "Unauthorized webhook");
  const update = (await request.json()) as {
    update_id: number;
    message?: {
      text?: string;
      from?: { id: number };
      chat: { id: number; type: string };
    };
  };
  if (!Number.isSafeInteger(update.update_id))
    throw new ApiError(400, "Invalid update");
  const claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_updates(id,status,created_at) VALUES (?,'claimed',?) RETURNING id",
  )
    .bind(String(update.update_id), Date.now() / 1000)
    .first();
  if (!claimed) return json({ ok: true });
  const message = update.message;
  if (
    !message ||
    message.chat.type !== "private" ||
    !message.from ||
    !Number.isSafeInteger(message.from.id)
  )
    return json({ ok: true });
  const id = String(message.from.id),
    command = message.text?.split(/[ @]/)[0];
  if (command === "/start" || command === "/schedule") {
    const p = defaultSelection;
    await env.DB.prepare(
      "INSERT INTO telegram_profiles(id,region,operator,queue,language,notifications,bot_started,chat_id,updated_at) VALUES (?,?,?,?,?,0,1,?,?) ON CONFLICT(id) DO UPDATE SET bot_started=1,chat_id=excluded.chat_id,updated_at=excluded.updated_at",
    )
      .bind(
        id,
        p.region,
        p.operator,
        p.queue,
        p.language,
        String(message.chat.id),
        Date.now() / 1000,
      )
      .run();
    const url = env.MINI_APP_URL || new URL(request.url).origin;
    try {
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text: "Вітаємо у Світло ⚡\nОберіть область, оператора та чергу й перевіряйте офіційний графік. У розділі «Сповіщення» можна увімкнути нагадування перед відключенням. /stop — вимкнути нагадування.",
        reply_markup: {
          inline_keyboard: [[{ text: "Відкрити графік", web_app: { url } }]],
        },
      });
      await env.DB.prepare(
        "UPDATE webhook_updates SET status='sent' WHERE id=?",
      )
        .bind(String(update.update_id))
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE webhook_updates SET status='unknown' WHERE id=?",
      )
        .bind(String(update.update_id))
        .run();
    }
  } else if (command === "/stop") {
    await env.DB.prepare(
      "UPDATE telegram_profiles SET notifications=0,updated_at=? WHERE id=?",
    )
      .bind(Date.now() / 1000, id)
      .run();
    try {
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text: "Сповіщення вимкнено.",
      });
    } catch {}
  }
  return json({ ok: true });
}
export async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/catalog" && request.method === "GET")
      return json(catalog);
    if (path === "/api/health" && request.method === "GET") {
      await runtime().DB.prepare("SELECT 1").first();
      return json({
        status: "ok",
        hosting: "sites",
        bot_configured: !!runtime().BOT_TOKEN,
        notifications_ready: remindersReady(),
      });
    }
    if (path === "/api/telegram/webhook" && request.method === "POST")
      return await webhook(request);
    if (path === "/api/internal/reminders" && request.method === "POST") {
      if (!await authorizedJob(request.headers.get("authorization"),runtime().REMINDER_JOB_SECRET))
        throw new ApiError(401,"Unauthorized job");
      const body = await request.json().catch(()=>({}));
      if (body && typeof body === "object" && "dry_run" in body && body.dry_run === true) return json({bot_configured:!!runtime().BOT_TOKEN,enabled:remindersReady(),heartbeat:await runtime().DB.prepare("SELECT checked_at FROM source_leases WHERE key='reminder-heartbeat'").first()});
      if (!remindersReady()) throw new ApiError(503,"Reminder scheduler is not enabled");
      return json(await dispatchReminders({db:runtime().DB,schedule:getSchedule,send:(chat_id,text)=>telegram("sendMessage",{chat_id,text,link_preview_options:{is_disabled:true}})}));
    }
    const p = await preferences(request);
    if (path === "/api/bootstrap" && request.method === "GET")
      return json({profile:publicProfile(p),schedule:await getSchedule(p)});
    if (path === "/api/me" && request.method === "GET")
      return json(publicProfile(p));
    if (path === "/api/me" && request.method === "PUT") {
      const body = selection(await request.json());
      if (body.notifications && (!p.id || !p.bot_started || !remindersReady()))
        throw new ApiError(409, "Відкрийте застосунок через бота та натисніть /start.");
      if (body.notifications && (!body.queue || operators.get(body.operator)?.adapter === "unsupported"))
        throw new ApiError(409, "Оберіть підтримуваного оператора та чергу.");
      if (p.id)
        await runtime()
          .DB.prepare(
            "UPDATE telegram_profiles SET region=?,operator=?,queue=?,language=?,notifications=?,updated_at=? WHERE id=?",
          )
          .bind(
            body.region,
            body.operator,
            body.queue,
            body.language,
            body.notifications ? 1 : 0,
            Date.now() / 1000,
            p.id,
          )
          .run();
      return json(publicProfile({ ...p, ...body }));
    }
    if (path === "/api/schedule" && request.method === "GET")
      return json(await getSchedule(p));
    if (path === "/api/refresh" && request.method === "POST") {
      await getSchedule(p);
      return json(
        {
          queued: true,
          message:
            "Перевірено доступні дані. Запити до джерела обмежені одним разом на 5 хвилин.",
        },
        202,
      );
    }
    return json({ detail: "Not found" }, 404);
  } catch (error) {
    if (error instanceof ApiError)
      return json({ detail: error.message }, error.status);
    console.error(
      "Svitlo API error:",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { detail: "Сервіс тимчасово недоступний. Спробуйте пізніше." },
      503,
    );
  }
}

export async function reminderMcp(request: Request): Promise<Response> {
  const rpc = await request.json() as {id?: unknown; method?: string; params?: {name?:string;arguments?:{dry_run?:boolean}}};
  const reply = (result:unknown) => json({jsonrpc:"2.0",id:rpc.id ?? null,result});
  if (rpc.method === "server/discover") return reply({supportedVersions:["2026-07-28"],capabilities:{tools:{}}});
  if (rpc.method === "initialize") return reply({protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"svitlo-reminders",version:"1.0.0"}});
  if (rpc.method?.startsWith("notifications/")) return new Response(null,{status:202});
  if (rpc.method === "tools/list") return reply({tools:[{name:"dispatch_outage_reminders",description:"Check official outage schedules and send due Telegram reminders to users who opted in. Owner only. dry_run returns readiness without sending.",inputSchema:{type:"object",properties:{dry_run:{type:"boolean"}},additionalProperties:false}}]});
  if (rpc.method !== "tools/call" || rpc.params?.name !== "dispatch_outage_reminders") return json({jsonrpc:"2.0",id:rpc.id??null,error:{code:-32601,message:"Unknown method"}});
  const email = request.headers.get("oai-authenticated-user-email");
  if (!runtime().REMINDER_OWNER_EMAIL || email !== runtime().REMINDER_OWNER_EMAIL) return reply({isError:true,content:[{type:"text",text:"Owner authorization required"}]});
  try {
    if (rpc.params.arguments?.dry_run) {
      const heartbeat = await runtime().DB.prepare("SELECT checked_at FROM source_leases WHERE key='reminder-heartbeat'").first();
      return reply({content:[{type:"text",text:JSON.stringify({bot_configured:!!runtime().BOT_TOKEN,enabled:remindersReady(),heartbeat})}]});
    }
    const result = await dispatchReminders({db:runtime().DB,schedule: getSchedule,send:(chat_id,text)=>telegram("sendMessage",{chat_id,text,link_preview_options:{is_disabled:true}})});
    return reply({content:[{type:"text",text:JSON.stringify(result)}]});
  } catch { return reply({isError:true,content:[{type:"text",text:"Reminder check failed; retry on next run"}]}); }
}
