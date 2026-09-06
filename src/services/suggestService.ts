import { CompetitionLevel } from '../types/config';

/**
 * Keyword ACQUISITION service.
 *
 * Turns a single seed term into a fanned-out set of REAL candidate search
 * queries by hitting Google / YouTube autocomplete through the existing Vite
 * proxy (`/api/google-suggest` → suggestqueries.google.com/complete/search).
 *
 * IMPORTANT HONESTY CONTRACT:
 * The autocomplete endpoints return the *phrasing* people actually type, but
 * NOT their search volume or competition. Those two numbers are therefore
 * produced by a transparent, deterministic HEURISTIC in this file (broader /
 * shorter phrases are banded higher) and are flagged as estimates so the UI can
 * label them clearly. They are never presented as real API metrics.
 */

export type SuggestEngine = 'google' | 'youtube';
export type EstimateBand = 'Broad' | 'Mid' | 'Long-tail';

export interface SuggestCandidate {
  keyword: string;
  /** HEURISTIC monthly-volume estimate — NOT real API data. */
  volumeEstimate: number;
  /** HEURISTIC competition estimate — NOT real API data. */
  competitionEstimate: CompetitionLevel;
  band: EstimateBand;
  /** Which engine surfaced this phrasing first. */
  engine: SuggestEngine;
}

export interface DiscoverOptions {
  /** Also fan out with modifier permutations ("how to", "tutorial", …). */
  includeModifiers?: boolean;
  /** Also fan out with alphabet soup (append a…z). */
  includeAlphabet?: boolean;
  /** Also query YouTube autocomplete (ds=yt) in addition to Google web. */
  includeYouTube?: boolean;
  /** Hard cap on returned candidates. */
  maxCandidates?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

export interface DiscoverResult {
  ok: boolean;
  candidates: SuggestCandidate[];
  /** True if at least one network request succeeded. */
  usedNetwork: boolean;
  /** Number of autocomplete queries that returned data. */
  succeededQueries: number;
  /** Number of autocomplete queries attempted. */
  attemptedQueries: number;
  /** Human-readable error, only set when ok === false. */
  error?: string;
}

/** Modifier terms that broaden a seed into many long-tail autocomplete probes. */
const MODIFIERS = [
  'how to',
  'tutorial',
  'for beginners',
  'step by step',
  'guide',
  'tips',
  'examples',
  'vs',
  'best',
  'setup',
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

const DEFAULTS: Required<DiscoverOptions> = {
  includeModifiers: true,
  includeAlphabet: true,
  includeYouTube: true,
  maxCandidates: 140,
  timeoutMs: 8000,
};

export class SuggestService {
  /**
   * Fetches raw autocomplete suggestions for ONE query. Returns [] on any
   * failure (network, abort, malformed) — callers aggregate + count successes.
   */
  static async fetchSuggestions(
    query: string,
    engine: SuggestEngine = 'google',
    timeoutMs = 8000
  ): Promise<{ ok: boolean; suggestions: string[] }> {
    const q = (query || '').trim();
    if (!q) return { ok: false, suggestions: [] };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const ytParam = engine === 'youtube' ? 'ds=yt&' : '';

    try {
      const res = await fetch(
        `/api/google-suggest?client=firefox&${ytParam}q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!res.ok) return { ok: false, suggestions: [] };

      const data = await res.json();
      // Firefox client shape: [query, [suggestion, suggestion, ...]]
      if (Array.isArray(data) && Array.isArray(data[1])) {
        const suggestions = data[1].filter((s: unknown): s is string => typeof s === 'string');
        return { ok: true, suggestions };
      }
      return { ok: true, suggestions: [] };
    } catch {
      clearTimeout(timeoutId);
      return { ok: false, suggestions: [] };
    }
  }

  /** Builds the fan-out query list for a seed given the options. */
  static expandSeed(seed: string, opts: DiscoverOptions = {}): string[] {
    const o = { ...DEFAULTS, ...opts };
    const base = seed.trim();
    if (!base) return [];

    const queries = new Set<string>([base]);

    if (o.includeModifiers) {
      for (const m of MODIFIERS) {
        // Both "how to <seed>" and "<seed> tutorial" phrasings surface
        // different autocomplete branches, so probe leading + trailing.
        queries.add(`${m} ${base}`);
        queries.add(`${base} ${m}`);
      }
    }

    if (o.includeAlphabet) {
      for (const c of ALPHABET) {
        queries.add(`${base} ${c}`);
      }
    }

    return Array.from(queries);
  }

  /**
   * Fans a seed out into candidate keywords via Google (+ optional YouTube)
   * autocomplete, dedupes, and attaches clearly-labelled heuristic estimates.
   *
   * Fails GRACEFULLY: if every network request fails it returns ok:false with
   * an error message instead of inventing fake candidates.
   */
  static async discover(seed: string, opts: DiscoverOptions = {}): Promise<DiscoverResult> {
    const o = { ...DEFAULTS, ...opts };
    const base = (seed || '').trim();

    if (!base) {
      return {
        ok: false,
        candidates: [],
        usedNetwork: false,
        succeededQueries: 0,
        attemptedQueries: 0,
        error: 'Enter a seed term to discover keywords.',
      };
    }

    const queries = this.expandSeed(base, o);

    // Build the (query, engine) task list. YouTube runs on a lighter subset
    // (seed + modifiers only) to keep the request count sane.
    type Task = { q: string; engine: SuggestEngine };
    const tasks: Task[] = queries.map(q => ({ q, engine: 'google' as SuggestEngine }));
    if (o.includeYouTube) {
      const ytSubset = this.expandSeed(base, { ...o, includeAlphabet: false });
      for (const q of ytSubset) tasks.push({ q, engine: 'youtube' });
    }

    let succeeded = 0;
    const seen = new Set<string>();
    const seedLower = base.toLowerCase();
    const candidates: SuggestCandidate[] = [];

    const runTask = async (t: Task) => {
      const { ok, suggestions } = await this.fetchSuggestions(t.q, t.engine, o.timeoutMs);
      if (ok) succeeded++;
      for (const raw of suggestions) {
        const s = raw.trim();
        const key = s.toLowerCase();
        if (!s || seen.has(key)) continue;
        // Keep only suggestions that actually relate to the seed to avoid
        // autocomplete drift (Google sometimes returns adjacent topics).
        if (!key.includes(seedLower) && !seedLower.split(/\s+/).some(w => w.length > 2 && key.includes(w))) {
          continue;
        }
        seen.add(key);
        candidates.push({ keyword: s, engine: t.engine, ...estimateMetrics(s) });
      }
    };

    await runWithConcurrency(tasks, 6, runTask);

    if (succeeded === 0) {
      return {
        ok: false,
        candidates: [],
        usedNetwork: false,
        succeededQueries: 0,
        attemptedQueries: tasks.length,
        error:
          'Could not reach the autocomplete service. Check your connection or the /api/google-suggest proxy, then retry.',
      };
    }

    // Rank candidates: broader (higher est. volume) first so the strongest
    // opportunities surface at the top of the preview.
    candidates.sort((a, b) => b.volumeEstimate - a.volumeEstimate);
    const trimmed = candidates.slice(0, o.maxCandidates);

    return {
      ok: true,
      candidates: trimmed,
      usedNetwork: true,
      succeededQueries: succeeded,
      attemptedQueries: tasks.length,
    };
  }

  /**
   * Scrapes keywords inspired by a YouTube channel handle or topic URL.
   * Probes autocomplete and topic variations around that channel's core niche.
   */
  static async scrapeChannel(
    channelIdentifier: string,
    softwareHint?: string
  ): Promise<DiscoverResult> {
    const raw = (channelIdentifier || '').trim();
    if (!raw) {
      return {
        ok: false,
        candidates: [],
        usedNetwork: false,
        succeededQueries: 0,
        attemptedQueries: 0,
        error: 'Channel handle or URL required'
      };
    }

    // Extract handle / channel name from URL or handle string
    let handle = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '').trim();
    if (!handle) handle = raw;

    // Clean human name e.g. "GuideRealmVideos" -> "Guide Realm Videos" or "learnskillsdaily"
    const cleaned = handle.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');

    const seedQueries = [
      cleaned,
      softwareHint ? `${softwareHint} ${cleaned}` : `${cleaned} tutorial`,
      softwareHint ? `${softwareHint} tutorial` : `${cleaned} how to`,
    ];

    const allCandidates = new Map<string, SuggestCandidate>();
    let succeeded = 0;
    let attempted = 0;

    for (const seed of seedQueries) {
      const res = await this.discover(seed, {
        includeModifiers: true,
        includeAlphabet: true,
        includeYouTube: true,
        maxCandidates: 80,
      });
      succeeded += res.succeededQueries;
      attempted += res.attemptedQueries;
      for (const c of res.candidates) {
        if (!allCandidates.has(c.keyword.toLowerCase())) {
          allCandidates.set(c.keyword.toLowerCase(), c);
        }
      }
    }

    const candidates = Array.from(allCandidates.values());
    candidates.sort((a, b) => b.volumeEstimate - a.volumeEstimate);

    return {
      ok: true,
      candidates,
      usedNetwork: succeeded > 0,
      succeededQueries: succeeded,
      attemptedQueries: attempted,
    };
  }
}

// ---------------------------------------------------------------------------
// Heuristics & helpers (transparent, deterministic — never presented as real)
// ---------------------------------------------------------------------------

/** Stable non-negative hash for deterministic per-keyword jitter. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Derives a HEURISTIC volume/competition band from phrase shape. Fewer words =
 * broader intent = higher estimated volume + competition. Jitter is derived
 * from a stable hash so the same phrase always shows the same estimate.
 */
export function estimateMetrics(keyword: string): {
  volumeEstimate: number;
  competitionEstimate: CompetitionLevel;
  band: EstimateBand;
} {
  const words = keyword.trim().split(/\s+/).filter(Boolean).length;
  const h = hashString(keyword.toLowerCase());

  let band: EstimateBand;
  let baseVol: number;
  let spread: number;
  let competitionEstimate: CompetitionLevel;

  if (words <= 3) {
    band = 'Broad';
    baseVol = 8000;
    spread = 9000;
    competitionEstimate = 'High';
  } else if (words <= 5) {
    band = 'Mid';
    baseVol = 2200;
    spread = 4000;
    competitionEstimate = 'Medium';
  } else {
    band = 'Long-tail';
    baseVol = 300;
    spread = 1400;
    competitionEstimate = 'Low';
  }

  const jitter = (h % 1000) / 1000; // 0..1 stable
  const volumeEstimate = Math.round((baseVol + jitter * spread) / 10) * 10;

  return { volumeEstimate, competitionEstimate, band };
}

/** Runs async tasks with a bounded concurrency window. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    return next();
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(next());
  }
  await Promise.all(runners);
}
