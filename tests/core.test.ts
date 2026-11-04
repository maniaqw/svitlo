import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { authorizedJob, dueReminders, dispatchReminders } from "../lib/svitlo/reminders";
import { presentSnapshot } from "../lib/svitlo/snapshots";
import { fetchSource } from "../lib/svitlo/source";
import { parseDtek, assignedJson } from "../lib/svitlo/dtek";
import liveDtek from "./fixtures/dtek-dnipro-2026-11-03.json";
import {
  authenticate,
  bounds,
  civil,
  defaultSelection,
  localDate,
  parsePrykarpattya,
  parsePoltava,
  selection,
} from "../lib/svitlo/core";

const dtekSelection = {
  ...defaultSelection,
  region: "dnipro",
  operator: "dtek-dnipro",
  queue: "1.1",
};
test("scheduled writer rejects missing and incorrect credentials",async()=>{
  assert.equal(await authorizedJob(null,"test-only-secret"),false);
  assert.equal(await authorizedJob("Bearer test-only-secret",undefined),false);
  assert.equal(await authorizedJob("Bearer wrong","test-only-secret"),false);
  assert.equal(await authorizedJob("Bearer test-only-secret","test-only-secret"),true);
});
test("source failure preserves only the last same-day published graph as visibly unverified",()=>{
  const now=civil("2026-11-04","10:00");
  const payload={...bounds("2026-11-04"),operator_id:dtekSelection.operator,queue:"1.1",date:"2026-11-04",status:"published",intervals:[{state:"planned",start:now+1800,end:now+3600}],source_url:"https://example.org",last_success:now,last_attempt:now,stale:false,version:1};
  const row={payload:JSON.stringify(payload),fetched_at:now-60,attempted_at:now,error:"Source unavailable",version:1};
  const saved=presentSnapshot(row,"2026-11-04",dtekSelection,now);
  assert.equal(saved.status,"cached");assert.equal(saved.stale,true);
  assert.equal(saved.intervals.length,1);
  assert.equal(dueReminders(dtekSelection,[saved],now).length,0);
  const expired=presentSnapshot({...row,error:null,fetched_at:now-901},"2026-11-04",dtekSelection,now);
  assert.equal(expired.status,"cached");assert.equal(expired.stale,true);
  assert.equal(presentSnapshot(row,"2026-11-05",dtekSelection,now).intervals.length,0);
  assert.equal(presentSnapshot({...row,error:null},"2026-11-04",dtekSelection,now).status,"published");
});
test("reminders use fresh confirmed intervals, Kyiv times and merged midnight event IDs", () => {
  const now = civil("2026-11-04", "23:30");
  const day = {...bounds("2026-11-04"),operator_id:dtekSelection.operator,queue:"1.1",date:"2026-11-04",status:"published",intervals:[{state:"planned",start:now+1800,end:now+3600,event_start:now+1800,event_end:now+7200}],source_url:"https://example.org",last_success:now,last_attempt:now,stale:false,version:1};
  assert.equal(dueReminders(dtekSelection,[day,day],now).length,1);
  assert.match(dueReminders(dtekSelection,[day],now)[0].text,/00:00/);
  for (const changed of [{...day,stale:true},{...day,status:"unpublished"},{...day,last_success:now-901},{...day,intervals:[{state:"possible",start:now+1800,end:now+3600}]}]) assert.equal(dueReminders(dtekSelection,[changed],now).length,0);
  assert.equal(dueReminders(dtekSelection,[day],now+1800).length,0);
});
test("dispatcher persists deduplication, respects opt-out and never retries ambiguous delivery", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE source_leases(key TEXT PRIMARY KEY,checked_at REAL); CREATE TABLE telegram_profiles(id TEXT PRIMARY KEY,region TEXT,operator TEXT,queue TEXT,language TEXT,notifications INTEGER,bot_started INTEGER,chat_id TEXT)");
  sql.prepare("INSERT INTO telegram_profiles VALUES (?,?,?,?,?,1,1,?)").run("u",dtekSelection.region,dtekSelection.operator,"1.1","uk","chat");
  const db = {prepare(query:string){let args:unknown[]=[];const statement=sql.prepare(query);const api={bind(...values:unknown[]){args=values;return api},async first(){return statement.get(...args as never[])??null},async all(){return {results:statement.all(...args as never[])}},async run(){return statement.run(...args as never[])}};return api}} as unknown as D1Database;
  const now=civil("2026-11-04","10:00");
  const day={...bounds("2026-11-04"),operator_id:dtekSelection.operator,queue:"1.1",date:"2026-11-04",status:"published",intervals:[{state:"planned",start:now+1800,end:now+3600}],source_url:"https://example.org",last_success:now,last_attempt:now,stale:false,version:1};
  let calls=0;
  const deps={db,schedule:async()=>({days:[day]}),send:async()=>{calls++;throw new Error("timeout")},now};
  assert.equal((await dispatchReminders(deps)).failed,1);
  await dispatchReminders({...deps,now:now+300});
  assert.equal(calls,1);
  sql.prepare("UPDATE telegram_profiles SET notifications=0").run();
  sql.prepare("INSERT INTO source_leases(key,checked_at) VALUES (?,?)").run("dtek-dnipro:4.2",now);
  const background = await dispatchReminders({...deps,now:now+600});
  assert.equal(background.checked,0);
  assert.equal(background.refreshed,1);
  sql.close();
});
test("source follows a normal same-origin cookie redirect without running a challenge", async () => {
  let calls = 0;
  const mock = (async (url: string, init: RequestInit) => {
    calls++;
    if (calls === 1)
      return new Response(null, {
        status: 302,
        headers: {
          Location: url,
          "Set-Cookie": "anonymous_session=value; Path=/; Secure; HttpOnly",
        },
      });
    assert.equal(
      (init.headers as Record<string, string>).Cookie,
      "anonymous_session=value",
    );
    return new Response("public source table");
  }) as typeof fetch;
  assert.equal(
    await fetchSource("https://www.dtek-dnem.com.ua/ua/shutdowns", mock),
    "public source table",
  );
  assert.equal(calls, 2);
});
test("source redirects are bounded and never forward cookies to another origin", async () => {
  let calls = 0;
  const loop = (async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { Location: "/ua/shutdowns" },
    });
  }) as typeof fetch;
  await assert.rejects(
    () => fetchSource("https://www.dtek-dnem.com.ua/ua/shutdowns", loop),
    /limit/,
  );
  assert.equal(calls, 4);
  const external = (async () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: "https://example.com/",
        "Set-Cookie": "session=secret",
      },
    })) as typeof fetch;
  await assert.rejects(
    () => fetchSource("https://www.dtek-dnem.com.ua/ua/shutdowns", external),
    /origin/,
  );
});
function dtekHtml(
  fact: unknown = liveDtek.fact,
  preset: unknown = liveDtek.preset,
) {
  return `<script>DisconSchedule.preset = ${JSON.stringify(preset)}; DisconSchedule.fact = ${JSON.stringify(fact)};</script>`;
}
test("DTEK real captured graph: 1.1 is off 06:00–08:30 and 15:00–19:00", () => {
  const [today, tomorrow] = parseDtek(dtekHtml(), dtekSelection, [
    "2026-11-03",
    "2026-11-04",
  ]);
  assert.equal(today.status, "published");
  assert.equal(today.published_at, "03.11.2026 18:36");
  assert.deepEqual(
    today.intervals
      .filter((i) => i.state === "planned")
      .map((i) => [i.start, i.end]),
    [
      [civil("2026-11-03", "06:00"), civil("2026-11-03", "08:30")],
      [civil("2026-11-03", "15:00"), civil("2026-11-03", "19:00")],
    ],
  );
  assert.equal(tomorrow.status, "unpublished");
  assert.deepEqual(tomorrow.intervals, []);
});
test("DTEK all 12 official subqueues normalize to the full day", () => {
  for (let q = 1; q <= 6; q++)
    for (let sub = 1; sub <= 2; sub++) {
      const [day] = parseDtek(
        dtekHtml(),
        { ...dtekSelection, queue: `${q}.${sub}` },
        ["2026-11-03"],
      );
      assert.equal(
        day.intervals.reduce((n, i) => n + i.end - i.start, 0),
        86400,
      );
      assert.equal(day.intervals[0].start, day.day_start);
      assert.equal(day.intervals.at(-1)!.end, day.day_end);
    }
});
test("DTEK half-hour and possible states have distinct meanings", () => {
  const fact = structuredClone(liveDtek.fact),
    row = fact.data["1793656800"]["GPV1.1"] as Record<string, string>;
  for (const k of Object.keys(row)) row[k] = "yes";
  Object.assign(row, {
    "1": "first",
    "2": "second",
    "3": "maybe",
    "4": "mfirst",
    "5": "msecond",
  });
  const [day] = parseDtek(dtekHtml(fact), dtekSelection, ["2026-11-03"]);
  const stateAt = (clock: string) =>
    day.intervals.find(
      (i) =>
        i.start <= civil(day.date, clock) && i.end > civil(day.date, clock),
    )?.state;
  for (const [clock, state] of [
    ["00:15", "planned"],
    ["00:45", "on"],
    ["01:15", "on"],
    ["01:45", "planned"],
    ["02:15", "possible"],
    ["03:15", "possible"],
    ["03:45", "on"],
    ["04:15", "on"],
    ["04:45", "possible"],
  ])
    assert.equal(stateAt(clock), state);
});
test("DTEK unknown values, absent JSON and disabled daily graphs fail closed", () => {
  assert.throws(
    () =>
      parseDtek(
        '<html><script src="/_Incapsula_Resource"></script></html>',
        dtekSelection,
        ["2026-11-03"],
      ),
    /access restricted/,
  );
  assert.equal(selection({ ...dtekSelection, queue: "" }).region, "dnipro");
  assert.throws(() =>
    parseDtek("<html>Access denied</html>", dtekSelection, ["2026-11-03"]),
  );
  const fact = structuredClone(liveDtek.fact);
  fact.data["1793656800"]["GPV1.1"]["1"] = "changed-schema";
  assert.throws(() => parseDtek(dtekHtml(fact), dtekSelection, ["2026-11-03"]));
  assert.equal(
    parseDtek(
      dtekHtml() + "DisconSchedule.showTableFact = false",
      dtekSelection,
      ["2026-11-03"],
    )[0].status,
    "unavailable",
  );
  assert.deepEqual(
    assignedJson(
      'DisconSchedule.fact = {"text":"a } \\"quoted\\"","data":{}};',
      "fact",
    ).data,
    {},
  );
});
test("DTEK overnight outage keeps one event boundary across two days", () => {
  const fact = structuredClone(liveDtek.fact) as unknown as {
    data: Record<string, Record<string, Record<string, string>>>;
  };
  const today = fact.data["1793656800"]["GPV1.1"];
  for (const h of Object.keys(today)) today[h] = "yes";
  today["24"] = "no";
  const tomorrow = structuredClone(today);
  tomorrow["24"] = "yes";
  tomorrow["1"] = "no";
  fact.data[String(civil("2026-11-04", "00:00"))] = { "GPV1.1": tomorrow };
  const [a, b] = parseDtek(dtekHtml(fact), dtekSelection, [
    "2026-11-03",
    "2026-11-04",
  ]);
  assert.equal(a.intervals.at(-1)!.event_end, civil("2026-11-04", "01:00"));
  assert.equal(b.intervals[0].event_start, civil("2026-11-03", "23:00"));
});

test("all 25 region selections are validated", () => {
  assert.throws(() => selection({ ...defaultSelection, region: "lviv" }));
  assert.throws(() => selection({ ...defaultSelection, queue: "99" }));
  assert.equal(
    selection({
      ...defaultSelection,
      region: "lviv",
      operator: "lviv",
      queue: "",
    }).operator,
    "lviv",
  );
});
test("Kyiv rollover and DST day lengths", () => {
  assert.equal(localDate(Date.parse("2026-11-03T22:10:00Z")), "2026-11-04");
  for (const [day, hours] of [
    ["2026-03-29", 23],
    ["2026-10-25", 25],
    ["2026-11-03", 24],
  ] as const) {
    const b = bounds(day);
    assert.equal(b.day_end - b.day_start, hours * 3600);
  }
  assert.throws(() => civil("2026-10-25", "03:30"));
  assert.throws(() => civil("2026-03-29", "03:30"));
});
test("published empty, unpublished and missing queue are distinct", () => {
  const [today, tomorrow] = parsePrykarpattya(
    [{ eventDate: "03.11.2026", queues: { "1.1": [] } }],
    defaultSelection,
    ["2026-11-03", "2026-11-04"],
  );
  assert.equal(today.status, "published");
  assert.equal(today.intervals[0].state, "on");
  assert.equal(tomorrow.status, "unpublished");
  assert.deepEqual(tomorrow.intervals, []);
  assert.equal(
    parsePrykarpattya(
      [{ eventDate: "03.11.2026", queues: {} }],
      defaultSelection,
      ["2026-11-03"],
    )[0].status,
    "unpublished",
  );
});
test("overnight preserves the real event start and end", () => {
  const [today, tomorrow] = parsePrykarpattya(
    [
      {
        eventDate: "03.11.2026",
        queues: { "1.1": [{ from: "23:00", to: "02:00" }] },
      },
      { eventDate: "04.11.2026", queues: { "1.1": [] } },
    ],
    defaultSelection,
    ["2026-11-03", "2026-11-04"],
  );
  const last = today.intervals.at(-1)!,
    first = tomorrow.intervals[0];
  assert.equal(last.event_start, first.event_start);
  assert.equal(last.event_end, first.event_end);
  assert.equal(last.end, first.start);
});
test("malformed provider schema and overlaps fail closed", () => {
  assert.throws(() => parsePrykarpattya({}, defaultSelection, ["2026-11-03"]));
  assert.throws(() =>
    parsePrykarpattya(
      [
        {
          eventDate: "03.11.2026",
          queues: {
            "1.1": [
              { from: "16:00", to: "19:00" },
              { from: "18:00", to: "20:00" },
            ],
          },
        },
      ],
      defaultSelection,
      ["2026-11-03"],
    ),
  );
});
test("seasonal PDFs are never converted into daily intervals", () => {
  const [day] = parsePoltava(
    '<a href="/HPV_26_27.pdf">Season</a>',
    { ...defaultSelection, operator: "poltava", region: "poltava", queue: "" },
    ["2026-11-03"],
  );
  assert.equal(day.status, "unsupported");
  assert.deepEqual(day.intervals, []);
});
function signed() {
  const p = {
      auth_date: "1000",
      query_id: "test",
      user: JSON.stringify({ id: 42, first_name: "Тест" }),
    },
    check = Object.entries(p)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123:secret")
    .digest();
  return new URLSearchParams({
    ...p,
    hash: createHmac("sha256", secret).update(check).digest("hex"),
  }).toString();
}
test("Telegram signature, expiration, tampering and duplicates", async () => {
  assert.equal(await authenticate(signed(), "123:secret", 1001), "42");
  await assert.rejects(() => authenticate(signed(), "wrong", 1001));
  await assert.rejects(() => authenticate(signed(), "123:secret", 5000));
  await assert.rejects(() =>
    authenticate(signed() + "&user=forged", "123:secret", 1001),
  );
});
