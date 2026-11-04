import SDK from "@twa-dev/sdk";
import type { Profile } from "./types";

// Normalize CommonJS interop in both Vite and the Sites/Vinext client bundle.
const WebApp = (SDK as unknown as {default?:typeof SDK}).default ?? SDK;
export { WebApp };
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const authorization = WebApp.initData ? `tma ${WebApp.initData}` : "";
  const response = await fetch(`/api${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
      "X-Guest-Preferences": encodeURIComponent(
        localStorage.getItem("svitlo-public-preferences") || "",
      ),
      ...options.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string" ? data.detail : `API ${response.status}`,
    );
  return data as T;
}
export const saveProfile = async (profile: Profile) => {
  const saved = await api<Profile>("/me", {
    method: "PUT",
    body: JSON.stringify({
      region: profile.region,
      operator: profile.operator,
      queue: profile.queue,
      language: profile.language,
      notifications: profile.notifications,
    }),
  });
  if (saved.guest)
    localStorage.setItem(
      "svitlo-public-preferences",
      JSON.stringify({
        region: saved.region,
        operator: saved.operator,
        queue: saved.queue,
        language: saved.language,
        notifications: false,
      }),
    );
  return saved;
};
