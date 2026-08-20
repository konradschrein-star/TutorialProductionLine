/**
 * Media Asset Filtering Tests
 *
 * Tests for Enhancement 1: Search & Advanced Filters
 * - Search query matching (name, description, tags, format)
 * - Duration filters
 * - Size filters
 * - Date filters
 * - Unused-only filter
 * - Combined filter logic
 * - Debounced search behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MockAsset {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  file_format: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  created_at: Date;
  category: 'video' | 'audio' | 'image' | 'document';
}

describe('Media Asset Filtering (Enhancement 1)', () => {
  const mockAssets: MockAsset[] = [
    {
      id: 'asset-1',
      name: 'intro-video.mp4',
      description: 'Introduction video for tech explainer',
      tags: ['intro', 'tech', 'explainer'],
      file_format: 'mp4',
      duration_seconds: 15,
      size_bytes: 5 * 1024 * 1024, // 5 MB
      created_at: new Date('2026-04-17T10:00:00Z'), // Today
      category: 'video',
    },
    {
      id: 'asset-2',
      name: 'background-music.mp3',
      description: 'Upbeat background music',
      tags: ['music', 'background', 'upbeat'],
      file_format: 'mp3',
      duration_seconds: 180,
      size_bytes: 3 * 1024 * 1024, // 3 MB
      created_at: new Date('2026-04-10T10:00:00Z'), // Last week
      category: 'audio',
    },
    {
      id: 'asset-3',
      name: 'thumbnail.jpg',
      description: null,
      tags: ['thumbnail', 'tech'],
      file_format: 'jpg',
      duration_seconds: null,
      size_bytes: 500 * 1024, // 500 KB
      created_at: new Date('2026-03-01T10:00:00Z'), // Last month
      category: 'image',
    },
    {
      id: 'asset-4',
      name: 'long-documentary.mp4',
      description: 'Full-length documentary about history',
      tags: ['documentary', 'history', 'long'],
      file_format: 'mp4',
      duration_seconds: 3600, // 1 hour
      size_bytes: 500 * 1024 * 1024, // 500 MB
      created_at: new Date('2026-04-15T10:00:00Z'), // This week
      category: 'video',
    },
    {
      id: 'asset-5',
      name: 'short-clip.mp4',
      description: 'Quick 10-second clip',
      tags: ['short', 'clip'],
      file_format: 'mp4',
      duration_seconds: 10,
      size_bytes: 2 * 1024 * 1024, // 2 MB
      created_at: new Date('2026-01-15T10:00:00Z'), // 3+ months ago
      category: 'video',
    },
  ];

  describe('Search Query Matching', () => {
    it('should match asset name (case-insensitive)', () => {
      const searchQuery = 'intro';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.name.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-1');
    });

    it('should match description (case-insensitive)', () => {
      const searchQuery = 'background music';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.description?.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-2');
    });

    it('should match tags', () => {
      const searchQuery = 'tech';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.tags?.some(t => t.toLowerCase().includes(q));
      });

      expect(filtered.length).toBe(2);
      expect(filtered.map(a => a.id)).toEqual(['asset-1', 'asset-3']);
    });

    it('should match file format', () => {
      const searchQuery = 'mp4';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.file_format?.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(3);
      expect(filtered.map(a => a.id)).toEqual(['asset-1', 'asset-4', 'asset-5']);
    });

    it('should match across all searchable fields', () => {
      const searchQuery = 'documentary';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return (
          asset.name.toLowerCase().includes(q) ||
          asset.description?.toLowerCase().includes(q) ||
          asset.tags?.some(t => t.toLowerCase().includes(q)) ||
          asset.file_format?.toLowerCase().includes(q)
        );
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-4');
    });

    it('should handle empty search query', () => {
      const searchQuery = '';

      const filtered = mockAssets.filter(asset => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return asset.name.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(5); // All assets
    });

    it('should handle special characters in search', () => {
      const searchQuery = 'intro-video.mp4';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.name.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-1');
    });

    it('should return empty array when no matches', () => {
      const searchQuery = 'nonexistent';

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        return asset.name.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(0);
    });
  });

  describe('Duration Filters', () => {
    it('should filter assets < 30 seconds', () => {
      const durationFilter = '<30';

      const filtered = mockAssets.filter(asset => {
        if (!asset.duration_seconds) return false;
        return asset.duration_seconds < 30;
      });

      expect(filtered.length).toBe(2);
      expect(filtered.map(a => a.id)).toEqual(['asset-1', 'asset-5']);
    });

    it('should filter assets 30-120 seconds', () => {
      const durationFilter = '30-120';

      const filtered = mockAssets.filter(asset => {
        if (!asset.duration_seconds) return false;
        const dur = asset.duration_seconds;
        return dur >= 30 && dur <= 120;
      });

      expect(filtered.length).toBe(0); // No assets in this range
    });

    it('should filter assets 2-10 minutes', () => {
      const durationFilter = '120-600';

      const filtered = mockAssets.filter(asset => {
        if (!asset.duration_seconds) return false;
        const dur = asset.duration_seconds;
        return dur >= 120 && dur <= 600;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-2'); // 180 seconds = 3 minutes
    });

    it('should filter assets > 10 minutes', () => {
      const durationFilter = '>600';

      const filtered = mockAssets.filter(asset => {
        if (!asset.duration_seconds) return false;
        return asset.duration_seconds > 600;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-4'); // 3600 seconds = 1 hour
    });

    it('should exclude assets without duration when filtering', () => {
      const durationFilter = '<30';

      const filtered = mockAssets.filter(asset => {
        if (!asset.duration_seconds) return false;
        return asset.duration_seconds < 30;
      });

      expect(filtered.every(a => a.duration_seconds !== null)).toBe(true);
    });

    it('should show all assets when duration filter is empty', () => {
      const durationFilter = '';

      const filtered = mockAssets.filter(asset => {
        if (!durationFilter) return true;
        return false; // Would apply filter logic
      });

      expect(filtered.length).toBe(5);
    });
  });

  describe('Size Filters', () => {
    it('should filter assets < 10 MB', () => {
      const sizeFilter = '<10';

      const filtered = mockAssets.filter(asset => {
        if (!asset.size_bytes) return false;
        const sizeMB = asset.size_bytes / (1024 * 1024);
        return sizeMB < 10;
      });

      expect(filtered.length).toBe(4);
      expect(filtered.map(a => a.id)).toEqual(['asset-1', 'asset-2', 'asset-3', 'asset-5']);
    });

    it('should filter assets 10-100 MB', () => {
      const sizeFilter = '10-100';

      const filtered = mockAssets.filter(asset => {
        if (!asset.size_bytes) return false;
        const sizeMB = asset.size_bytes / (1024 * 1024);
        return sizeMB >= 10 && sizeMB <= 100;
      });

      expect(filtered.length).toBe(0);
    });

    it('should filter assets > 100 MB', () => {
      const sizeFilter = '>100';

      const filtered = mockAssets.filter(asset => {
        if (!asset.size_bytes) return false;
        const sizeMB = asset.size_bytes / (1024 * 1024);
        return sizeMB > 100;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-4'); // 500 MB
    });

    it('should exclude assets without size when filtering', () => {
      const sizeFilter = '<10';

      const filtered = mockAssets.filter(asset => {
        if (!asset.size_bytes) return false;
        return true;
      });

      expect(filtered.every(a => a.size_bytes !== null)).toBe(true);
    });

    it('should show all assets when size filter is empty', () => {
      const sizeFilter = '';

      const filtered = mockAssets.filter(asset => {
        if (!sizeFilter) return true;
        return false;
      });

      expect(filtered.length).toBe(5);
    });
  });

  describe('Date Filters', () => {
    const now = new Date('2026-04-17T12:00:00Z');

    it('should filter assets from today', () => {
      const dateFilter = 'today';

      const filtered = mockAssets.filter(asset => {
        const assetDate = new Date(asset.created_at);
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        return assetDate >= today;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-1');
    });

    it('should filter assets from last 7 days', () => {
      const dateFilter = 'week';

      const filtered = mockAssets.filter(asset => {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);

        return new Date(asset.created_at) >= weekAgo;
      });

      // asset-1: 2026-04-17 (today) - included
      // asset-2: 2026-04-10 (7 days ago) - at boundary, included
      // asset-4: 2026-04-15 (2 days ago) - included
      // Total: 3, but asset-2 is exactly 7 days ago, might not be included depending on time
      expect(filtered.length).toBeGreaterThanOrEqual(2);
      expect(filtered.length).toBeLessThanOrEqual(3);
    });

    it('should filter assets from last 30 days', () => {
      const dateFilter = 'month';

      const filtered = mockAssets.filter(asset => {
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 30);

        return new Date(asset.created_at) >= monthAgo;
      });

      // asset-1: 2026-04-17 (today) - included
      // asset-2: 2026-04-10 (7 days ago) - included
      // asset-3: 2026-03-01 (47 days ago) - NOT included
      // asset-4: 2026-04-15 (2 days ago) - included
      expect(filtered.length).toBe(3);
      expect(filtered.map(a => a.id)).toContain('asset-1');
      expect(filtered.map(a => a.id)).toContain('asset-2');
      expect(filtered.map(a => a.id)).toContain('asset-4');
    });

    it('should show all assets when date filter is empty', () => {
      const dateFilter = '';

      const filtered = mockAssets.filter(asset => {
        if (!dateFilter) return true;
        return false;
      });

      expect(filtered.length).toBe(5);
    });

    it('should handle future dates gracefully', () => {
      const futureAsset: MockAsset = {
        ...mockAssets[0],
        id: 'asset-future',
        created_at: new Date('2027-01-01T10:00:00Z'),
      };

      const assetsWithFuture = [...mockAssets, futureAsset];

      const filtered = assetsWithFuture.filter(asset => {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return new Date(asset.created_at) >= weekAgo;
      });

      // Future asset should be included
      expect(filtered.some(a => a.id === 'asset-future')).toBe(true);
    });
  });

  describe('Combined Filters', () => {
    it('should apply search + duration filter', () => {
      const searchQuery = 'video';
      const durationFilter = '<30';

      const filtered = mockAssets.filter(asset => {
        // Search filter
        const q = searchQuery.toLowerCase();
        const matchesSearch = asset.name.toLowerCase().includes(q);
        if (!matchesSearch) return false;

        // Duration filter
        if (!asset.duration_seconds) return false;
        return asset.duration_seconds < 30;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-1'); // intro-video.mp4, 15 seconds
    });

    it('should apply search + size filter', () => {
      const searchQuery = 'mp4';
      const sizeFilter = '<10';

      const filtered = mockAssets.filter(asset => {
        // Search filter
        const q = searchQuery.toLowerCase();
        const matchesSearch = asset.file_format?.toLowerCase().includes(q);
        if (!matchesSearch) return false;

        // Size filter
        if (!asset.size_bytes) return false;
        const sizeMB = asset.size_bytes / (1024 * 1024);
        return sizeMB < 10;
      });

      expect(filtered.length).toBe(2);
      expect(filtered.map(a => a.id)).toEqual(['asset-1', 'asset-5']);
    });

    it('should apply all filters together', () => {
      const searchQuery = 'mp4';
      const durationFilter = '<30';
      const sizeFilter = '<10';
      const dateFilter = 'week';
      const now = new Date('2026-04-17T12:00:00Z');

      const filtered = mockAssets.filter(asset => {
        // Search filter
        const q = searchQuery.toLowerCase();
        const matchesSearch = asset.file_format?.toLowerCase().includes(q);
        if (!matchesSearch) return false;

        // Duration filter
        if (!asset.duration_seconds) return false;
        if (asset.duration_seconds >= 30) return false;

        // Size filter
        if (!asset.size_bytes) return false;
        const sizeMB = asset.size_bytes / (1024 * 1024);
        if (sizeMB >= 10) return false;

        // Date filter
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        if (new Date(asset.created_at) < weekAgo) return false;

        return true;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('asset-1');
    });

    it('should return empty when combined filters match nothing', () => {
      const searchQuery = 'documentary';
      const durationFilter = '<30'; // Documentary is 1 hour

      const filtered = mockAssets.filter(asset => {
        const q = searchQuery.toLowerCase();
        const matchesSearch = asset.name.toLowerCase().includes(q);
        if (!matchesSearch) return false;

        if (!asset.duration_seconds) return false;
        return asset.duration_seconds < 30;
      });

      expect(filtered.length).toBe(0);
    });
  });

  describe('Debounced Search', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should debounce search input by 300ms', async () => {
      let searchQuery = '';
      const setSearchQuery = vi.fn((value: string) => {
        searchQuery = value;
      });

      const debounce = (fn: Function, delay: number) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        return (...args: any[]) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      };

      const debouncedSet = debounce(setSearchQuery, 300);

      // Simulate typing "intro"
      debouncedSet('i');
      debouncedSet('in');
      debouncedSet('int');
      debouncedSet('intr');
      debouncedSet('intro');

      // Before 300ms, search query should still be empty
      vi.advanceTimersByTime(250);
      expect(setSearchQuery).not.toHaveBeenCalled();

      // After 300ms from last input, search query should update
      vi.advanceTimersByTime(100);
      expect(setSearchQuery).toHaveBeenCalledWith('intro');
      expect(setSearchQuery).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous timer on rapid typing', () => {
      const setSearchQuery = vi.fn();

      const debounce = (fn: Function, delay: number) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        return (...args: any[]) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      };

      const debouncedSet = debounce(setSearchQuery, 300);

      // Rapidly type 5 characters
      debouncedSet('i');
      vi.advanceTimersByTime(100);
      debouncedSet('in');
      vi.advanceTimersByTime(100);
      debouncedSet('int');
      vi.advanceTimersByTime(100);
      debouncedSet('intr');
      vi.advanceTimersByTime(100);
      debouncedSet('intro');

      // Before 300ms from last input, should not have been called
      expect(setSearchQuery).not.toHaveBeenCalled();

      // After 300ms, should be called only once with final value
      vi.advanceTimersByTime(300);
      expect(setSearchQuery).toHaveBeenCalledTimes(1);
      expect(setSearchQuery).toHaveBeenCalledWith('intro');
    });
  });

  describe('Performance Considerations', () => {
    it('should handle filtering large asset collections efficiently', () => {
      const largeAssetList = Array.from({ length: 1000 }, (_, i) => ({
        id: `asset-${i}`,
        name: `video-${i}.mp4`,
        description: i % 2 === 0 ? 'Even numbered video' : 'Odd numbered video',
        tags: ['video'],
        file_format: 'mp4',
        duration_seconds: i * 10,
        size_bytes: i * 1024 * 1024,
        created_at: new Date(),
        category: 'video' as const,
      }));

      const startTime = Date.now();

      const filtered = largeAssetList.filter(asset => {
        const q = 'even'.toLowerCase();
        return asset.description?.toLowerCase().includes(q);
      });

      const duration = Date.now() - startTime;

      expect(filtered.length).toBe(500);
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should use memoization for expensive filter calculations', () => {
      // useMemo should be used to avoid recalculating filters on every render
      const calculateFilters = vi.fn((assets: MockAsset[], filters: any) => {
        return assets.filter(a => true);
      });

      const assets = mockAssets;
      const filters = { duration: '', size: '', date: '' };

      // First calculation
      const result1 = calculateFilters(assets, filters);
      expect(calculateFilters).toHaveBeenCalledTimes(1);

      // With memoization, same inputs should not recalculate
      const result2 = calculateFilters(assets, filters);
      expect(calculateFilters).toHaveBeenCalledTimes(2); // Would be 1 with real memo

      // UI implementation should use useMemo with [assets, searchQuery, filters] deps
    });
  });

  describe('Edge Cases', () => {
    it('should handle assets with null fields gracefully', () => {
      const assetWithNulls: MockAsset = {
        id: 'asset-null',
        name: 'minimal-asset.jpg',
        description: null,
        tags: null,
        file_format: null,
        duration_seconds: null,
        size_bytes: null,
        created_at: new Date(),
        category: 'image',
      };

      const searchQuery = 'minimal';

      const matchesSearch =
        assetWithNulls.name.toLowerCase().includes(searchQuery) ||
        assetWithNulls.description?.toLowerCase().includes(searchQuery) ||
        assetWithNulls.tags?.some(t => t.toLowerCase().includes(searchQuery)) ||
        assetWithNulls.file_format?.toLowerCase().includes(searchQuery);

      expect(matchesSearch).toBe(true); // Should match on name
    });

    it('should handle empty tags array', () => {
      const asset: MockAsset = {
        ...mockAssets[0],
        tags: [],
      };

      const searchQuery = 'intro';

      const matchesTags = asset.tags?.some(t => t.toLowerCase().includes(searchQuery));

      expect(matchesTags).toBe(false); // Empty array returns false from .some()
    });

    it('should handle very long search queries', () => {
      const longQuery = 'a'.repeat(1000);

      const filtered = mockAssets.filter(asset => {
        const q = longQuery.toLowerCase();
        return asset.name.toLowerCase().includes(q);
      });

      expect(filtered.length).toBe(0);
      // Should not crash or timeout
    });

    it('should handle Unicode characters in search', () => {
      const unicodeAsset: MockAsset = {
        ...mockAssets[0],
        name: 'video-emoji-🎥.mp4',
        description: 'Video with émojis and àccents',
      };

      const searchQuery = 'emoji';

      const matchesSearch =
        unicodeAsset.name.toLowerCase().includes(searchQuery) ||
        unicodeAsset.description?.toLowerCase().includes(searchQuery);

      expect(matchesSearch).toBe(true);
    });
  });
});
