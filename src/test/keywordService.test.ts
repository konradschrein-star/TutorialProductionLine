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

  it('should import keywords from CSV and export to CSV correctly', () => {
    const csvContent = `Keyword,Software,Search Volume,Competition,ChannelID\nHow to install Cursor AI,Cursor,25000,Low,skool\nHow to use VLOOKUP in Excel,Excel,14000,Medium,virtualfd`;
    const res = KeywordService.importKeywordsFromCSV(csvContent);
    expect(res.added).toBeGreaterThanOrEqual(1);

    const list = KeywordService.getKeywords();
    const exportedCSV = KeywordService.exportKeywordsToCSV(list.slice(0, 5));
    expect(exportedCSV).toContain('Keyword');
    expect(exportedCSV).toContain('Search Volume');
  });

  it('should batch assign channel and batch delete keywords', () => {
    const list = KeywordService.getKeywords();
    const ids = [list[0].id, list[1].id];

    KeywordService.batchAssignChannel(ids, 'custom_chan_test');
    const updated = KeywordService.getKeywords();
    expect(updated.find(k => k.id === ids[0])?.targetChannelId).toBe('custom_chan_test');

    const initialLen = updated.length;
    KeywordService.batchDelete(ids);
    const afterDelete = KeywordService.getKeywords();
    expect(afterDelete.length).toBe(initialLen - 2);
  });

  it('should tag the bundled pool as starter and CSV imports as own, kept separate', () => {
    const starter = KeywordService.getKeywordsBySource('starter');
    expect(starter.length).toBeGreaterThan(2000);
    expect(starter.every(k => k.source === 'starter')).toBe(true);

    // Own pool starts empty until the operator brings in their own keywords.
    expect(KeywordService.getKeywordsBySource('own').length).toBe(0);

    KeywordService.importKeywordsFromCSV(
      `Keyword,Software,Search Volume,Competition,ChannelID\nHow to scrape my own niche,CustomTool,3000,Low,skool`
    );

    const own = KeywordService.getKeywordsBySource('own');
    expect(own.length).toBe(1);
    expect(own[0].source).toBe('own');
    // Starter pool count is unchanged — the two pools never bleed into each other.
    expect(KeywordService.getKeywordsBySource('starter').length).toBe(starter.length);
  });

  it('should fetch suggestions for search query', async () => {
    const suggestions = await KeywordService.fetchGoogleSuggestions('Excel');
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
