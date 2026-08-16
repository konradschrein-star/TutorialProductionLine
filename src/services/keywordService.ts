import { KeywordItem } from '../types';

export const POPULAR_SOFTWARES = [
  'Excel', 'Canva', 'Notion', 'ChatGPT', 'Figma', 'Word', 'Power BI', 'Photoshop',
  'CapCut', 'Blender', 'Discord', 'Shopify', 'Slack', 'Zapier', 'OBS', 'Trello',
  'Premiere Pro', 'Google Sheets', 'Google Docs', 'Asana', 'ClickUp', 'Stripe'
];

export const INITIAL_SCREENED_KEYWORDS: KeywordItem[] = [
  {
    id: 'kw_1',
    keyword: 'How to Automate Invoices in Excel',
    software: 'Excel',
    volume: 385000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'skool',
    status: 'CLAIMED',
    claimedBy: 'Ian Christopher',
    dateAdded: '2026-08-16',
    estMinutes: 4
  },
  {
    id: 'kw_2',
    keyword: 'How to Set Up Stock Inventory in Xero',
    software: 'Xero',
    volume: 142000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'virtualfd',
    status: 'CLAIMED',
    claimedBy: 'Ian Christopher',
    dateAdded: '2026-08-16',
    estMinutes: 6
  },
  {
    id: 'kw_3',
    keyword: 'Complete Monday.com CRM Setup Walkthrough',
    software: 'Monday.com',
    volume: 210000,
    competition: 'Medium',
    screenVerdict: 'APPROVE',
    contentType: 'FULL_TUTORIAL',
    targetChannelId: 'blueprint',
    status: 'NEW',
    dateAdded: '2026-08-15',
    estMinutes: 12
  },
  {
    id: 'kw_4',
    keyword: 'How to Create Automated Notion Client Portals',
    software: 'Notion',
    volume: 195000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'skool',
    status: 'NEW',
    dateAdded: '2026-08-15',
    estMinutes: 5
  },
  {
    id: 'kw_5',
    keyword: 'How to Build an Interactive Power BI Financial Dashboard',
    software: 'Power BI',
    volume: 310000,
    competition: 'Medium',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'virtualfd',
    status: 'NEW',
    dateAdded: '2026-08-14',
    estMinutes: 8
  },
  {
    id: 'kw_6',
    keyword: 'How to Remove Video Background in CapCut PC Fast',
    software: 'CapCut',
    volume: 450000,
    competition: 'High',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'skool',
    status: 'NEW',
    dateAdded: '2026-08-14',
    estMinutes: 3
  },
  {
    id: 'kw_7',
    keyword: 'How to Connect Stripe to Webflow Checkout in 5 Minutes',
    software: 'Stripe',
    volume: 128000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'skool',
    status: 'NEW',
    dateAdded: '2026-08-13',
    estMinutes: 5
  },
  {
    id: 'kw_8',
    keyword: 'How to Track Multi-Warehouse Inventory in Odoo',
    software: 'Odoo',
    volume: 98000,
    competition: 'Low',
    screenVerdict: 'APPROVE',
    contentType: 'HOW_TO',
    targetChannelId: 'virtualfd',
    status: 'NEW',
    dateAdded: '2026-08-13',
    estMinutes: 7
  },
  {
    id: 'kw_9',
    keyword: 'Figma Auto-Layout Masterclass for Beginners',
    software: 'Figma',
    volume: 275000,
    competition: 'Medium',
    screenVerdict: 'APPROVE',
    contentType: 'FULL_TUTORIAL',
    targetChannelId: 'blueprint',
    status: 'NEW',
    dateAdded: '2026-08-12',
    estMinutes: 10
  }
];

export class KeywordService {
  private static storageKey = 'tpl_keywords_pool';

  static getKeywords(): KeywordItem[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    return INITIAL_SCREENED_KEYWORDS;
  }

  static saveKeywords(list: KeywordItem[]): void {
    localStorage.setItem(this.storageKey, JSON.stringify(list));
  }

  static getClaimedKeywords(userName: string): KeywordItem[] {
    const list = this.getKeywords();
    return list.filter(k => k.claimedBy === userName || k.status === 'CLAIMED');
  }

  static claimKeyword(id: string, userName: string): void {
    const list = this.getKeywords().map(k => {
      if (k.id === id) {
        return { ...k, status: 'CLAIMED' as const, claimedBy: userName };
      }
      return k;
    });
    this.saveKeywords(list);
  }

  static completeKeyword(id: string): void {
    const list = this.getKeywords().map(k => {
      if (k.id === id) {
        return { ...k, status: 'COMPLETED' as const };
      }
      return k;
    });
    this.saveKeywords(list);
  }

  /**
   * Fetches real-time suggestions from Google Autocomplete
   */
  static async fetchGoogleSuggestions(query: string): Promise<string[]> {
    if (!query || query.length < 2) return [];
    try {
      const params = new URLSearchParams({
        client: 'chrome',
        ds: 'yt',
        q: query
      });
      const res = await fetch(`/api/google-suggest?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[1])) {
          return data[1];
        }
      }
    } catch {
      // Fallback local search
    }
    return POPULAR_SOFTWARES
      .map(s => `how to use ${s}`)
      .filter(s => s.toLowerCase().includes(query.toLowerCase()));
  }
}
