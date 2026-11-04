export type State =
  "on" | "planned" | "possible" | "unknown" | "emergency" | "urgent";
export type Interval = {
  start: number;
  end: number;
  state: State;
  event_start?: number;
  event_end?: number;
};
export type Day = {
  date: string;
  status: string;
  intervals: Interval[];
  source_url: string;
  message?: string;
  last_success: number | null;
  last_attempt: number | null;
  stale: boolean;
  version: number;
  day_start: number;
  day_end: number;
  ticks: { label: string; time: number }[];
};
export type Schedule = {
  days: Day[];
  server_time: number;
  timezone: string;
  demo: boolean;
};
export type Operator = {
  id: string;
  name: string;
  url: string;
  adapter: string;
  limitation: string;
  queues: string[];
};
export type Region = { id: string; name: string; operators: Operator[] };
export type Profile = {
  guest?: boolean;
  bot_configured?: boolean;
  notifications_ready?: boolean;
  region: string;
  operator: string;
  queue: string;
  language: "uk" | "ru";
  notifications: boolean;
  bot_started: boolean;
  bot_username: string;
  dev: boolean;
  demo: boolean;
};
