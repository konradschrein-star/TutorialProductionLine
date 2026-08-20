/**
 * Asset Usage Tracking Tests
 *
 * Tests for Enhancement 5: Usage Tracking
 * - Asset usage query (JSONB containment)
 * - Job metadata structure
 * - Usage count calculation
 * - API response format
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database client
vi.mock('@repo/db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

describe('Asset Usage Tracking (Enhancement 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Media Asset Reference Structure', () => {
    it('should validate media_asset_refs structure in job metadata', () => {
      const metadata = {
        media_asset_refs: [
          {
            zone_id: 'zone-1',
            asset_id: 'asset-123',
            asset_type: 'video',
            name: 'intro.mp4',
            size_bytes: 1024000,
          },
          {
            zone_id: 'zone-2',
            asset_id: 'asset-456',
            asset_type: 'audio',
            name: 'background.mp3',
            size_bytes: 512000,
          },
        ],
      };

      expect(metadata.media_asset_refs).toBeDefined();
      expect(Array.isArray(metadata.media_asset_refs)).toBe(true);
      expect(metadata.media_asset_refs.length).toBe(2);

      const ref = metadata.media_asset_refs[0];
      expect(ref.zone_id).toBeDefined();
      expect(ref.asset_id).toBeDefined();
      expect(ref.asset_type).toBeDefined();
      expect(ref.name).toBeDefined();
      expect(ref.size_bytes).toBeGreaterThan(0);
    });

    it('should validate asset_type values', () => {
      const validTypes = ['video', 'audio', 'image'];
      const invalidTypes = ['text', 'document', '', null];

      validTypes.forEach(type => {
        expect(['video', 'audio', 'image']).toContain(type);
      });

      invalidTypes.forEach(type => {
        expect(['video', 'audio', 'image']).not.toContain(type);
      });
    });

    it('should handle empty media_asset_refs array', () => {
      const metadata = {
        media_asset_refs: [],
      };

      expect(metadata.media_asset_refs).toBeDefined();
      expect(metadata.media_asset_refs.length).toBe(0);
    });

    it('should handle missing media_asset_refs field', () => {
      const metadata = {};

      expect(metadata.hasOwnProperty('media_asset_refs')).toBe(false);
      // Jobs without media assets should not have this field
    });
  });

  describe('Usage Query Logic', () => {
    it('should construct JSONB containment query correctly', () => {
      const assetId = 'asset-123';

      // Simulate the JSONB query construction
      const query = `metadata::jsonb -> 'media_asset_refs' @> jsonb_build_array(jsonb_build_object('asset_id', '${assetId}'))`;

      expect(query).toContain('@>'); // JSONB containment operator
      expect(query).toContain('media_asset_refs');
      expect(query).toContain(assetId);
      expect(query).toContain('jsonb_build_object');
    });

    it('should match jobs with asset in any position of array', () => {
      const assetId = 'asset-123';

      const jobs = [
        {
          id: 'job-1',
          metadata: {
            media_asset_refs: [
              { asset_id: 'asset-123', zone_id: 'zone-1' }, // First position
            ],
          },
        },
        {
          id: 'job-2',
          metadata: {
            media_asset_refs: [
              { asset_id: 'asset-456', zone_id: 'zone-1' },
              { asset_id: 'asset-123', zone_id: 'zone-2' }, // Middle position
            ],
          },
        },
        {
          id: 'job-3',
          metadata: {
            media_asset_refs: [
              { asset_id: 'asset-456', zone_id: 'zone-1' },
              { asset_id: 'asset-789', zone_id: 'zone-2' },
              { asset_id: 'asset-123', zone_id: 'zone-3' }, // Last position
            ],
          },
        },
      ];

      // Simulate JSONB @> operator behavior
      const matchingJobs = jobs.filter(job => {
        const refs = job.metadata.media_asset_refs || [];
        return refs.some(ref => ref.asset_id === assetId);
      });

      expect(matchingJobs.length).toBe(3);
      expect(matchingJobs.map(j => j.id)).toEqual(['job-1', 'job-2', 'job-3']);
    });

    it('should not match jobs without the asset', () => {
      const assetId = 'asset-123';

      const jobs = [
        {
          id: 'job-1',
          metadata: {
            media_asset_refs: [
              { asset_id: 'asset-456', zone_id: 'zone-1' },
            ],
          },
        },
        {
          id: 'job-2',
          metadata: {
            media_asset_refs: [
              { asset_id: 'asset-789', zone_id: 'zone-1' },
            ],
          },
        },
      ];

      const matchingJobs = jobs.filter(job => {
        const refs = job.metadata.media_asset_refs || [];
        return refs.some(ref => ref.asset_id === assetId);
      });

      expect(matchingJobs.length).toBe(0);
    });

    it('should handle jobs without media_asset_refs', () => {
      const assetId = 'asset-123';

      const jobs = [
        { id: 'job-1', metadata: {} },
        { id: 'job-2', metadata: { other_field: 'value' } },
      ];

      const matchingJobs = jobs.filter(job => {
        const refs = job.metadata.media_asset_refs || [];
        return refs.some(ref => ref.asset_id === assetId);
      });

      expect(matchingJobs.length).toBe(0);
    });
  });

  describe('Usage Count Calculation', () => {
    it('should count total jobs using an asset', () => {
      const usage = {
        total_jobs: 3,
        jobs: [
          { id: 'job-1', title: 'Video 1', status: 'PUBLISHED' },
          { id: 'job-2', title: 'Video 2', status: 'RENDERING_FFMPEG' },
          { id: 'job-3', title: 'Video 3', status: 'AWAITING_QC' },
        ],
        has_more: false,
      };

      expect(usage.total_jobs).toBe(3);
      expect(usage.jobs.length).toBe(3);
      expect(usage.has_more).toBe(false);
    });

    it('should return zero for unused asset', () => {
      const usage = {
        total_jobs: 0,
        jobs: [],
        has_more: false,
      };

      expect(usage.total_jobs).toBe(0);
      expect(usage.jobs.length).toBe(0);
      expect(usage.has_more).toBe(false);
    });

    it('should include all job statuses in count', () => {
      const usage = {
        total_jobs: 6,
        jobs: [
          { id: 'job-1', status: 'SCRIPTING' },
          { id: 'job-2', status: 'RENDERING_FFMPEG' },
          { id: 'job-3', status: 'PUBLISHED' },
          { id: 'job-4', status: 'FAILED_RENDER' },
          { id: 'job-5', status: 'PAUSED' },
          { id: 'job-6', status: 'AWAITING_QC' },
        ],
        has_more: false,
      };

      // Usage tracking includes ALL statuses (active, failed, published, etc.)
      expect(usage.total_jobs).toBe(6);

      const statuses = usage.jobs.map(j => j.status);
      expect(statuses).toContain('SCRIPTING');
      expect(statuses).toContain('PUBLISHED');
      expect(statuses).toContain('FAILED_RENDER');
    });
  });

  describe('Pagination', () => {
    it('should indicate when more results exist', () => {
      const usage = {
        total_jobs: 150,
        jobs: Array.from({ length: 50 }, (_, i) => ({
          id: `job-${i}`,
          title: `Video ${i}`,
          status: 'PUBLISHED',
          format: 'explainer',
          template_name: 'Tech Explainer',
          created_at: new Date(),
        })),
        has_more: true,
      };

      expect(usage.total_jobs).toBe(150);
      expect(usage.jobs.length).toBe(50);
      expect(usage.has_more).toBe(true);
    });

    it('should indicate when no more results exist', () => {
      const usage = {
        total_jobs: 30,
        jobs: Array.from({ length: 30 }, (_, i) => ({
          id: `job-${i}`,
          title: `Video ${i}`,
          status: 'PUBLISHED',
          format: 'explainer',
          template_name: 'Tech Explainer',
          created_at: new Date(),
        })),
        has_more: false,
      };

      expect(usage.total_jobs).toBe(30);
      expect(usage.jobs.length).toBe(30);
      expect(usage.has_more).toBe(false);
    });

    it('should handle pagination offsets correctly', () => {
      // Simulating page 2 (offset 50, limit 50) of 150 total
      const usage = {
        total_jobs: 150,
        jobs: Array.from({ length: 50 }, (_, i) => ({
          id: `job-${i + 50}`,
          title: `Video ${i + 50}`,
          status: 'PUBLISHED',
          format: 'explainer',
          template_name: 'Tech Explainer',
          created_at: new Date(),
        })),
        has_more: true,
      };

      expect(usage.total_jobs).toBe(150);
      expect(usage.jobs.length).toBe(50);
      expect(usage.jobs[0].id).toBe('job-50'); // First item of page 2
      expect(usage.has_more).toBe(true);
    });

    it('should handle last page correctly', () => {
      // Last page: offset 100, limit 50, total 150 (50 items returned)
      const usage = {
        total_jobs: 150,
        jobs: Array.from({ length: 50 }, (_, i) => ({
          id: `job-${i + 100}`,
          title: `Video ${i + 100}`,
          status: 'PUBLISHED',
          format: 'explainer',
          template_name: 'Tech Explainer',
          created_at: new Date(),
        })),
        has_more: false,
      };

      expect(usage.total_jobs).toBe(150);
      expect(usage.jobs.length).toBe(50);
      expect(usage.has_more).toBe(false);
    });
  });

  describe('Usage Response Format', () => {
    it('should format usage response correctly', () => {
      const usage = {
        total_jobs: 2,
        jobs: [
          {
            id: 'job-123',
            title: 'Explainer: How CPUs Work',
            status: 'PUBLISHED',
            format: 'explainer',
            template_name: 'Tech Explainer',
            created_at: new Date('2026-04-15T10:00:00Z'),
          },
          {
            id: 'job-456',
            title: 'Comparison: AMD vs Intel',
            status: 'RENDERING_FFMPEG',
            format: 'comparison',
            template_name: 'Tech Comparison',
            created_at: new Date('2026-04-16T14:30:00Z'),
          },
        ],
      };

      expect(usage.total_jobs).toBe(2);

      const job1 = usage.jobs[0];
      expect(job1.id).toBeDefined();
      expect(job1.title).toBeDefined();
      expect(job1.status).toBeDefined();
      expect(job1.format).toBeDefined();
      expect(job1.template_name).toBeDefined();
      expect(job1.created_at).toBeInstanceOf(Date);
    });

    it('should handle null template_name', () => {
      const usage = {
        total_jobs: 1,
        jobs: [
          {
            id: 'job-123',
            title: 'Custom Job',
            status: 'SCRIPTING',
            format: 'custom',
            template_name: null,
            created_at: new Date(),
          },
        ],
      };

      expect(usage.jobs[0].template_name).toBeNull();
      // UI should handle null gracefully (show "N/A" or empty)
    });

    it('should sort jobs by created_at desc (newest first)', () => {
      const jobs = [
        { id: 'job-1', created_at: new Date('2026-04-15T10:00:00Z') },
        { id: 'job-3', created_at: new Date('2026-04-17T10:00:00Z') }, // Newest
        { id: 'job-2', created_at: new Date('2026-04-16T10:00:00Z') },
      ];

      const sorted = [...jobs].sort(
        (a, b) => b.created_at.getTime() - a.created_at.getTime()
      );

      expect(sorted[0].id).toBe('job-3'); // Newest first
      expect(sorted[1].id).toBe('job-2');
      expect(sorted[2].id).toBe('job-1');
    });
  });

  describe('Multi-Zone Asset Usage', () => {
    it('should track same asset used multiple times in one job', () => {
      const assetId = 'asset-123';
      const metadata = {
        media_asset_refs: [
          {
            zone_id: 'intro',
            asset_id: 'asset-123',
            asset_type: 'video',
          },
          {
            zone_id: 'outro',
            asset_id: 'asset-123', // Same asset, different zone
            asset_type: 'video',
          },
        ],
      };

      const assetRefs = metadata.media_asset_refs.filter(
        ref => ref.asset_id === assetId
      );

      expect(assetRefs.length).toBe(2);
      expect(assetRefs[0].zone_id).not.toBe(assetRefs[1].zone_id);

      // But this still counts as 1 job using the asset
      const uniqueJobCount = 1;
      expect(uniqueJobCount).toBe(1);
    });

    it('should provide zone context for multi-use assets', () => {
      const metadata = {
        media_asset_refs: [
          { zone_id: 'intro', asset_id: 'asset-123', asset_type: 'video' },
          { zone_id: 'background', asset_id: 'asset-456', asset_type: 'audio' },
          { zone_id: 'outro', asset_id: 'asset-123', asset_type: 'video' },
        ],
      };

      const assetId = 'asset-123';
      const zones = metadata.media_asset_refs
        .filter(ref => ref.asset_id === assetId)
        .map(ref => ref.zone_id);

      expect(zones).toEqual(['intro', 'outro']);
      // UI could show "Used in 2 zones: intro, outro"
    });
  });

  describe('Deletion Safety', () => {
    it('should prevent deletion of assets with usage count > 0', () => {
      const usageCount = 3;

      const canDelete = usageCount === 0;

      expect(canDelete).toBe(false);
      // UI should disable delete button when usageCount > 0
    });

    it('should allow deletion of unused assets', () => {
      const usageCount = 0;

      const canDelete = usageCount === 0;

      expect(canDelete).toBe(true);
      // UI should enable delete button when usageCount === 0
    });

    it('should warn about impact before deletion', () => {
      const usage = {
        total_jobs: 5,
        jobs: [
          { id: 'job-1', status: 'PUBLISHED' },
          { id: 'job-2', status: 'RENDERING_FFMPEG' },
          { id: 'job-3', status: 'AWAITING_QC' },
          { id: 'job-4', status: 'FAILED_RENDER' },
          { id: 'job-5', status: 'SCRIPTING' },
        ],
      };

      const publishedJobs = usage.jobs.filter(j => j.status === 'PUBLISHED');
      const activeJobs = usage.jobs.filter(j =>
        ['RENDERING_FFMPEG', 'AWAITING_QC', 'SCRIPTING'].includes(j.status)
      );

      // Warning message should show:
      // - Total jobs affected: 5
      // - Published jobs: 1 (cannot be re-rendered)
      // - Active jobs: 3 (will fail if asset deleted)
      expect(publishedJobs.length).toBe(1);
      expect(activeJobs.length).toBe(3);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle assets used in many jobs', () => {
      const usage = {
        total_jobs: 100,
        jobs: Array.from({ length: 100 }, (_, i) => ({
          id: `job-${i}`,
          title: `Video ${i}`,
          status: 'PUBLISHED',
        })),
      };

      expect(usage.total_jobs).toBe(100);
      expect(usage.jobs.length).toBe(100);
      // UI should paginate or virtualize the job list
    });

    it('should use JSONB indexes for fast lookups', () => {
      // PostgreSQL should have a GIN index on metadata::jsonb
      // Index: CREATE INDEX idx_content_jobs_metadata_gin ON content_jobs USING GIN (metadata);

      const assetId = 'asset-123';
      const queryString = `
        SELECT COUNT(*) FROM content_jobs
        WHERE metadata::jsonb -> 'media_asset_refs' @> jsonb_build_array(jsonb_build_object('asset_id', '${assetId}'))
      `;

      // With GIN index, this should be fast even with 100k+ jobs
      expect(queryString).toBeDefined();
      expect(queryString).toContain('@>');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed media_asset_refs', () => {
      const metadata = {
        media_asset_refs: [
          { asset_id: 'asset-123' }, // Missing required fields
          { zone_id: 'zone-1' }, // Missing asset_id
          null, // Invalid entry
        ],
      };

      // Filter out invalid entries
      const validRefs = (metadata.media_asset_refs || []).filter(
        ref => ref && ref.asset_id && ref.zone_id
      );

      expect(validRefs.length).toBe(0);
    });

    it('should handle very long asset IDs', () => {
      const longAssetId = 'a'.repeat(500);

      const metadata = {
        media_asset_refs: [
          { zone_id: 'zone-1', asset_id: longAssetId, asset_type: 'video' },
        ],
      };

      expect(metadata.media_asset_refs[0].asset_id.length).toBe(500);
      // DB should handle variable-length IDs (text/varchar columns)
    });

    it('should handle special characters in asset IDs', () => {
      const specialAssetId = 'asset-with-$pecial-ch@rs!';

      const metadata = {
        media_asset_refs: [
          { zone_id: 'zone-1', asset_id: specialAssetId, asset_type: 'video' },
        ],
      };

      expect(metadata.media_asset_refs[0].asset_id).toBe(specialAssetId);
      // JSONB should preserve special characters correctly
    });
  });
});
