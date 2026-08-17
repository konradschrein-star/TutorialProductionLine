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
    const list = this.getKeywords();
    let updatedItem: KeywordItem | undefined;

    const nextList = list.map(item => {
      if (item.id === id) {
        updatedItem = {
          ...item,
          status: 'CLAIMED' as const,
          claimedBy: userName,
        };
        return updatedItem;
      }
      return item;
    });

    this.saveKeywords(nextList);
    return updatedItem;
  }

  /**
   * Marks a keyword as completed
   */
  static completeKeyword(id: string): void {
    const list = this.getKeywords();
    const nextList = list.map(item => {
      if (item.id === id) {
        return {
          ...item,
          status: 'COMPLETED' as const,
        };
      }
      return item;
    });
    this.saveKeywords(nextList);
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
