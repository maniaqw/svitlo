import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Home,
  Info,
  MapPin,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { api, saveProfile, WebApp } from "./api";
import { translations } from "./i18n";
import { currentAndNext, dateLabel, duration, time } from "./time";
import type { Day, Interval, Profile, Region, Schedule, State } from "./types";
import LaunchScreen from "./LaunchScreen";
import catalogData from "../../lib/svitlo/catalog.json";

type Tab = "home" | "schedule" | "notifications" | "settings";
const initial: Profile = {
  region: "ivano-frankivsk",
  operator: "prykarpattya",
  queue: "1.1",
  language: "uk",
  notifications: false,
  bot_started: false,
  bot_username: "",
  dev: false,
  demo: false,
};
const labels: Record<
  State,
  "on" | "planned" | "possible" | "unknown" | "emergency" | "urgent"
> = {
  on: "on",
  planned: "planned",
  possible: "possible",
  unknown: "unknown",
  emergency: "emergency",
  urgent: "urgent",
};

export default function App() {
  const [profile, setProfile] = useState(initial);
  const regions: Region[] = catalogData.regions;
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [dayIndex, setDayIndex] = useState(0);
  const [selected, setSelected] = useState<Interval | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(Date.now() / 1000);
  const [theme, setTheme] = useState(
    localStorage.getItem("svitlo-theme") || "system",
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const serverOffset = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const t = translations[profile.language];
  const region = regions.find((r) => r.id === profile.region);
  const operator = region?.operators.find((o) => o.id === profile.operator);
  const draftRegion = regions.find((r) => r.id === draft.region);
  const draftOperator = draftRegion?.operators.find(
    (o) => o.id === draft.operator,
  );
  const day = schedule?.days[dayIndex];
  const today = schedule?.days[0];
  const verified = today?.status === "published" && !today.stale;
  const { current, next } = currentAndNext(
    schedule
      ? schedule.days
          .filter((d) => d.status === "published" && !d.stale)
          .flatMap((d) => d.intervals)
      : [],
    now,
  );
  const state: State = verified ? current?.state || "unknown" : "unknown";
  const countdown = next
    ? Math.max(0, Math.floor((next.event_start ?? next.start) - now))
    : null;

  const load = useCallback(async (boot = false) => {
    const id = ++generation.current;
    pending.current?.abort();
    const controller=new AbortController();
    pending.current=controller;
    if (boot) setLoading(true);
    try {
      const {profile:p,schedule:s} = await api<{profile:Profile;schedule:Schedule}>("/bootstrap",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
      if (id !== generation.current) return;
      setProfile(p);
      setSchedule(s);
      setAuthenticated(true);
      setError("");
      serverOffset.current = s.server_time - Date.now() / 1000;
    } catch (e) {
      if (controller.signal.aborted) return;
      if (id === generation.current) {
        setError((e as Error).message);
        setSchedule(previous => previous ? {
          ...previous,
          days: previous.days.map(day => day.status === "published" ? {
            ...day,status:"cached",stale:true,
            message:"Не вдалося оновити дані. Показано останній збережений графік; перевірте офіційне джерело.",
          } : day),
        } : null);
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(true);
    const tick = window.setInterval(
      () => setNow(Date.now() / 1000 + serverOffset.current),
      1000,
    );
    const poll = window.setInterval(() => void load(), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      generation.current++;
      pending.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system"
          ? WebApp.initData
            ? WebApp.colorScheme
            : "dark"
          : theme;
    };
    apply();
    WebApp.onEvent("themeChanged", apply);
    localStorage.setItem("svitlo-theme", theme);
    return () => WebApp.offEvent("themeChanged", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = profile.language;
  }, [profile.language]);
  useEffect(() => {
    if (WebApp.initData) {
      WebApp.ready();
      WebApp.expand();
      const sync = () => {
        document.documentElement.style.setProperty(
          "--tg-bottom",
          `${WebApp.contentSafeAreaInset?.bottom || 0}px`,
        );
        document.documentElement.style.setProperty(
          "--tg-top",
          `${WebApp.contentSafeAreaInset?.top || 0}px`,
        );
      };
      sync();
      WebApp.onEvent("contentSafeAreaChanged", sync);
      return () => WebApp.offEvent("contentSafeAreaChanged", sync);
    }
  }, []);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  useEffect(() => {
    setSelected(null);
  }, [dayIndex, schedule]);
  useEffect(() => {
    if (!WebApp.initData) return;
    const back = () => setTab("home");
    if (tab === "home") WebApp.BackButton.hide();
    else WebApp.BackButton.show();
    WebApp.BackButton.onClick(back);
    return () => {
      WebApp.BackButton.offClick(back);
    };
  }, [tab]);

  function navigate(value: Tab) {
    setTab(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (WebApp.initData) WebApp.HapticFeedback.selectionChanged();
  }
  function openEditor() {
    setDraft(profile);
    setSearch("");
    setEditing(true);
  }
  async function persist(value: Profile, close = false) {
    setBusy(true);
    try {
      const p = await saveProfile(value);
      setProfile(p);
      setSchedule(null);
      if (close) setEditing(false);
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/refresh", {
        method: "POST",
      });
      setToast(result.message);
      await load();
      window.setTimeout(() => void load(), 4000);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openBot() {
    if (profile.bot_username) {
      const url = `https://t.me/${profile.bot_username}`;
      if (WebApp.initData) WebApp.openTelegramLink(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } else setToast("BOT_USERNAME не налаштовано");
  }
  const navItems = [
    { key: "home" as const, icon: Home },
    { key: "schedule" as const, icon: CalendarDays },
    { key: "notifications" as const, icon: Bell },
    { key: "settings" as const, icon: Settings2 },
  ];
  const alerts =
    !profile.bot_configured ||
    (profile.bot_started && !profile.notifications_ready) ? (
      <section className="glass alerts-card">
        <div className="icon-tile purple">
          <BellRing size={23} />
        </div>
        <div className="eyebrow">TELEGRAM BOT</div>
        <h2>{t.stayInformed}</h2>
        <p>
          {profile.language === "uk"
            ? "Графіки вже доступні. Підключення Telegram-бота та нагадувань ще готується."
            : "Графики уже доступны. Подключение Telegram-бота и напоминаний ещё готовится."}
        </p>
        <button className="secondary pending-button" disabled>
          <Clock3 size={16} />
          {profile.language === "uk" ? "Незабаром" : "Скоро"}
        </button>
      </section>
    ) : (
      <section className="glass alerts-card">
        <div className="icon-tile purple">
          <BellRing size={23} />
        </div>
        <div className="eyebrow">TELEGRAM BOT</div>
        <h2>{t.stayInformed}</h2>
        <p>{t.alertsSub}</p>
        {!profile.bot_started ? (
          <>
            <button
              className="primary"
              onClick={openBot}
              disabled={!authenticated}
            >
              <Bell size={16} />
              {t.openBot}
              <ArrowUpRight size={16} />
            </button>
            <p className="small">{t.botHint}</p>
            <button className="text-button" onClick={() => void load()}>
              {t.check}
              <RefreshCw size={13} />
            </button>
          </>
        ) : (
          <>
            <button
              className={profile.notifications ? "enabled-button" : "primary"}
              disabled={busy || !authenticated || profile.demo}
              onClick={() =>
                void persist({
                  ...profile,
                  notifications: !profile.notifications,
                })
              }
            >
              {profile.notifications ? <Check size={17} /> : <Bell size={17} />}{" "}
              {profile.notifications ? t.enabled : t.enable}
            </button>
            {profile.notifications && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void persist({ ...profile, notifications: false })
                }
              >
                {t.disable}
              </button>
            )}
          </>
        )}
      </section>
    );

  if (loading || !schedule) return <LaunchScreen error={loading?undefined:error} retry={()=>void load(true)}/>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <span className="brand-mark">
            <Zap size={24} fill="currentColor" />
          </span>
          світло<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-caption">{t.tagline}</div>
        <nav>
          {navItems.map(({ key, icon: Icon }) => (
            <button
              key={key}
              className={tab === key ? "nav-item active" : "nav-item"}
              onClick={() => navigate(key)}
            >
              <Icon size={20} />
              <span>{t[key]}</span>
              {tab === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-orbit">
            <Zap size={20} />
          </div>
          <p>
            {t.footer}
            <span>
              Зроблено для України <span className="flag" />
            </span>
          </p>
          <div className="version">
            СВІТЛО MINI APP <span>v1.0</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="mobile-brand">
            <Zap size={20} fill="currentColor" /> світло.
          </span>
          <span className="top-breadcrumb">
            {t[tab]} <ChevronRight size={13} /> <span>Mini App</span>
          </span>
          <div className="top-right">
            <span className="timezone">
              <Clock3 size={13} /> Europe/Kyiv
            </span>
            <button
              className="avatar"
              aria-label={t.settings}
              onClick={() => navigate("settings")}
            >
              {WebApp.initDataUnsafe.user?.first_name?.slice(0, 1) || "С"}
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="intro-kicker">
                <span />
                {t.greeting}
              </div>
              <h1>{tab === "home" ? t.title : t[tab]}</h1>
              <p>
                {tab === "home"
                  ? t.subtitle
                  : tab === "schedule"
                    ? t.localTime
                    : tab === "notifications"
                      ? t.alertsSub
                      : t.tagline}
              </p>
            </div>
            <div className="date-chip">
              <CalendarDays size={16} />
              {new Intl.DateTimeFormat(
                profile.language === "uk" ? "uk-UA" : "ru-RU",
                {
                  timeZone: "Europe/Kyiv",
                  day: "numeric",
                  month: "long",
                  weekday: "short",
                },
              ).format(new Date(now * 1000))}
            </div>
          </div>
          {profile.demo ? (
            <div className="banner demo">
              <Info size={18} />
              {t.demo}
            </div>
          ) : (
            profile.dev && <div className="dev-label">{t.dev}</div>
          )}
          {error && (
            <div className="banner" role="alert">
              <Info size={20} />
              <div>
                <strong>{t.error}</strong>
                <p>{error}</p>
                {!WebApp.initData && <p>{t.telegram}</p>}
              </div>
              <button onClick={() => void load(true)}>{t.retry}</button>
            </div>
          )}
          <section className="glass location-card">
            <div className="location-icon">
              <MapPin size={24} />
            </div>
            <div className="location-text">
              <div className="eyebrow">{t.location}</div>
              <h3>{region?.name || "Івано-Франківська область"}</h3>
              <p>
                {operator?.name || "Прикарпаттяобленерго"}
                <span className="location-separator">·</span>
                <span>
                  {t.queue} {profile.queue || "—"}
                </span>
              </p>
            </div>
            <button
              className="secondary change-button"
              disabled={!authenticated || busy}
              onClick={openEditor}
            >
              {t.change}
              <ChevronDown size={15} />
            </button>
          </section>
          {loading ? (
            <div className="skeleton-layout" aria-label={t.loading}>
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton wide" />
            </div>
          ) : (
            <>
              {(tab === "home" || tab === "schedule") && (
                <div className="dashboard">
                  <div className="main-column">
                    {tab === "home" && (
                      <section className={`glass status-card state-${state}`}>
                        <div className="status-copy">
                          <div className="eyebrow">
                            <span className={`status-dot ${state}`} />
                            {t.status}
                          </div>
                          <h2>{t[labels[state]]}</h2>
                          <p>
                            {state === "on"
                              ? t.onSub
                              : state === "unknown"
                                ? t.unknownSub
                                : t.reliableSub}
                          </p>
                          <div className="status-tag">
                            <ShieldCheck size={13} />
                            {t.source}
                          </div>
                        </div>
                        <div className="power-orbit" aria-hidden="true">
                          <div className="orbit-ring orbit-one" />
                          <div className="orbit-ring orbit-two" />
                          <div className="orbit-ring orbit-three" />
                          <div className="power-core">
                            {state === "on" ? (
                              <Zap size={36} fill="currentColor" />
                            ) : state === "planned" ? (
                              <ZapOff size={36} />
                            ) : (
                              <CircleHelp size={36} />
                            )}
                          </div>
                          <span className="orbit-spark s1" />
                          <span className="orbit-spark s2" />
                        </div>
                      </section>
                    )}
                    {tab === "home" && (
                      <section className="glass next-card">
                        <div className="next-top">
                          <span className="eyebrow">
                            <Clock3 size={15} />
                            {t.next}
                          </span>
                          <span className="subtle">{t.until}</span>
                        </div>
                        <div className="next-main">
                          <div className="outage-time">
                            {next
                              ? time(next.event_start ?? next.start)
                              : "— — : — —"}
                            <span>
                              {next
                                ? `${t.restore} ${time(next.event_end ?? next.end)}`
                                : t.noNext}
                            </span>
                          </div>
                          <div className="countdown">
                            {countdown !== null ? (
                              <>
                                {String(Math.floor(countdown / 3600)).padStart(
                                  2,
                                  "0",
                                )}
                                <b>:</b>
                                {String(
                                  Math.floor((countdown % 3600) / 60),
                                ).padStart(2, "0")}
                                <b>:</b>
                                {String(countdown % 60).padStart(2, "0")}
                              </>
                            ) : (
                              "— : — : —"
                            )}
                            <small>{t.countdown}</small>
                          </div>
                        </div>
                      </section>
                    )}
                    <section className="glass schedule-card">
                      <div className="section-title">
                        <h2>
                          <CalendarDays size={19} />
                          {t.daySchedule}
                        </h2>
                        <button
                          className="icon-button"
                          aria-label={t.refresh}
                          disabled={busy || !authenticated}
                          onClick={() => void refresh()}
                        >
                          <RefreshCw size={17} className={busy ? "spin" : ""} />
                        </button>
                      </div>
                      <div className="schedule-controls">
                        <div className="segmented">
                          {[t.today, t.tomorrow].map((label, index) => (
                            <button
                              key={index}
                              className={dayIndex === index ? "selected" : ""}
                              onClick={() => setDayIndex(index)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span>
                          {day ? dateLabel(day.date, profile.language) : "—"}
                        </span>
                      </div>
                      <Timeline
                        day={day}
                        now={now}
                        selected={selected}
                        onSelect={setSelected}
                        language={profile.language}
                      />
                      {day?.status !== "published" && (
                        <div className="empty-schedule">
                          <div className="empty-icon">
                            <CalendarDays size={23} />
                          </div>
                          <h3>
                            {day?.status === "cached"
                              ? profile.language === "uk" ? "Збережений графік — потребує перевірки" : "Сохранённый график — требует проверки"
                              : day?.status === "selection_required"
                              ? profile.language === "uk"
                                ? "Оберіть вашу чергу"
                                : "Выберите вашу очередь"
                              : day?.status === "unpublished"
                                ? t.unpublished
                                : day?.status === "unsupported"
                                  ? t.unsupported
                                  : t.unavailable}
                          </h3>
                          <p>{day?.status === "cached" && profile.language === "ru" ? "Источник временно не обновляется. Это последний сохранённый график; он мог измениться. Проверьте официальный сайт." : day?.message || t.unknownSub}</p>
                          {day?.status === "selection_required" && (
                            <button className="secondary" onClick={openEditor}>
                              {profile.language === "uk"
                                ? "Обрати чергу"
                                : "Выбрать очередь"}
                            </button>
                          )}
                        </div>
                      )}
                      {selected && (
                        <div className="interval-detail" role="status">
                          <span className={`status-dot ${selected.state}`} />
                          <div>
                            <strong>
                              {time(selected.start)} — {time(selected.end)}
                            </strong>
                            <span>
                              {t[labels[selected.state]]} · {t.duration}:{" "}
                              {duration(selected.end - selected.start)}
                            </span>
                          </div>
                          <button
                            className="icon-button"
                            aria-label={t.cancel}
                            onClick={() => setSelected(null)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}
                      <div className="legend">
                        {(
                          ["on", "planned", "possible", "unknown"] as State[]
                        ).map((s, index) => (
                          <span key={s}>
                            <i className={`status-dot ${s}`} />
                            {[t.power, t.off, t.maybe, t.noData][index]}
                          </span>
                        ))}
                      </div>
                      <div className="schedule-foot">
                        <span>
                          <Clock3 size={12} />
                          {t.localTime}
                        </span>
                        <span>{t.tap}</span>
                      </div>
                    </section>
                    <section className="glass interval-list">
                      <div className="section-title">
                        <h2>{t.intervals}</h2>
                        <span className="count-badge">
                          {day?.intervals.filter((i) => i.state === "planned")
                            .length || 0}
                        </span>
                      </div>
                      {(day?.status === "published" || day?.status === "cached") &&
                      day.intervals.some((i) => i.state === "planned") ? (
                        day.intervals
                          .filter((i) => i.state === "planned")
                          .map((i) => (
                            <button
                              className="interval-row"
                              key={i.start}
                              onClick={() => setSelected(i)}
                            >
                              <span className="row-icon">
                                <ZapOff size={17} />
                              </span>
                              <span>
                                <strong>
                                  {time(i.start)} — {time(i.end)}
                                </strong>
                                <small>{day.stale ? profile.language === "uk" ? "Збережено · не підтверджено" : "Сохранено · не подтверждено" : t.planned}</small>
                              </span>
                              <span className="interval-duration">
                                {duration(i.end - i.start)}{" "}
                                <ChevronRight size={15} />
                              </span>
                            </button>
                          ))
                      ) : (
                        <p className="empty-row">
                          {day?.status === "published"
                            ? t.noIntervals
                            : t.unknown}
                        </p>
                      )}
                    </section>
                  </div>
                  <aside className="right-column">
                    {alerts}
                    <SourceCard
                      day={day}
                      operator={operator?.name}
                      language={profile.language}
                    />
                    <section className="note-card">
                      <ShieldCheck size={20} />
                      <div>
                        <h3>{t.reliable}</h3>
                        <p>{t.reliableSub}</p>
                      </div>
                    </section>
                  </aside>
                </div>
              )}
              {tab === "notifications" && (
                <div className="settings-grid">
                  {alerts}
                  <section className="glass info-panel">
                    <div className="icon-tile cyan">
                      <Clock3 size={24} />
                    </div>
                    <h2>
                      30{" "}
                      {profile.language === "uk"
                        ? "хвилин до відключення"
                        : "минут до отключения"}
                    </h2>
                    <p>{t.reliableSub}</p>
                    <div className="info-line">
                      <Check size={17} />
                      {profile.language === "uk"
                        ? "Сповіщення поки не активовано"
                        : "Уведомления пока не активированы"}
                    </div>
                    <div className="info-line">
                      <RefreshCw size={17} />
                      {profile.language === "uk"
                        ? "Офіційні графіки вже доступні"
                        : "Официальные графики уже доступны"}
                    </div>
                    <div className="info-line">
                      <ShieldCheck size={17} />
                      {profile.language === "uk"
                        ? "Підключення бота готується"
                        : "Подключение бота готовится"}
                    </div>
                  </section>
                </div>
              )}
              {tab === "settings" && (
                <div className="settings-grid">
                  <section className="glass settings-panel">
                    <h2>
                      <Settings2 size={20} />
                      {t.settings}
                    </h2>
                    <label>
                      {t.language}
                      <select
                        value={profile.language}
                        disabled={!authenticated || busy}
                        onChange={(e) =>
                          void persist({
                            ...profile,
                            language: e.target.value as "uk" | "ru",
                          })
                        }
                      >
                        <option value="uk">Українська</option>
                        <option value="ru">Русский</option>
                      </select>
                    </label>
                    <label>
                      {t.theme}
                      <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                      >
                        <option value="system">{t.system}</option>
                        <option value="dark">{t.dark}</option>
                        <option value="light">{t.light}</option>
                      </select>
                    </label>
                    <button
                      className="secondary"
                      disabled={!authenticated}
                      onClick={openEditor}
                    >
                      <MapPin size={16} />
                      {t.change} · {t.location.toLowerCase()}
                    </button>
                  </section>
                  <section className="glass info-panel">
                    <div className="icon-tile cyan">
                      <ShieldCheck size={23} />
                    </div>
                    <h2>{t.coverage}</h2>
                    <p>{operator?.limitation || t.unknownSub}</p>
                    {operator && (
                      <a
                        className="source-link"
                        href={operator.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.source}
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <p className="small">{t.reliableSub}</p>
                  </section>
                </div>
              )}
            </>
          )}
          <footer>
            <span>
              <Zap size={13} /> {t.footer}
            </span>
            <span>
              24 області + Київ <span className="flag" />
            </span>
          </footer>
        </div>
      </main>
      <nav className="bottom-nav">
        {navItems.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => navigate(key)}
          >
            <Icon size={20} />
            <span>{t[key]}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Info size={18} />
          {toast}
          <button aria-label={t.cancel} onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="location-dialog"
        onCancel={() => setEditing(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setEditing(false);
        }}
      >
        <div className="dialog-inner">
          <button
            className="dialog-close icon-button"
            aria-label={t.cancel}
            onClick={() => setEditing(false)}
          >
            <X size={20} />
          </button>
          <div className="icon-tile cyan">
            <MapPin size={24} />
          </div>
          <h2>{t.choose}</h2>
          <p>{t.chooseSub}</p>
          <label className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.search}
              aria-label={t.search}
            />
          </label>
          <label>
            {t.region}
            <select
              aria-label={t.region}
              value={draft.region}
              onChange={(e) => {
                const r = regions.find((r) => r.id === e.target.value)!;
                setDraft({
                  ...draft,
                  region: r.id,
                  operator: r.operators[0].id,
                  queue: r.operators[0].queues[0] || "",
                });
              }}
            >
              {regions
                .filter(
                  (r) =>
                    r.name.toLowerCase().includes(search.toLowerCase()) ||
                    r.id === draft.region,
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t.operator}
            <select
              aria-label={t.operator}
              value={draft.operator}
              onChange={(e) => {
                const o = draftRegion!.operators.find(
                  (o) => o.id === e.target.value,
                )!;
                setDraft({
                  ...draft,
                  operator: o.id,
                  queue: o.queues[0] || "",
                });
              }}
            >
              {draftRegion?.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.queue}
            {draftOperator?.queues.length ? (
              <select
                aria-label={t.queue}
                value={draft.queue}
                onChange={(e) => setDraft({ ...draft, queue: e.target.value })}
              >
                <option value="" disabled>
                  {profile.language === "uk"
                    ? "Оберіть чергу"
                    : "Выберите очередь"}
                </option>
                {draftOperator.queues.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            ) : (
              <div className="field-note">
                <Info size={16} />
                {t.noQueues}
              </div>
            )}
          </label>
          <div className="coverage-note">
            <ShieldCheck size={17} />
            <span>{draftOperator?.limitation}</span>
          </div>
          <button
            className="primary"
            disabled={busy || (!!draftOperator?.queues.length && !draft.queue)}
            onClick={() => void persist(draft, true)}
          >
            {busy ? t.saving : t.save}
            <Check size={17} />
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Timeline({
  day,
  now,
  selected,
  onSelect,
  language,
}: {
  day: Day | undefined;
  now: number;
  selected: Interval | null;
  onSelect: (i: Interval) => void;
  language: "uk" | "ru";
}) {
  const t = translations[language];
  const intervals =
    day?.status === "published" || day?.status === "cached" ? day.intervals : [];
  const start = day?.day_start ?? 0,
    end = day?.day_end ?? 0,
    total = end - start;
  const progress = total > 0 ? ((now - start) / total) * 100 : -1;
  return (
    <div className="timeline-wrap">
      <div className="timeline" aria-label={t.daySchedule}>
        {intervals.length
          ? intervals.map((i) => (
              <button
                key={i.start}
                className={`segment ${i.state} ${selected?.start === i.start ? "segment-selected" : ""}`}
                style={{ flexGrow: (i.end - i.start) / total }}
                aria-label={`${time(i.start)}–${time(i.end)} ${t[labels[i.state]]}`}
                title={`${time(i.start)}–${time(i.end)} ${t[labels[i.state]]}`}
                onClick={() => onSelect(i)}
              />
            ))
          : Array.from({ length: 24 }, (_, i) => (
              <span className="segment unknown" key={i} />
            ))}
        {progress >= 0 && progress <= 100 && (
          <span className="now-line" style={{ left: `${progress}%` }}>
            <i />
          </span>
        )}
      </div>
      <div className="hour-labels">
        {(day?.ticks || []).map(({ label, time: tick }) => (
          <span
            key={label}
            style={{
              left: `${total > 0 ? ((tick - start) / total) * 100 : 0}%`,
            }}
          >
            {label}
            <small>:00</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  day,
  operator,
  language,
}: {
  day?: Day;
  operator?: string;
  language: "uk" | "ru";
}) {
  const t = translations[language];
  return (
    <section className="glass source-card">
      <div className="section-title">
        <span className="eyebrow">{t.source}</span>
        <ShieldCheck size={17} />
      </div>
      <h3>{operator || "—"}</h3>
      <p>{t.updated}</p>
      <div className="last-updated">
        <span
          className={`status-dot ${day?.status === "published" && !day.stale ? "on" : "unknown"}`}
        />
        {day?.last_success
          ? new Intl.DateTimeFormat(language === "uk" ? "uk-UA" : "ru-RU", {
              timeZone: "Europe/Kyiv",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(new Date(day.last_success * 1000))
          : t.notChecked}
      </div>
      {day && (
        <a
          className="source-link"
          href={day.source_url}
          target="_blank"
          rel="noreferrer"
        >
          {t.source}
          <ArrowUpRight size={15} />
        </a>
      )}
    </section>
  );
}
