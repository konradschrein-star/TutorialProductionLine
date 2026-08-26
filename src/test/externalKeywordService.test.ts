import { describe, it, expect, beforeEach } from 'vitest';
import { ExternalKeywordService } from '../services/externalKeywordService';
import { KeywordService } from '../services/keywordService';
import { StorageService } from '../services/storageService';

describe('ExternalKeywordService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is inert and falls back to the local pool when no endpoint is configured', async () => {
    expect(ExternalKeywordService.isConfigured()).toBe(false);

    const before = KeywordService.getKeywords().length;
    const res = await ExternalKeywordService.sync();

    expect(res.success).toBe(true);
    expect(res.source).toBe('local');
    expect(res.totalSynced).toBe(before);
    // The bundled starter pool must be untouched (never clobbered).
    expect(KeywordService.getKeywords().length).toBe(before);
  });

  it('reports configured once an endpoint is set in Settings', () => {
    StorageService.setExternalKeywordApi('https://keywords.example.com');
    expect(ExternalKeywordService.isConfigured()).toBe(true);
  });

  it('pushes status updates locally even with no remote endpoint', async () => {
    const target = KeywordService.getKeywords()[3];
    const ok = await ExternalKeywordService.pushStatus(target.id, 'COMPLETED', 'Operator');
    expect(ok).toBe(true);
    const updated = KeywordService.getKeywords().find(k => k.id === target.id);
    expect(updated?.status).toBe('COMPLETED');
  });
});
