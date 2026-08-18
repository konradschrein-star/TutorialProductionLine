import { describe, it, expect, beforeEach } from 'vitest';
import { KeywordService } from '../services/keywordService';

describe('KeywordService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return screened keyword pool', () => {
    const list = KeywordService.getKeywords();
    expect(list.length).toBeGreaterThan(5);
    expect(list[0].screenVerdict).toBe('APPROVE');
  });

  it('should claim and complete a keyword', () => {
    const list = KeywordService.getKeywords();
    const target = list[2];

    KeywordService.claimKeyword(target.id, 'Ian Christopher');
    const claimed = KeywordService.getClaimedKeywords('Ian Christopher');
    expect(claimed.some(k => k.id === target.id)).toBe(true);

    KeywordService.completeKeyword(target.id);
    const updated = KeywordService.getKeywords().find(k => k.id === target.id);
    expect(updated?.status).toBe('COMPLETED');
  });

  it('should update keyword status directly and report metrics', () => {
    const list = KeywordService.getKeywords();
    const target1 = list[0];
    const target2 = list[1];

    KeywordService.updateKeywordStatus(target1.id, 'IN_PRODUCTION');
    KeywordService.updateKeywordStatus(target2.id, 'COMPLETED');

    const counts = KeywordService.getKeywordCounts();
    expect(counts.inProduction).toBeGreaterThanOrEqual(1);
    expect(counts.completed).toBeGreaterThanOrEqual(1);
    expect(counts.total).toBe(list.length);
  });

  it('should batch update multiple keyword statuses', () => {
    const list = KeywordService.getKeywords();
    const ids = [list[0].id, list[1].id, list[2].id];

    KeywordService.batchUpdateStatus(ids, 'COMPLETED');
    const updatedList = KeywordService.getKeywords();

    for (const id of ids) {
      const item = updatedList.find(k => k.id === id);
      expect(item?.status).toBe('COMPLETED');
    }
  });

  it('should fetch suggestions for search query', async () => {
    const suggestions = await KeywordService.fetchGoogleSuggestions('Excel');
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
