import { KeywordItem } from '../types';
import rawKeywords2000 from '../data/keywords2000.json';
import { StorageService } from './storageService';
import { AIService } from './aiService';
import { CompetitionLevel, KeywordContentType } from '../types/config';

const KEYWORDS_STORAGE_KEY = 'tpl_screened_keywords_v2';
const SCREEN_META_KEY = 'tpl_keyword_screen_meta';

/** A keyword decorated with a runtime opportunity score + dedup cluster stem. */
export interface ScoredKeyword extends KeywordItem {
  /** Opportunity score 0-100 (higher = better). */
  score: number;
  /** Normalized stem shared by near-duplicate templated variants. */
  clusterKey: string;
}

/** Contextual inputs that bias the opportunity score toward the operator's setup. */
export interface ScoreContext {
  /** The channel currently in focus — keywords routed to it score higher on fit. */
  activeChannelId?: string;
  /** Operator's focus software (from config) — matches score higher on fit. */
  focusSoftware?: string[];
  /** Overrides the config length cap for the lengthFit component. */
  lengthCapMinutes?: number;
  /** Injectable clock for deterministic scoring/tests. */
  now?: number;
}

/** AI-screening sidecar metadata, keyed by keyword id (kept off the KeywordItem type). */
export interface KeywordScreenMeta {
  angle?: string;
  title?: string;
}

const COMPETITION_SCORE: Record<CompetitionLevel, number> = { Low: 1, Medium: 0.55, High: 0.15 };
const COMPETITION_RANK: Record<CompetitionLevel, number> = { Low: 0, Medium: 1, High: 2 };

/** Modifier/stop words stripped when deriving a keyword's dedup cluster stem. */
const CLUSTER_STOPWORDS = new Set([
  'how', 'to', 'a', 'an', 'the', 'in', 'on', 'for', 'of', 'with', 'your', 'my',
  'tutorial', 'guide', 'guides', 'step', 'by', 'beginners', 'beginner', 'best',
  'top', 'using', 'use', 'setup', 'set', 'up', 'tips', 'tricks', 'and', 'or',
  'vs', 'examples', 'example', 'complete', 'full', 'quick', 'easy', 'free',
  '2023', '2024', '2025', '2026', '2027',
]);

export const POPULAR_SOFTWARES = [
  'Xero', 'Dext', 'Pipedrive', 'Deel', 'Remote.com', 'Rippling', 'TradingView',
  'Notion', 'ClickUp', 'Monday.com', 'Zapier', 'Make', 'HubSpot', 'Airtable',
  'Webflow', 'Framer', 'Canva', 'Figma', 'Miro', 'Loom', 'Slack', 'Zoom',
  'Calendly', 'Typeform', 'n8n', 'Hotjar', 'Looker Studio', 'Semrush', 'Klaviyo',
  'Brevo', 'DocuSign', 'PandaDoc', 'Gusto', 'BambooHR', 'Zendesk', 'Intercom', 'Webex',
  'Excel', 'Word', 'Power BI', 'QuickBooks', 'Shopify', 'Photoshop', 'CapCut'
];

// The bundled curated pool is always tagged as the 'starter' source so it can be
// kept visually and logically separate from keywords the operator brings in themselves.
export const INITIAL_KEYWORDS: KeywordItem[] = (rawKeywords2000 as KeywordItem[]).map(k => ({
  ...k,
  source: 'starter',
}));

export class KeywordService {
  /**
   * Retrieves current keyword pool from localStorage or initial dataset (2,150 items)
   */
  static getKeywords(): KeywordItem[] {
    try {
      const stored = localStorage.getItem(KEYWORDS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Backward-compat: any legacy keyword without a source is treated as 'starter'.
          return parsed.map((k: KeywordItem) => (k.source ? k : { ...k, source: 'starter' }));
        }
      }
    } catch (e) {
      console.warn('Failed to parse stored keywords:', e);
    }
    this.saveKeywords(INITIAL_KEYWORDS);
    return INITIAL_KEYWORDS;
  }

  /**
   * Returns keywords belonging to a specific pool ('starter' = bundled 2,150 list,
   * 'own' = operator-supplied). Keywords with no source default to 'starter'.
   */
  static getKeywordsBySource(source: 'starter' | 'own'): KeywordItem[] {
    return this.getKeywords().filter(k => (k.source ?? 'starter') === source);
  }

  /**
   * Persists keyword state
   */
  static saveKeywords(list: KeywordItem[]): void {
    try {
      localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save keywords to localStorage:', e);
    }
  }

  /**
   * Returns keywords claimed by a specific VA user.
   *
   * Claims are now stored by user **id**, but historic data (and some callers)
   * pass a display name. This resolves the given identifier to a user and
   * matches keywords claimed by EITHER the id or the name, so both the new
   * id-based claims and legacy name-based claims are found.
   */
  static getClaimedKeywords(identifier: string): KeywordItem[] {
    if (!identifier) return [];
    const list = this.getKeywords();

    const matches = new Set<string>([identifier]);
    try {
      const user = StorageService.getUsers().find(u => u.id === identifier || u.name === identifier);
      if (user) {
        matches.add(user.id);
        matches.add(user.name);
      }
    } catch {
      // StorageService unavailable — fall back to a literal identifier match.
    }

    return list.filter(k => k.claimedBy != null && matches.has(k.claimedBy) && k.status !== 'COMPLETED');
  }

  /**
   * Claims a keyword for a specific VA user. Prefer passing the user **id**;
   * a display name still works for backward compatibility.
   */
  static claimKeyword(id: string, userIdOrName: string): KeywordItem | undefined {
    return this.updateKeywordStatus(id, 'IN_PRODUCTION', userIdOrName);
  }

  /**
   * Updates state of a single keyword with persistence
   */
  static updateKeywordStatus(
    id: string,
    status: 'NEW' | 'CLAIMED' | 'IN_PRODUCTION' | 'COMPLETED',
    claimedBy?: string
  ): KeywordItem | undefined {
    const list = this.getKeywords();
    let updatedItem: KeywordItem | undefined;

    const nextList = list.map(item => {
      if (item.id === id) {
        updatedItem = {
          ...item,
          status,
          claimedBy: status === 'NEW' ? undefined : (claimedBy || item.claimedBy),
        };
        return updatedItem;
      }
      return item;
    });

    this.saveKeywords(nextList);
    return updatedItem;
  }

  /**
   * Batch updates status across multiple keyword IDs
   */
  static batchUpdateStatus(ids: string[], status: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED'): void {
    const list = this.getKeywords();
    const idSet = new Set(ids);

    const nextList = list.map(item => {
      if (idSet.has(item.id)) {
        return {
          ...item,
          status,
          claimedBy: status === 'NEW' ? undefined : item.claimedBy,
        };
      }
      return item;
    });

    this.saveKeywords(nextList);
  }

  /**
   * Batch assign channel to selected keyword IDs
   */
  static batchAssignChannel(ids: string[], channelId: string): void {
    const list = this.getKeywords();
    const idSet = new Set(ids);

    const nextList = list.map(item => {
      if (idSet.has(item.id)) {
        return {
          ...item,
          targetChannelId: channelId,
        };
      }
      return item;
    });

    this.saveKeywords(nextList);
  }

  /**
   * Assigns a single keyword to a specific VA user.
   */
  static assignKeyword(id: string, userId?: string, userName?: string): KeywordItem | undefined {
    const list = this.getKeywords();
    let updatedItem: KeywordItem | undefined;

    const nextList = list.map(item => {
      if (item.id === id) {
        updatedItem = {
          ...item,
          assignedTo: userId || undefined,
          assignedToName: userName || undefined,
          claimedBy: userId || userName || item.claimedBy,
        };
        return updatedItem;
      }
      return item;
    });

    this.saveKeywords(nextList);
    return updatedItem;
  }

  /**
   * Batch assign keywords to a specific VA user
   */
  static batchAssignUser(ids: string[], userId?: string, userName?: string): void {
    const list = this.getKeywords();
    const idSet = new Set(ids);

    const nextList = list.map(item => {
      if (idSet.has(item.id)) {
        return {
          ...item,
          assignedTo: userId || undefined,
          assignedToName: userName || undefined,
          claimedBy: userId || userName || item.claimedBy,
        };
      }
      return item;
    });

    this.saveKeywords(nextList);
  }

  /**
   * Batch delete keywords
   */
  static batchDelete(ids: string[]): void {
    const list = this.getKeywords();
    const idSet = new Set(ids);
    const nextList = list.filter(item => !idSet.has(item.id));
    this.saveKeywords(nextList);
  }

  /**
   * Marks a keyword as completed
   */
  static completeKeyword(id: string): void {
    this.updateKeywordStatus(id, 'COMPLETED');
  }

  /**
   * Returns real-time metrics for keyword states
   */
  static getKeywordCounts(keywords?: KeywordItem[]): {
    total: number;
    available: number;
    inProduction: number;
    completed: number;
  } {
    const list = keywords || this.getKeywords();
    let available = 0;
    let inProduction = 0;
    let completed = 0;

    for (const k of list) {
      if (k.status === 'COMPLETED') {
        completed++;
      } else if (k.status === 'IN_PRODUCTION' || k.status === 'CLAIMED') {
        inProduction++;
      } else {
        available++;
      }
    }

    return {
      total: list.length,
      available,
      inProduction,
      completed,
    };
  }

  /**
   * Parses CSV string and merges keywords into pool
   */
  static importKeywordsFromCSV(csvText: string, defaultChannelId?: string): { added: number; skipped: number } {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return { added: 0, skipped: 0 };

    const existing = this.getKeywords();
    const existingKeywordsSet = new Set(existing.map(k => k.keyword.toLowerCase().trim()));

    const newItems: KeywordItem[] = [];
    let skipped = 0;

    // Detect header row
    const firstLine = lines[0].toLowerCase();
    const startIndex = firstLine.includes('keyword') || firstLine.includes('topic') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      // Handle simple CSV splitting (quoted or unquoted)
      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
      if (cols.length === 0 || !cols[0]) continue;

      const kwText = cols[0];
      if (existingKeywordsSet.has(kwText.toLowerCase())) {
        skipped++;
        continue;
      }

      const software = cols[1] || 'General Software';
      const volume = cols[2] ? parseInt(cols[2].replace(/[^0-9]/g, ''), 10) || 1000 : 1000;
      const competition = (cols[3] === 'High' || cols[3] === 'Medium' || cols[3] === 'Low') ? cols[3] : 'Low';
      const channelId = cols[4] || defaultChannelId || 'skool';

      const item: KeywordItem = {
        id: `kw_csv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        keyword: kwText,
        software,
        volume,
        competition: competition as 'Low' | 'Medium' | 'High',
        screenVerdict: 'APPROVE',
        contentType: 'HOW_TO',
        targetChannelId: channelId,
        status: 'NEW',
        dateAdded: new Date().toISOString().split('T')[0],
        source: 'own'
      };

      newItems.push(item);
      existingKeywordsSet.add(kwText.toLowerCase());
    }

    if (newItems.length > 0) {
      this.saveKeywords([...newItems, ...existing]);
    }

    return { added: newItems.length, skipped };
  }

  /**
   * Generates downloadable CSV content from keyword list
   */
  static exportKeywordsToCSV(keywords: KeywordItem[]): string {
    const headers = ['Keyword', 'Software', 'Search Volume', 'Competition', 'Channel ID', 'Status', 'Date Added'];
    const rows = keywords.map(k => [
      `"${k.keyword.replace(/"/g, '""')}"`,
      `"${k.software.replace(/"/g, '""')}"`,
      k.volume,
      k.competition,
      `"${k.targetChannelId || ''}"`,
      k.status,
      k.dateAdded
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Fetches search suggestions via Google Suggest API
   */
  static async fetchGoogleSuggestions(query: string): Promise<string[]> {
    if (!query || query.trim().length === 0) return [];
    try {
      const res = await fetch(`/api/google-suggest?client=firefox&q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[1])) {
          return data[1];
        }
      }
    } catch {
      // Fallback
    }

    return [
      `${query} step by step`,
      `${query} in 2 minutes`,
      `${query} 2026 tutorial`,
      `${query} for beginners`,
    ];
  }

  // ---- Scoring & ranking -----------------------------------------------------

  /**
   * Computes an opportunity score (0-100) for a keyword using the operator's
   * configurable weights (`config.keyword.scoreWeights`). Higher volume, lower
   * competition, better channel/software fit, fresher, and within the length
   * cap all push the score up.
   */
  static scoreKeyword(kw: KeywordItem, ctx: ScoreContext = {}): number {
    const cfg = StorageService.getConfig();
    const w = cfg.keyword.scoreWeights;
    const now = ctx.now ?? Date.now();
    const focusSoftware = (ctx.focusSoftware ?? cfg.focusSoftware ?? []).map(s => s.toLowerCase());
    const lengthCap = ctx.lengthCapMinutes ?? cfg.keyword.lengthCapMinutes ?? 0;

    // Volume: soft-saturating curve so 10k+ approaches the ceiling.
    const volC = clamp01(Math.sqrt(Math.max(0, kw.volume) / 12000));

    // Competition: lower is better.
    const compC = COMPETITION_SCORE[kw.competition] ?? 0.5;

    // Channel / software fit.
    let fitC = 0.5;
    if (ctx.activeChannelId && kw.targetChannelId === ctx.activeChannelId) fitC = 1;
    else if (focusSoftware.length && focusSoftware.includes((kw.software || '').toLowerCase())) fitC = 0.85;
    else if (kw.targetChannelId) fitC = 0.6;

    // Freshness: recency + current-year boost, older-year penalty.
    let freshC = 0.6;
    const added = Date.parse(kw.dateAdded);
    if (!Number.isNaN(added)) {
      const days = (now - added) / 86_400_000;
      freshC = clamp(1 - days / 120, 0.2, 1);
    }
    const year = new Date(now).getFullYear();
    if (kw.keyword.includes(String(year))) freshC = Math.max(freshC, 0.85);
    else if (/\b20(1\d|2[0-4])\b/.test(kw.keyword) && !kw.keyword.includes(String(year))) {
      freshC = Math.min(freshC, 0.45);
    }

    // Length fit: within the cap is ideal; overruns are penalized proportionally.
    let lenC = 1;
    const est = kw.estMinutes ?? cfg.defaultTargetMinutes ?? 3;
    if (lengthCap > 0 && est > lengthCap) lenC = clamp(lengthCap / est, 0.2, 1);

    const totalW = w.volume + w.competition + w.channelFit + w.freshness + w.lengthFit || 1;
    const raw =
      (volC * w.volume +
        compC * w.competition +
        fitC * w.channelFit +
        freshC * w.freshness +
        lenC * w.lengthFit) /
      totalW;

    return Math.round(clamp01(raw) * 100);
  }

  /**
   * Ranks a list of keywords by opportunity score (desc), decorating each with
   * its score and near-duplicate cluster stem.
   */
  static rankKeywords(list: KeywordItem[], ctx: ScoreContext = {}): ScoredKeyword[] {
    return list
      .map(kw => ({ ...kw, score: this.scoreKeyword(kw, ctx), clusterKey: this.clusterKey(kw.keyword) }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Derives a normalized cluster stem for a keyword by stripping modifier/stop
   * words, punctuation and years, then sorting the remaining significant tokens.
   * Templated variants ("how to use VLOOKUP in Excel 2026" / "excel VLOOKUP
   * tutorial") collapse to the same key so duplicates can be grouped.
   */
  static clusterKey(keyword: string): string {
    const tokens = (keyword || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t && !CLUSTER_STOPWORDS.has(t));
    const significant = tokens.length ? tokens : (keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
    return Array.from(new Set(significant)).sort().join(' ');
  }

  /** Groups keywords by their cluster stem (near-duplicate detection). */
  static clusterKeywords(list: KeywordItem[]): Map<string, KeywordItem[]> {
    const groups = new Map<string, KeywordItem[]>();
    for (const kw of list) {
      const key = this.clusterKey(kw.keyword);
      const bucket = groups.get(key);
      if (bucket) bucket.push(kw);
      else groups.set(key, [kw]);
    }
    return groups;
  }

  // ---- AI screening sidecar --------------------------------------------------

  /** Full angle/title screening-metadata map, keyed by keyword id. */
  static getScreenMeta(): Record<string, KeywordScreenMeta> {
    try {
      const stored = localStorage.getItem(SCREEN_META_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse keyword screen meta:', e);
    }
    return {};
  }

  static getScreenMetaFor(id: string): KeywordScreenMeta | undefined {
    return this.getScreenMeta()[id];
  }

  private static saveScreenMeta(map: Record<string, KeywordScreenMeta>): void {
    try {
      localStorage.setItem(SCREEN_META_KEY, JSON.stringify(map));
    } catch (e) {
      console.error('Failed to save keyword screen meta:', e);
    }
  }

  /**
   * AI-screens a batch of keywords in place: populates `screenVerdict`,
   * `contentType`, and an angle/title sidecar. Degrades gracefully — returns a
   * clear `error` (and screens nothing) when no AI key is configured or the LLM
   * is unreachable. NEVER fabricates verdicts.
   *
   * `onProgress(done, total)` fires after each batch so the UI can show progress.
   */
  static async screenKeywords(
    items: KeywordItem[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ screened: number; failed: number; error?: string }> {
    const targets = items.filter(k => k && k.keyword);
    if (targets.length === 0) return { screened: 0, failed: 0 };

    const hasKey =
      !!StorageService.getApiKey('gemini') ||
      !!StorageService.getApiKey('groq') ||
      !!StorageService.getApiKey('deepseek');
    if (!hasKey) {
      return {
        screened: 0,
        failed: targets.length,
        error: 'No AI API key configured. Add a Gemini, Groq, or DeepSeek key in Settings to enable AI screening.',
      };
    }

    const BATCH = 20;
    const meta = this.getScreenMeta();
    // Map verdict/type/angle by normalized keyword text for write-back.
    const updates = new Map<string, { verdict: KeywordItem['screenVerdict']; contentType: KeywordContentType; angle: string; title?: string }>();
    let failed = 0;

    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const classified = await AIService.classifyKeywords(batch.map(k => k.keyword));
      if (classified === null) {
        failed += batch.length;
      } else {
        for (const row of classified) {
          updates.set(row.keyword.toLowerCase().trim(), {
            verdict: row.verdict,
            contentType: row.contentType,
            angle: row.angle,
            title: row.title,
          });
        }
      }
      onProgress?.(Math.min(i + BATCH, targets.length), targets.length);
    }

    if (updates.size === 0) {
      return {
        screened: 0,
        failed: targets.length,
        error: 'AI screening returned no usable results. Check your API key/provider status and try again.',
      };
    }

    // Write verdict/contentType back onto the pool; angle/title into the sidecar.
    const targetIds = new Set(targets.map(t => t.id));
    let screened = 0;
    const list = this.getKeywords();
    const nextList = list.map(item => {
      if (!targetIds.has(item.id)) return item;
      const u = updates.get(item.keyword.toLowerCase().trim());
      if (!u) return item;
      screened++;
      meta[item.id] = { angle: u.angle, title: u.title };
      return { ...item, screenVerdict: u.verdict, contentType: u.contentType };
    });

    this.saveKeywords(nextList);
    this.saveScreenMeta(meta);

    return { screened, failed: targets.length - screened };
  }
}

// ---------------------------------------------------------------------------
// Local numeric helpers
// ---------------------------------------------------------------------------
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Ordered competition ranking (Low < Medium < High) for "max competition" filters. */
export function competitionAtMost(level: CompetitionLevel, max: CompetitionLevel): boolean {
  return COMPETITION_RANK[level] <= COMPETITION_RANK[max];
}
