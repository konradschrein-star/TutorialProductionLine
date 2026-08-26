import { KeywordItem } from '../types';
import { KeywordService } from './keywordService';
import { StorageService } from './storageService';

export interface KeywordSyncResult {
  success: boolean;
  totalSynced: number;
  message: string;
  /**
   * 'external' = keywords were pulled from the operator's own configured endpoint.
   * 'local'    = no endpoint configured (or it was unreachable); the local pool is used.
   */
  source: 'external' | 'local';
}

/**
 * Optional bridge to an operator's OWN external keyword tool.
 *
 * This is fully isolated and single-tenant: it only ever talks to the endpoint the
 * operator configures in Settings (StorageService.getExternalKeywordApi()). It never
 * hardcodes or defaults to any third-party host. With no endpoint configured the app
 * is completely self-contained and this service is a no-op that keeps the local pool.
 *
 * Fetched keywords are tagged as the operator's own pool ('source: own') and MERGED
 * into the existing pool (deduplicated by keyword text) — they never overwrite the
 * bundled starter list.
 */
export class ExternalKeywordService {
  private static getEndpoint(): string {
    return StorageService.getExternalKeywordApi();
  }

  static isConfigured(): boolean {
    return this.getEndpoint().length > 0;
  }

  /**
   * Pulls keywords from the configured external endpoint and merges them into the
   * operator's own pool. No-op (returns local) when nothing is configured.
   */
  static async sync(): Promise<KeywordSyncResult> {
    const endpoint = this.getEndpoint();

    if (!endpoint) {
      const current = KeywordService.getKeywords();
      return {
        success: true,
        totalSynced: current.length,
        message: 'No external keyword source configured. Using local pool. (Set one in Settings.)',
        source: 'local',
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${endpoint.replace(/\/$/, '')}/api/keywords?content_type=HOW_TO`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const rows: any[] = Array.isArray(data?.keywords) ? data.keywords : Array.isArray(data) ? data : [];

        if (rows.length > 0) {
          const mapped: KeywordItem[] = rows.map((k: any) => ({
            id: k.id || `kw_ext_${Math.random().toString(36).slice(2)}`,
            keyword: k.keyword || k.topic,
            software: k.software || 'General',
            volume: k.volume || 1000,
            competition: k.competition || 'Low',
            screenVerdict: 'APPROVE',
            contentType: 'HOW_TO',
            targetChannelId: k.target_channel || k.targetChannelId,
            status: k.status || 'NEW',
            claimedBy: k.claimed_by || undefined,
            dateAdded: (k.created_at || k.dateAdded || new Date().toISOString()).split('T')[0],
            estMinutes: k.est_minutes || 2,
            source: 'own',
          }));

          // Merge (dedupe by keyword text, case-insensitive) — never clobber the pool.
          const existing = KeywordService.getKeywords();
          const seen = new Set(existing.map(k => k.keyword.toLowerCase().trim()));
          const fresh = mapped.filter(k => k.keyword && !seen.has(k.keyword.toLowerCase().trim()));
          KeywordService.saveKeywords([...fresh, ...existing]);

          return {
            success: true,
            totalSynced: fresh.length,
            message: `Synced ${fresh.length} new keyword(s) from your external source.`,
            source: 'external',
          };
        }
      }
    } catch {
      // Graceful offline fallback — the local pool remains fully usable.
    }

    const current = KeywordService.getKeywords();
    return {
      success: true,
      totalSynced: current.length,
      message: 'External source unreachable. Using local pool.',
      source: 'local',
    };
  }

  /**
   * Best-effort push of a status change back to the operator's own endpoint.
   * The local update always succeeds; the remote call is fire-and-forget.
   */
  static async pushStatus(
    keywordId: string,
    status: 'IN_PRODUCTION' | 'COMPLETED',
    user: string
  ): Promise<boolean> {
    KeywordService.updateKeywordStatus(keywordId, status, user);

    const endpoint = this.getEndpoint();
    if (!endpoint) return true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/api/keywords/${keywordId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updatedBy: user }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return true; // Local update already persisted.
    }
  }
}
