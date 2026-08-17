import { KeywordItem } from '../types';
import { KeywordService } from './keywordService';

export interface KTSyncResponse {
  success: boolean;
  totalSynced: number;
  message: string;
  source: 'live_vps' | 'cached_pool';
}

export class KTv2SyncService {
  private static vpsUrl = 'http://65.108.6.149:8000';

  /**
   * Syncs screened HOW_TO keywords from the Keyword Tool v2 VPS
   */
  static async syncWithVPS(managerEmail: string = 'decastroian76@gmail.com'): Promise<KTSyncResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout

      const res = await fetch(`${this.vpsUrl}/api/keywords?manager=${encodeURIComponent(managerEmail)}&content_type=HOW_TO`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.keywords) && data.keywords.length > 0) {
          const mapped: KeywordItem[] = data.keywords.map((k: any) => ({
            id: k.id || `kw_${Math.random()}`,
            keyword: k.keyword || k.topic,
            software: k.software || 'General',
            volume: k.volume || 100000,
            competition: k.competition || 'Low',
            screenVerdict: 'APPROVE',
            contentType: 'HOW_TO',
            targetChannelId: k.target_channel || (k.software?.toLowerCase().includes('excel') ? 'skool' : 'virtualfd'),
            status: k.status || 'NEW',
            claimedBy: k.claimed_by || undefined,
            dateAdded: k.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
            estMinutes: k.est_minutes || 5
          }));

          KeywordService.saveKeywords(mapped);
          return {
            success: true,
            totalSynced: mapped.length,
            message: `Synced ${mapped.length} live keywords from VPS`,
            source: 'live_vps'
          };
        }
      }
    } catch {
      // Graceful offline fallback
    }

    const current = KeywordService.getKeywords();
    return {
      success: true,
      totalSynced: current.length,
      message: `Using local cached pool (${current.length} keywords)`,
      source: 'cached_pool'
    };
  }

  /**
   * Pushes keyword completion update to KTv2 VPS
   */
  static async pushKeywordStatus(keywordId: string, status: 'IN_PRODUCTION' | 'COMPLETED', user: string): Promise<boolean> {
    KeywordService.completeKeyword(keywordId);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s timeout

      const res = await fetch(`${this.vpsUrl}/api/keywords/${keywordId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updatedBy: user }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return true; // Local update succeeded
    }
  }
}
