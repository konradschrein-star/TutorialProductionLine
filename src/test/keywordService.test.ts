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

  it('should fetch suggestions for search query', async () => {
    const suggestions = await KeywordService.fetchGoogleSuggestions('Excel');
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
