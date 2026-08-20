/**
 * DuckDuckGo image search — no API key required.
 *
 * Flow:
 *  1. GET duckduckgo.com/?q=... to obtain a `vqd` session token from the HTML.
 *  2. GET duckduckgo.com/i.js?q=...&vqd=... to receive paginated image JSON.
 *
 * Returns raw image URLs suitable for direct download.
 * Useful for product-specific screenshots / logos where Pexels has limited coverage.
 */

export interface DDGImageResult {
  url: string;
  title: string;
  width: number;
  height: number;
  thumbnail: string;
  source: string;
}

const DDG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://duckduckgo.com/",
};

/** Obtain a DDG session vqd token for a query. */
async function getVqd(query: string): Promise<string> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images`;
  const res = await fetch(url, {
    headers: DDG_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`DDG vqd fetch failed: ${res.status}`);

  const html = await res.text();

  // DDG embeds the token as: vqd="<token>" or vqd=<token> in the page JS
  const match =
    html.match(/vqd=["']([^"']+)["']/) ??
    html.match(/vqd\\?=\\?"?([^&"\\s]+)/) ??
    html.match(/"vqd":"([^"]+)"/) ??
    html.match(/vqd%3D([^&%]+)/);

  if (!match?.[1]) {
    throw new Error(
      `DDG vqd token not found in response for query: "${query}"`,
    );
  }
  return match[1];
}

/**
 * Search DuckDuckGo images. Returns up to `limit` results.
 * Throws if DDG blocks or changes their API.
 */
export async function searchDDGImages(
  query: string,
  limit = 5,
): Promise<DDGImageResult[]> {
  const vqd = await getVqd(query);

  const params = new URLSearchParams({
    q: query,
    vqd,
    o: "json",
    s: "0",
    l: "us-en",
    p: "1",
    f: ",,,,,",
    v7exp: "a",
  });

  const res = await fetch(`https://duckduckgo.com/i.js?${params}`, {
    headers: { ...DDG_HEADERS, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`DDG image search failed: ${res.status}`);

  const data = (await res.json()) as { results?: any[] };
  const results: DDGImageResult[] = (data.results ?? [])
    .slice(0, limit)
    .map((r: any) => ({
      url: r.image ?? r.url ?? "",
      title: r.title ?? "",
      width: r.width ?? 0,
      height: r.height ?? 0,
      thumbnail: r.thumbnail ?? "",
      source: r.url ?? "",
    }))
    .filter((r) => r.url);

  return results;
}
