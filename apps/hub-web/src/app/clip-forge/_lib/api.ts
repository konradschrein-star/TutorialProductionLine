/**
 * Clip Forge — typed client for the /api/v1/clip-forge/* endpoints.
 *
 * All screens that need real data go through here so we have one place to
 * swap fetch impl, add retries, etc.
 */

export interface CfApiPersona {
  id: string;
  name: string;
  rights_confirmed: boolean;
  default_language: string;
  created_at: string;
}

export interface CfApiSource {
  id: string;
  persona_id: string;
  source_url: string;
  source_kind: string;
  title: string;
  duration_sec: number;
  status: string;
  created_at: string;
  resolution: string | null;
  codec: string | null;
  fps: number | null;
  size_bytes: number | null;
}

export interface CfApiRawClip {
  id: string;
  source_id: string;
  persona_id: string;
  start_sec: number;
  end_sec: number;
  clip_score: number;
  categories: string[];
  status: string;
  raw_mp4_key: string | null;
  suggested_caption: string | null;
  score_reason: string;
}

export interface CfApiStatus {
  ok: boolean;
  counts?: {
    personas: number;
    sources: number;
    clips_ready: number;
    dists_live: number;
    dlq: number;
  };
  reason?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path}: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const cfApi = {
  status: () => get<CfApiStatus>("/api/v1/clip-forge/status"),
  listPersonas: () =>
    get<{ personas: CfApiPersona[] }>("/api/v1/clip-forge/personas"),
  createPersona: (body: { name: string; default_language?: string }) =>
    post<{ persona: CfApiPersona }>("/api/v1/clip-forge/personas", body),
  listSources: () =>
    get<{ sources: CfApiSource[] }>("/api/v1/clip-forge/sources"),
  createSource: (body: {
    persona_id: string;
    source_url: string;
    title?: string;
    language?: string;
  }) => post<{ source: CfApiSource }>("/api/v1/clip-forge/sources", body),
  listRawClips: () =>
    get<{ clips: CfApiRawClip[] }>("/api/v1/clip-forge/raw-clips?limit=200"),
};
