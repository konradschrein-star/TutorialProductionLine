/** Shared display rules. A bound job is not necessarily a produced tutorial. */
export function keywordIsProduced(keyword: { status: string; job: { status: string } | null }): boolean {
  return keyword.job ? keyword.job.status === "COMPLETED" : ["DONE", "UPLOADED"].includes(keyword.status);
}

export function inferKeywordChannel(channels: readonly { id: string }[], assignedChannelId?: string | null): string {
  // Never reinterpret a scraped YouTube channel id as a Studio destination.
  if (assignedChannelId) return channels.some((c) => c.id === assignedChannelId) ? assignedChannelId : "";
  return channels.length === 1 ? channels[0]!.id : "";
}

export function keywordIntegrationState(env: Record<string, string | undefined>): "configured" | "disabled" | "unconfigured" {
  if (env.KT_ENABLED === "false") return "disabled";
  return env.KT_EMBED_URL?.trim() && env.KT_EMBED_SECRET?.trim() ? "configured" : "unconfigured";
}

export function keywordApiBase(env: Record<string, string | undefined>): string {
  const value = env.KT_API_URL ?? env.KT_EMBED_URL;
  if (!value) throw new Error("Keyword Tool API is not configured.");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Keyword Tool API URL must be HTTP(S), without credentials, query or fragment.");
  }
  return url.toString().replace(/\/$/, "");
}
