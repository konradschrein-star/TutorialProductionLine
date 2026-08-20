/**
 * GET /api/v1/image-models — the (backend, models) pairs the create form offers.
 *
 * The control is TWO-LEVEL and the second level depends on the first:
 * picking `ai33` exposes the full AI33 catalogue; every other backend is
 * restricted to Nano Banana Pro / Nano Banana 2, because those backends post a
 * fixed model upstream and cannot honour a per-job one (see
 * `backendHonoursImageModel` in @repo/contracts).
 *
 * The AI33 list is FETCHED LIVE from `GET https://api.ai33.pro/v1i/models` and
 * cached in-process, because a hardcoded catalogue goes stale silently — AI33
 * added four models between the last audit and today. When the fetch fails the
 * route serves the checked-in catalogue instead and says so in
 * `source: "fallback"` with a `sourceReason`: a stale list that renders is
 * useful, a stale list presented as live is not.
 *
 * `?aspect=16:9` marks models that cannot render that ratio as
 * `supportsAspect: false` (two GPT models genuinely cannot do 16:9). They are
 * returned rather than hidden so the UI can disable them visibly — a silently
 * missing option is indistinguishable from a bug.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  AI33_IMAGE_MODEL_CATALOGUE,
  BUSINESS_HUB_IMAGE_BACKENDS,
  BUSINESS_HUB_IMAGE_BACKEND_LABELS,
  backendHonoursImageModel,
  defaultModelForBackend,
  fallbackModelsForBackend,
  findAI33ImageModel,
  modelSupportsAspect,
  resolutionForModel,
  type BusinessHubImageBackend,
  type ImageModelSpec,
} from "@repo/contracts";
import { getHubConfig } from "@/lib/config";
import { withApiAuth } from "../_lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AI33_BASE_URL = "https://api.ai33.pro";
const AI33_FETCH_TIMEOUT_MS = 8000;
/** Long enough that opening the form repeatedly costs one upstream call. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CatalogueSnapshot {
  models: readonly ImageModelSpec[];
  source: "live" | "fallback";
  /** Why the fallback was used. `null` on a live hit. */
  sourceReason: string | null;
  fetchedAt: string;
}

let cache: { at: number; snapshot: CatalogueSnapshot } | null = null;

/** The `models[]` entry shape observed on /v1i/models (2026-08-16). */
interface AI33ModelRow {
  model_id?: unknown;
  aspect_ratios?: unknown;
  resolutions?: unknown;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === "string");
  // An empty list here means "the field was present but said nothing", which is
  // not the same claim as "supports none" — report it as unknown.
  return out.length > 0 ? out : null;
}

/**
 * Label a live model id. Known ids keep the catalogue's human label; an id AI33
 * added since is shown VERBATIM rather than prettified, so a new model is
 * obviously new instead of looking like something we curated.
 */
function labelFor(id: string): string {
  return findAI33ImageModel(id)?.label ?? id;
}

async function fetchLiveAI33Catalogue(): Promise<CatalogueSnapshot> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.snapshot;

  const fallback = (reason: string): CatalogueSnapshot => {
    const snapshot: CatalogueSnapshot = {
      models: AI33_IMAGE_MODEL_CATALOGUE,
      source: "fallback",
      sourceReason: reason,
      fetchedAt: new Date().toISOString(),
    };
    // Deliberately NOT cached: a fallback is a degraded answer, and caching it
    // would keep serving the stale list for ten minutes after AI33 recovered.
    return snapshot;
  };

  const apiKey = getHubConfig().AI33_API_KEY;
  if (!apiKey || apiKey === "mock") {
    return fallback("AI33_API_KEY is not configured on this host");
  }

  let payload: unknown;
  try {
    const res = await fetch(`${AI33_BASE_URL}/v1i/models`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(AI33_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return fallback(`AI33 /v1i/models returned HTTP ${res.status}`);
    }
    payload = await res.json();
  } catch (err) {
    return fallback(
      `AI33 /v1i/models unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rows =
    payload && typeof payload === "object" && "models" in payload
      ? (payload as { models: unknown }).models
      : undefined;
  if (!Array.isArray(rows)) {
    return fallback("AI33 /v1i/models returned no `models` array");
  }

  const models: ImageModelSpec[] = [];
  for (const raw of rows as AI33ModelRow[]) {
    const id = typeof raw.model_id === "string" ? raw.model_id : null;
    if (id === null || id.length === 0) continue;
    models.push({
      id,
      label: labelFor(id),
      aspectRatios: stringList(raw.aspect_ratios),
      resolutions: stringList(raw.resolutions),
    });
  }
  if (models.length === 0) {
    return fallback("AI33 /v1i/models returned no usable model ids");
  }

  const snapshot: CatalogueSnapshot = {
    models,
    source: "live",
    sourceReason: null,
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: now, snapshot };
  return snapshot;
}

interface ModelPayload {
  id: string;
  label: string;
  /** `false` only when the model DECLARES ratios and `aspect` is not among them. */
  supportsAspect: boolean;
  /** The `resolution` this model would be asked for; `null` = send none. */
  resolution: string | null;
}

interface BackendPayload {
  id: BusinessHubImageBackend;
  label: string;
  hint: string;
  /** `true` only for ai33 — the one backend that passes a model id upstream. */
  honoursModel: boolean;
  defaultModel: string;
  models: ModelPayload[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withApiAuth(req, async () => {
    const aspect = new URL(req.url).searchParams.get("aspect") ?? "16:9";
    const ai33 = await fetchLiveAI33Catalogue();

    const toPayload = (m: ImageModelSpec): ModelPayload => ({
      id: m.id,
      label: m.label,
      supportsAspect: modelSupportsAspect(m, aspect),
      resolution: resolutionForModel(m) ?? null,
    });

    const backends: BackendPayload[] = BUSINESS_HUB_IMAGE_BACKENDS.map(
      (backend) => {
        const specs =
          backend === "ai33" ? ai33.models : fallbackModelsForBackend(backend);
        return {
          id: backend,
          label: BUSINESS_HUB_IMAGE_BACKEND_LABELS[backend].label,
          hint: BUSINESS_HUB_IMAGE_BACKEND_LABELS[backend].hint,
          honoursModel: backendHonoursImageModel(backend),
          defaultModel: defaultModelForBackend(backend),
          models: specs.map(toPayload),
        };
      },
    );

    return NextResponse.json({
      backends,
      aspect,
      // Which list the AI33 entry came from. The UI surfaces this — an operator
      // comparing models needs to know he is looking at today's catalogue.
      source: ai33.source,
      sourceReason: ai33.sourceReason,
      fetchedAt: ai33.fetchedAt,
    });
  });
}
