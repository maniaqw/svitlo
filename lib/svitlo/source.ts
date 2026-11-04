const USER_AGENT = "SvitloMiniApp/1.0 public schedule reader";

/** Standard anonymous HTTP cookie handling, scoped to this one official origin. */
export async function fetchSource(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const origin = new URL(url).origin,
    cookies = new Map<string, string>(),
    signal = AbortSignal.timeout(12000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetcher(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        ...(cookies.size
          ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
    });
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
      getAll?: (name: string) => string[];
    };
    const setCookies =
      headers.getSetCookie?.() ??
      headers.getAll?.("Set-Cookie") ??
      (headers.get("set-cookie")?.split(/,(?=\s*[^;,=\s]+=)/) || []);
    for (const cookie of setCookies) {
      const pair = cookie.split(";", 1)[0],
        index = pair.indexOf("=");
      if (index > 0)
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Missing source redirect location");
      const next = new URL(location, url);
      if (next.origin !== origin || next.protocol !== "https:")
        throw new Error("Unexpected source redirect origin");
      await response.body?.cancel();
      url = next.toString();
      continue;
    }
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    const content = await response.text();
    if (content.length > 4_000_000)
      throw new Error("Source response size exceeded");
    return content;
  }
  throw new Error("Source redirect limit exceeded");
}
