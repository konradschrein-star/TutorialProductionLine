import { describe, it, expect, beforeEach } from 'vitest';
import { KTv2SyncService } from '../services/ktv2SyncService';

describe('KTv2SyncService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should gracefully sync and fallback to cached keyword pool', async () => {
    const res = await KTv2SyncService.syncWithVPS('decastroian76@gmail.com');
    expect(res.success).toBe(true);
    expect(res.totalSynced).toBeGreaterThan(0);
    expect(['live_vps', 'cached_pool']).toContain(res.source);
  });

  it('should push status updates locally and remotely', async () => {
    const success = await KTv2SyncService.pushKeywordStatus('kw_1', 'COMPLETED', 'Ian Christopher');
    expect(success).toBe(true);
  });
});
