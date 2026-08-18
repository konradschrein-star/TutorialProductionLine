import { KeywordItem } from '../types';
import rawKeywords2000 from '../data/keywords2000.json';

const KEYWORDS_STORAGE_KEY = 'tpl_screened_keywords_v2';

export const POPULAR_SOFTWARES = [
  'Xero', 'Dext', 'Pipedrive', 'Deel', 'Remote.com', 'Rippling', 'TradingView',
  'Notion', 'ClickUp', 'Monday.com', 'Zapier', 'Make', 'HubSpot', 'Airtable',
  'Webflow', 'Framer', 'Canva', 'Figma', 'Miro', 'Loom', 'Slack', 'Zoom',
  'Calendly', 'Typeform', 'n8n', 'Hotjar', 'Looker Studio', 'Semrush', 'Klaviyo',
  'Brevo', 'DocuSign', 'PandaDoc', 'Gusto', 'BambooHR', 'Zendesk', 'Intercom', 'Webex'
];

export const INITIAL_KEYWORDS: KeywordItem[] = rawKeywords2000 as KeywordItem[];

export class KeywordService {
  /**
   * Retrieves current keyword pool from localStorage or initial dataset (2,150 items)
   */
  static getKeywords(): KeywordItem[] {
    try {
      const stored = localStorage.getItem(KEYWORDS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse stored keywords:', e);
    }
    this.saveKeywords(INITIAL_KEYWORDS);
    return INITIAL_KEYWORDS;
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
