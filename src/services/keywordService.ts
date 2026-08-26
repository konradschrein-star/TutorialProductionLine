import { KeywordItem } from '../types';
import rawKeywords2000 from '../data/keywords2000.json';

const KEYWORDS_STORAGE_KEY = 'tpl_screened_keywords_v2';

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
   * Returns list of keywords claimed by a specific VA user
   */
  static getClaimedKeywords(userName: string): KeywordItem[] {
    const list = this.getKeywords();
    return list.filter(k => k.claimedBy === userName && k.status !== 'COMPLETED');
  }

  /**
   * Claims a keyword for a specific VA user
   */
  static claimKeyword(id: string, userName: string): KeywordItem | undefined {
    return this.updateKeywordStatus(id, 'IN_PRODUCTION', userName);
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
}
