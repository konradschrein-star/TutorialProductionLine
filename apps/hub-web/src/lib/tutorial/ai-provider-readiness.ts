/** Server-only provider readiness. Never expose provider URLs, tokens or raw bodies. */
export type ThumbnailProviderReadiness = { provider: "veoforge" | "configured"; ready: boolean | null; reason: string };
let cached: { key: string; expires: number; value: ThumbnailProviderReadiness } | undefined;
export function interpretVeoImageReadiness(status: number, body: unknown): ThumbnailProviderReadiness {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const capacity = typeof value.accounts_capacity === "number" ? value.accounts_capacity : null;
  const ready = status === 200 && value.ready === true && (capacity === null || capacity > 0);
  return { provider: "veoforge", ready, reason: ready
    ? "VeoForge is ready. Image outputs still require quality review."
    : "VeoForge cannot generate right now. An Admin must restore provider availability; your approved images are unchanged." };
}
export async function getTutorialAiProviderReadiness(): Promise<ThumbnailProviderReadiness> {
  if (process.env.THUMBNAIL_BACKEND !== "veoforge") return { provider: "configured", ready: null, reason: "Uses the configured shared image provider. Availability is checked when processing." };
  if (!process.env.VEOFORGE_API_KEY) return { provider: "veoforge", ready: false, reason: "VeoForge credentials are not configured on this installation. Ask an Admin to connect it." };
  if (process.env.VEOFORGE_IMAGES_ENABLED !== "1") return { provider: "veoforge", ready: false, reason: "VeoForge image generation is disabled. An Admin must verify image capability before enabling it." };
  const base = process.env.VEOFORGE_API_URL;
  if (!base) return { provider: "veoforge", ready: false, reason: "VeoForge's service address is not configured." };
  const key = base;
  if (cached?.key === key && cached.expires > Date.now()) return cached.value;
  let result: ThumbnailProviderReadiness;
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error("Invalid endpoint");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ready`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.VEOFORGE_API_KEY}` }, redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" });
    result = interpretVeoImageReadiness(response.status, await response.json());
  } catch { result = { provider: "veoforge", ready: false, reason: "VeoForge readiness could not be verified. Retry later or ask an Admin to check the connection." }; }
  cached = { key, expires: Date.now() + 15000, value: result };
  return result;
}
